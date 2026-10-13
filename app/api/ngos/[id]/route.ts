/**
 * app/api/ngos/[id]/route.ts
 * FoodTrust — Phase 2: Auth, RBAC & Profiles
 *
 * Parametric NGO organization profile endpoint.
 *
 * SECURITY:
 * - GET: Requires authenticated user.
 * - PATCH: Strict IDOR prevention. An NGO user can only update their own profile.
 * - Modifying 'verification_status' by an NGO is strictly rejected (HTTP 403).
 */

import { NextRequest } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireAuth } from '@/lib/auth/rbac';
import { updateNgoProfileSchema } from '@/lib/validation/auth.schema';
import { successResponse, errorResponse } from '@/lib/utils/api-response';
import type { Database } from '@/types/database.types';

type NgoUpdate = Database['public']['Tables']['ngo_profiles']['Update'];
type AnyClient = { from: (table: string) => Record<string, Function> };

interface RouteContext {
  params: { id: string };
}

const NGO_SELECT =
  'id, user_id, organization_name, registration_number, operational_radius_km, has_cold_storage, daily_capacity_kg, latitude, longitude, verification_status, address, contact_person, contact_phone, created_at, updated_at';

export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const auth = await requireAuth();
    if (auth.errorResponse) return auth.errorResponse;

    const { id } = params;
    const supabase = createServerClient() as unknown as AnyClient;

    const { data: ngoProfile, error } = await supabase
      .from('ngo_profiles')
      .select(NGO_SELECT)
      .eq('id', id)
      .single();

    if (error || !ngoProfile) {
      return errorResponse('NGO profile not found', 404, { code: 'PROFILE_NOT_FOUND' });
    }

    return successResponse(ngoProfile, 'NGO profile retrieved', 200);
  } catch (err) {
    return errorResponse('Unexpected error fetching NGO profile', 500, {
      details: err instanceof Error ? err.message : 'Unknown',
    });
  }
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const auth = await requireAuth();
    if (auth.errorResponse) return auth.errorResponse;

    const { id } = params;
    const supabase = createServerClient() as unknown as AnyClient;

    // 1. Fetch target profile to verify ownership
    const { data: existing, error: fetchError } = await supabase
      .from('ngo_profiles')
      .select('id, user_id')
      .eq('id', id)
      .single();

    if (fetchError || !existing) {
      return errorResponse('NGO profile not found', 404, { code: 'PROFILE_NOT_FOUND' });
    }

    // 2. IDOR check — owner or admin only
    const owner = (existing as { user_id: string }).user_id;
    const isOwner = owner === auth.user.id;
    const isAdmin = auth.user.role === 'ADMIN' || auth.user.role === 'SUPER_ADMIN';

    if (!isOwner && !isAdmin) {
      return errorResponse(
        'Forbidden: You may not modify another NGO profile',
        403,
        { code: 'IDOR_PREVENTED' }
      );
    }

    const rawBody = await request.json().catch(() => null);
    if (!rawBody) return errorResponse('Invalid JSON request body', 400);

    // 3. Prevent privilege escalation — NGOs cannot self-verify
    if (!isAdmin && ('verification_status' in rawBody || 'verificationStatus' in rawBody)) {
      return errorResponse(
        'Forbidden: Only administrators can modify NGO verification status',
        403,
        { code: 'VERIFICATION_MODIFICATION_FORBIDDEN' }
      );
    }

    // 4. Validate payload
    const parseResult = updateNgoProfileSchema.safeParse(rawBody);
    if (!parseResult.success) {
      return errorResponse('Validation failed', 400, parseResult.error.flatten().fieldErrors);
    }

    const updates: NgoUpdate = parseResult.data;
    if (Object.keys(updates).length === 0) {
      return errorResponse('No valid update fields provided', 400);
    }

    // 5. Apply update
    const { data: updated, error: updateError } = await supabase
      .from('ngo_profiles')
      .update(updates)
      .eq('id', id)
      .select(NGO_SELECT)
      .single();

    if (updateError) {
      return errorResponse('Failed to update NGO profile', 500, {
        code: (updateError as { code?: string }).code,
      });
    }

    return successResponse(updated, 'NGO profile updated', 200);
  } catch (err) {
    return errorResponse('Unexpected error updating NGO profile', 500, {
      details: err instanceof Error ? err.message : 'Unknown',
    });
  }
}
