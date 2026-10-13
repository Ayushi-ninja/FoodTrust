/**
 * app/api/auth/register/route.ts
 * FoodTrust — Phase 2: Auth, RBAC & Profiles
 *
 * Registration endpoint for DONOR and NGO organizations.
 *
 * SECURITY & ARCHITECTURAL RULES:
 * 1. Only 'DONOR' and 'NGO' roles may register publicly.
 *    ADMIN, SUPER_ADMIN, and DEVICE registrations are strictly rejected (HTTP 400).
 * 2. User accounts are created via Supabase Auth.
 * 3. The Phase 1 database trigger `handle_new_user()` is the authoritative creator
 *    of the `public.users` row.
 * 4. NGO accounts are strictly initialized with status 'PENDING' and verification_status 'PENDING'.
 * 5. Passwords, secrets, and raw database errors are NEVER returned to the client.
 */

import { NextRequest } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { getAdminSupabase } from '@/lib/supabase/admin';
import { registerSchema } from '@/lib/validation/auth.schema';
import { successResponse, errorResponse } from '@/lib/utils/api-response';
import type { Database } from '@/types/database.types';

type DonorInsert = Database['public']['Tables']['donor_profiles']['Insert'];
type NgoInsert = Database['public']['Tables']['ngo_profiles']['Insert'];

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.json().catch(() => null);

    if (!rawBody) {
      return errorResponse('Invalid JSON request body', 400);
    }

    // Explicit early rejection for forbidden roles
    if (['ADMIN', 'SUPER_ADMIN', 'DEVICE'].includes(rawBody?.role)) {
      return errorResponse(
        `Registration for role '${rawBody.role}' is not permitted through public registration.`,
        400,
        { code: 'FORBIDDEN_ROLE' }
      );
    }

    // 1. Validate request payload with Zod
    const parseResult = registerSchema.safeParse(rawBody);
    if (!parseResult.success) {
      return errorResponse(
        'Validation failed for registration input',
        400,
        parseResult.error.flatten().fieldErrors
      );
    }

    const input = parseResult.data;
    const serverSupabase = createServerClient();
    const adminSupabase = getAdminSupabase();

    // 2. Create the Supabase Auth user
    // The handle_new_user() trigger reads raw_user_meta_data for initial public.users synchronization
    const { data: authData, error: authError } = await serverSupabase.auth.signUp({
      email: input.email,
      password: input.password,
      options: {
        data: {
          role: input.role,
          full_name: input.full_name,
          phone: input.phone || null,
        },
      },
    });

    if (authError) {
      if (
        authError.message.toLowerCase().includes('already registered') ||
        authError.status === 422
      ) {
        return errorResponse(
          'An account with this email address already exists.',
          409,
          { code: 'USER_ALREADY_EXISTS' }
        );
      }
      return errorResponse(authError.message, 400, { code: authError.code });
    }

    const createdAuthUser = authData.user;
    if (!createdAuthUser) {
      return errorResponse('Failed to initialize user identity', 500);
    }

    // 3. Create the role-specific profile row
    let profileData: unknown = null;

    if (input.role === 'DONOR') {
      const donorInsert: DonorInsert = {
        user_id: createdAuthUser.id,
        business_name: input.donor_profile.business_name,
        establishment_type: input.donor_profile.establishment_type ?? null,
        fssai_license: input.donor_profile.fssai_license ?? null,
        address: input.donor_profile.address,
        latitude: input.donor_profile.latitude,
        longitude: input.donor_profile.longitude,
        contact_person: input.donor_profile.contact_person ?? null,
      };

            const { data: donorProfile, error: profileError } = await (adminSupabase as any)
        .from('donor_profiles')
        .insert(donorInsert)
        .select('id, business_name, establishment_type, fssai_license, address, latitude, longitude, contact_person, created_at')
        .single();

      if (profileError) {
        return errorResponse(
          'User registered, but failed to create donor profile.',
          500,
          { code: (profileError as { code?: string }).code }
        );
      }
      profileData = donorProfile;
    } else if (input.role === 'NGO') {
      const ngoInsert: NgoInsert = {
        user_id: createdAuthUser.id,
        organization_name: input.ngo_profile.organization_name,
        registration_number: input.ngo_profile.registration_number,
        operational_radius_km: input.ngo_profile.operational_radius_km,
        has_cold_storage: input.ngo_profile.has_cold_storage,
        daily_capacity_kg: input.ngo_profile.daily_capacity_kg,
        latitude: input.ngo_profile.latitude,
        longitude: input.ngo_profile.longitude,
        verification_status: 'PENDING', // Strict: always PENDING on registration
        address: input.ngo_profile.address ?? null,
        contact_person: input.ngo_profile.contact_person ?? null,
        contact_phone: input.ngo_profile.contact_phone ?? null,
      };

            const { data: ngoProfile, error: profileError } = await (adminSupabase as any)
        .from('ngo_profiles')
        .insert(ngoInsert)
        .select('id, organization_name, registration_number, operational_radius_km, has_cold_storage, daily_capacity_kg, latitude, longitude, verification_status, address, contact_person, contact_phone, created_at')
        .single();

      if (profileError) {
        return errorResponse(
          'User registered, but failed to create NGO profile.',
          500,
          { code: (profileError as { code?: string }).code }
        );
      }
      profileData = ngoProfile;
    }

    // 4. Return sanitized response
    return successResponse(
      {
        user: {
          id: createdAuthUser.id,
          email: createdAuthUser.email,
          full_name: input.full_name,
          phone: input.phone || null,
          role: input.role,
          status: input.role === 'NGO' ? 'PENDING' : 'ACTIVE',
        },
        profile: profileData,
      },
      'User registered successfully',
      201
    );
  } catch (err) {
    return errorResponse(
      'An unexpected error occurred during registration',
      500,
      { details: err instanceof Error ? err.message : 'Unknown error' }
    );
  }
}
