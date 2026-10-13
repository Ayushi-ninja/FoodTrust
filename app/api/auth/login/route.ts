/**
 * app/api/auth/login/route.ts
 * FoodTrust — Phase 2: Auth, RBAC & Profiles
 *
 * User authentication endpoint.
 * Validates credentials, establishes a session cookie, resolves public.users.
 * Does not return passwords or tokens.
 */

import { NextRequest } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { loginSchema } from '@/lib/validation/auth.schema';
import { successResponse, errorResponse } from '@/lib/utils/api-response';
import type { User } from '@/types/database.types';

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.json().catch(() => null);
    if (!rawBody) return errorResponse('Invalid JSON request body', 400);

    const parseResult = loginSchema.safeParse(rawBody);
    if (!parseResult.success) {
      return errorResponse('Validation failed', 400, parseResult.error.flatten().fieldErrors);
    }

    const { email, password } = parseResult.data;
    // Supabase v2 generic inference does not resolve our Database type correctly
    // for chained query builders. Using unknown cast at the client level only.
    const supabase = createServerClient() as unknown as ReturnType<typeof createServerClient>;

    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError || !authData?.user) {
      return errorResponse('Invalid email or password credentials', 401, {
        code: 'INVALID_CREDENTIALS',
      });
    }

    // Use the admin-bypass-safe server client (anon key, honours RLS)
    // but with raw query to avoid type inference chain issue
    const raw = supabase as { from: Function }; // narrowed to plain query interface
    const { data: dbUser, error: dbError } = await (raw.from('users') as {
      select: Function;
    })
      .select('id, email, full_name, phone, role, status, created_at, updated_at')
      .eq('id', authData.user.id)
      .single();

    if (dbError || !dbUser) {
      return errorResponse(
        'Authentication succeeded, but user profile could not be loaded.',
        500,
        { code: 'USER_PROFILE_NOT_FOUND' }
      );
    }

    const typedUser = dbUser as User;

    if (typedUser.status === 'SUSPENDED') {
      await supabase.auth.signOut();
      return errorResponse('This account has been suspended.', 403, {
        code: 'ACCOUNT_SUSPENDED',
      });
    }

    let profile: unknown = null;
    const profileFrom = supabase as { from: Function };
    if (typedUser.role === 'DONOR') {
      const { data } = await (profileFrom.from('donor_profiles') as { select: Function })
        .select('id, business_name, establishment_type, fssai_license, address, latitude, longitude, contact_person')
        .eq('user_id', typedUser.id)
        .single();
      profile = data ?? null;
    } else if (typedUser.role === 'NGO') {
      const { data } = await (profileFrom.from('ngo_profiles') as { select: Function })
        .select('id, organization_name, registration_number, operational_radius_km, has_cold_storage, daily_capacity_kg, latitude, longitude, verification_status, address, contact_person, contact_phone')
        .eq('user_id', typedUser.id)
        .single();
      profile = data ?? null;
    }

    return successResponse({ user: typedUser, profile }, 'Authentication successful', 200);
  } catch (err) {
    return errorResponse('Unexpected error during authentication', 500, {
      details: err instanceof Error ? err.message : 'Unknown',
    });
  }
}
