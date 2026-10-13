/**
 * app/api/donors/profile/route.ts
 * FoodTrust — Phase 2: Auth, RBAC & Profiles
 *
 * Current authenticated donor's profile endpoint.
 *
 * SECURITY:
 * - Restricted to users with the 'DONOR' role (HTTP 403 for others, 401 for unauthenticated).
 * - Mutation (PATCH) strictly operates on the authenticated user's profile.
 * - Prevents Insecure Direct Object References (IDOR).
 */

import { NextRequest } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/auth/rbac';
import { updateDonorProfileSchema } from '@/lib/validation/auth.schema';
import { successResponse, errorResponse } from '@/lib/utils/api-response';
import type { Database } from '@/types/database.types';

type DonorUpdate = Database['public']['Tables']['donor_profiles']['Update'];

const DONOR_PROFILE_SELECT =
  'id, user_id, business_name, establishment_type, fssai_license, address, latitude, longitude, contact_person, created_at, updated_at';

export async function GET() {
  try {
    const auth = await requireRole('DONOR');
    if (auth.errorResponse) {
      return auth.errorResponse;
    }

        const supabase = createServerClient() as any;
    const { data: profile, error } = await supabase
      .from('donor_profiles')
      .select(DONOR_PROFILE_SELECT)
      .eq('user_id', auth.user.id)
      .single();

    if (error || !profile) {
      return errorResponse('Donor profile not found', 404, { code: 'PROFILE_NOT_FOUND' });
    }

    return successResponse(profile, 'Donor profile retrieved successfully', 200);
  } catch (err) {
    return errorResponse(
      'An unexpected error occurred while fetching donor profile',
      500,
      { details: err instanceof Error ? err.message : 'Unknown error' }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const auth = await requireRole('DONOR');
    if (auth.errorResponse) {
      return auth.errorResponse;
    }

    const rawBody = await request.json().catch(() => null);
    if (!rawBody) {
      return errorResponse('Invalid JSON request body', 400);
    }

    // 1. Validate payload with Zod
    const parseResult = updateDonorProfileSchema.safeParse(rawBody);
    if (!parseResult.success) {
      return errorResponse(
        'Validation failed for donor profile update',
        400,
        parseResult.error.flatten().fieldErrors
      );
    }

    const updates: DonorUpdate = parseResult.data;

    // Disallow empty update
    if (Object.keys(updates).length === 0) {
      return errorResponse('No valid profile update fields provided', 400);
    }

    // 2. Perform update under RLS
        const supabase = createServerClient() as any;
    const { data: updatedProfile, error } = await supabase
      .from('donor_profiles')
      .update(updates)
      .eq('user_id', auth.user.id)
      .select(DONOR_PROFILE_SELECT)
      .single();

    if (error) {
      return errorResponse(
        'Failed to update donor profile',
        500,
        { code: (error as { code?: string }).code }
      );
    }

    return successResponse(updatedProfile, 'Donor profile updated successfully', 200);
  } catch (err) {
    return errorResponse(
      'An unexpected error occurred while updating donor profile',
      500,
      { details: err instanceof Error ? err.message : 'Unknown error' }
    );
  }
}
