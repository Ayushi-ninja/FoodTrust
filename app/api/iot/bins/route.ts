/**
 * app/api/iot/bins/route.ts
 * FoodTrust — Phase 3: IoT Device Authentication & Telemetry
 *
 * Human-authenticated endpoint to list smart bins and their operational status.
 *
 * SECURITY & RBAC RULES:
 * - Requires authenticated session (requireAuth).
 * - DONOR: Can only view smart bins registered under their donor_profile.
 * - ADMIN / SUPER_ADMIN: Can view all smart bins in the system.
 * - NGO / OTHER: Returns 403 Forbidden (NGOs do not manage physical bin hardware).
 * - SENSITIVE DATA LEAKAGE PREVENTION:
 *   api_key_hash is NEVER returned in the response under any circumstance!
 */

import { createServerClient } from '@/lib/supabase/server';
import { requireAuth } from '@/lib/auth/rbac';
import { successResponse, errorResponse } from '@/lib/utils/api-response';

type AnyClient = { from: (table: string) => Record<string, Function> };

const SAFE_BIN_FIELDS =
  'id, bin_code, donor_id, status, firmware_version, last_heartbeat_at, location_note, created_at, updated_at';

export async function GET() {
  try {
    // 1. Authenticate human user session
    const authResult = await requireAuth();
    if (authResult.errorResponse) {
      return authResult.errorResponse;
    }
    const user = authResult.user;

    const supabase = createServerClient() as unknown as AnyClient;

    // 2. Role-based query filtering
    if (user.role === 'DONOR') {
      // Find donor profile id for current user
      const { data: donorProfile, error: donorError } = await supabase
        .from('donor_profiles')
        .select('id')
        .eq('user_id', user.id)
        .single();

      if (donorError || !donorProfile) {
        return errorResponse('Donor profile not found for current session.', 404, {
          code: 'DONOR_PROFILE_NOT_FOUND',
        });
      }

      const donorId = (donorProfile as { id: string }).id;

      // Query bins owned by this donor (with their food trays)
      const { data: bins, error: binsError } = await supabase
        .from('smart_bins')
        .select(`
          ${SAFE_BIN_FIELDS},
          food_trays (
            id,
            tray_number,
            assigned_category,
            current_weight_kg,
            tare_weight_kg,
            last_calibrated_at,
            updated_at
          )
        `)
        .eq('donor_id', donorId)
        .order('created_at', { ascending: false });

      if (binsError) {
        return errorResponse('Failed to retrieve donor smart bins.', 500, {
          code: (binsError as { code?: string }).code,
        });
      }

      return successResponse(bins || [], 'Smart bins retrieved successfully', 200);
    } else if (user.role === 'ADMIN' || user.role === 'SUPER_ADMIN') {
      // Admins see all bins across all donors
      const { data: bins, error: binsError } = await supabase
        .from('smart_bins')
        .select(`
          ${SAFE_BIN_FIELDS},
          donor_profiles (
            id,
            business_name
          ),
          food_trays (
            id,
            tray_number,
            assigned_category,
            current_weight_kg,
            tare_weight_kg,
            last_calibrated_at
          )
        `)
        .order('created_at', { ascending: false });

      if (binsError) {
        return errorResponse('Failed to retrieve system smart bins.', 500, {
          code: (binsError as { code?: string }).code,
        });
      }

      return successResponse(bins || [], 'All system smart bins retrieved', 200);
    } else {
      // NGO or DEVICE cannot list smart bins
      return errorResponse(
        'Forbidden: Only donors and system administrators can view smart bin hardware.',
        403,
        { code: 'ACCESS_DENIED' }
      );
    }
  } catch (err) {
    return errorResponse(
      'An unexpected error occurred while fetching smart bins.',
      500,
      { details: err instanceof Error ? err.message : 'Unknown error' }
    );
  }
}
