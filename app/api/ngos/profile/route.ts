/**
 * app/api/ngos/profile/route.ts
 * FoodTrust — Phase 2: Auth, RBAC & Profiles
 *
 * Current authenticated NGO organization profile endpoint.
 *
 * SECURITY:
 * - Restricted to users with the 'NGO' role.
 * - Prevents modification of 'verification_status' or 'user_id'.
 * - Operates strictly on the authenticated session's NGO record.
 */

import { NextRequest } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/auth/rbac';
import { updateNgoProfileSchema } from '@/lib/validation/auth.schema';
import { successResponse, errorResponse } from '@/lib/utils/api-response';
import type { Database } from '@/types/database.types';

type NgoUpdate = Database['public']['Tables']['ngo_profiles']['Update'];

const NGO_PROFILE_SELECT =
  'id, user_id, organization_name, registration_number, operational_radius_km, has_cold_storage, daily_capacity_kg, latitude, longitude, verification_status, address, contact_person, contact_phone, created_at, updated_at';

export async function GET() {
  try {
    const auth = await requireRole('NGO');
    if (auth.errorResponse) {
      return auth.errorResponse;
    }

        const supabase = createServerClient() as any;
    const { data: profile, error } = await supabase
      .from('ngo_profiles')
      .select(NGO_PROFILE_SELECT)
      .eq('user_id', auth.user.id)
      .single();

    if (error || !profile) {
      return errorResponse('NGO profile not found', 404, { code: 'PROFILE_NOT_FOUND' });
    }

    return successResponse(profile, 'NGO profile retrieved successfully', 200);
  } catch (err) {
    return errorResponse(
      'An unexpected error occurred while fetching NGO profile',
      500,
      { details: err instanceof Error ? err.message : 'Unknown error' }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const auth = await requireRole('NGO');
    if (auth.errorResponse) {
      return auth.errorResponse;
    }

    const rawBody = await request.json().catch(() => null);
    if (!rawBody) {
      return errorResponse('Invalid JSON request body', 400);
    }

    // 1. Explicit protection against privilege escalation:
    // Disallow any attempt by an NGO to self-verify
    if ('verification_status' in rawBody || 'verificationStatus' in rawBody) {
      return errorResponse(
        'Forbidden: Verification status can only be modified by a system administrator',
        403,
        { code: 'VERIFICATION_TAMPERING_REJECTED' }
      );
    }

    // 2. Validate update payload with Zod
    const parseResult = updateNgoProfileSchema.safeParse(rawBody);
    if (!parseResult.success) {
      return errorResponse(
        'Validation failed for NGO profile update',
        400,
        parseResult.error.flatten().fieldErrors
      );
    }

    const updates: NgoUpdate = parseResult.data;
    if (Object.keys(updates).length === 0) {
      return errorResponse('No valid profile update fields provided', 400);
    }

    // 3. Update the record under RLS
        const supabase = createServerClient() as any;
    const { data: updatedProfile, error } = await supabase
      .from('ngo_profiles')
      .update(updates)
      .eq('user_id', auth.user.id)
      .select(NGO_PROFILE_SELECT)
      .single();

    if (error) {
      return errorResponse('Failed to update NGO profile', 500, {
        code: (error as { code?: string }).code,
      });
    }

    return successResponse(updatedProfile, 'NGO profile updated successfully', 200);
  } catch (err) {
    return errorResponse(
      'An unexpected error occurred while updating NGO profile',
      500,
      { details: err instanceof Error ? err.message : 'Unknown error' }
    );
  }
}
