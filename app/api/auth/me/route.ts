/**
 * app/api/auth/me/route.ts
 * FoodTrust — Phase 2: Auth, RBAC & Profiles
 *
 * Current authenticated user profile endpoint.
 *
 * SECURITY:
 * - Requires an active authenticated session (HTTP 401 if unauthenticated).
 * - Excludes sensitive internal fields (passwords, tokens, device api_key_hashes).
 * - Returns linked donor_profiles or ngo_profiles based on authoritative database role.
 */

import { createServerClient } from '@/lib/supabase/server';
import { requireAuth } from '@/lib/auth/rbac';
import { successResponse, errorResponse } from '@/lib/utils/api-response';

export async function GET() {
  try {
    const auth = await requireAuth();
    if (auth.errorResponse) {
      return auth.errorResponse;
    }

    const { user } = auth;
    const supabase = createServerClient();

    let profile: unknown = null;

    if (user.role === 'DONOR') {
      const { data: donorProfile } = await supabase
        .from('donor_profiles')
        .select('id, business_name, establishment_type, fssai_license, address, latitude, longitude, contact_person, created_at, updated_at')
        .eq('user_id', user.id)
        .single();

      profile = donorProfile || null;
    } else if (user.role === 'NGO') {
      const { data: ngoProfile } = await supabase
        .from('ngo_profiles')
        .select('id, organization_name, registration_number, operational_radius_km, has_cold_storage, daily_capacity_kg, latitude, longitude, verification_status, address, contact_person, contact_phone, created_at, updated_at')
        .eq('user_id', user.id)
        .single();

      profile = ngoProfile || null;
    }

    return successResponse(
      {
        user: {
          id: user.id,
          email: user.email,
          phone: user.phone,
          full_name: user.full_name,
          role: user.role,
          status: user.status,
          created_at: user.created_at,
          updated_at: user.updated_at,
        },
        profile,
      },
      'User session resolved successfully',
      200
    );
  } catch (err) {
    return errorResponse(
      'An unexpected error occurred while resolving user session',
      500,
      { details: err instanceof Error ? err.message : 'Unknown error' }
    );
  }
}
