/**
 * app/api/donors/[id]/route.ts
 * FoodTrust — Phase 2: Auth, RBAC & Profiles
 *
 * Parametric donor profile endpoint.
 *
 * SECURITY:
 * - GET: Requires authenticated user.
 * - PATCH: Strict IDOR prevention. A donor can only mutate their OWN profile.
 *   Modifying another donor's record returns HTTP 403 Forbidden.
 */

import { NextRequest } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireAuth } from '@/lib/auth/rbac';
import { updateDonorProfileSchema } from '@/lib/validation/auth.schema';
import { successResponse, errorResponse } from '@/lib/utils/api-response';
import type { Database } from '@/types/database.types';

type DonorUpdate = Database['public']['Tables']['donor_profiles']['Update'];
type AnyClient = { from: (table: string) => Record<string, Function> };

interface RouteContext {
  params: { id: string };
}

const DONOR_SELECT =
  'id, user_id, business_name, establishment_type, fssai_license, address, latitude, longitude, contact_person, created_at, updated_at';

export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const auth = await requireAuth();
    if (auth.errorResponse) return auth.errorResponse;

    const { id } = params;
    const supabase = createServerClient() as unknown as AnyClient;

    const { data: donorProfile, error } = await supabase
      .from('donor_profiles')
      .select(DONOR_SELECT)
      .eq('id', id)
      .single();

    if (error || !donorProfile) {
      return errorResponse('Donor profile not found', 404, { code: 'PROFILE_NOT_FOUND' });
    }

    return successResponse(donorProfile, 'Donor profile retrieved', 200);
  } catch (err) {
    return errorResponse('Unexpected error fetching donor profile', 500, {
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
      .from('donor_profiles')
      .select('id, user_id')
      .eq('id', id)
      .single();

    if (fetchError || !existing) {
      return errorResponse('Donor profile not found', 404, { code: 'PROFILE_NOT_FOUND' });
    }

    // 2. IDOR protection — owner or admin only
    const owner = (existing as { user_id: string }).user_id;
    const isOwner = owner === auth.user.id;
    const isAdmin = auth.user.role === 'ADMIN' || auth.user.role === 'SUPER_ADMIN';

    if (!isOwner && !isAdmin) {
      return errorResponse(
        'Forbidden: You may not modify another donor profile',
        403,
        { code: 'IDOR_PREVENTED' }
      );
    }

    // 3. Validate payload
    const rawBody = await request.json().catch(() => null);
    if (!rawBody) return errorResponse('Invalid JSON request body', 400);

    const parseResult = updateDonorProfileSchema.safeParse(rawBody);
    if (!parseResult.success) {
      return errorResponse('Validation failed', 400, parseResult.error.flatten().fieldErrors);
    }

    const updates: DonorUpdate = parseResult.data;
    if (Object.keys(updates).length === 0) {
      return errorResponse('No valid update fields provided', 400);
    }

    // 4. Apply update
    const { data: updated, error: updateError } = await supabase
      .from('donor_profiles')
      .update(updates)
      .eq('id', id)
      .select(DONOR_SELECT)
      .single();

    if (updateError) {
      return errorResponse('Failed to update donor profile', 500, {
        code: (updateError as { code?: string }).code,
      });
    }

    return successResponse(updated, 'Donor profile updated', 200);
  } catch (err) {
    return errorResponse('Unexpected error updating donor profile', 500, {
      details: err instanceof Error ? err.message : 'Unknown',
    });
  }
}
