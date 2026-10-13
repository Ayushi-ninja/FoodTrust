/**
 * app/api/iot/trays/[id]/tare/route.ts
 * FoodTrust — Phase 3: IoT Device Authentication & Telemetry
 *
 * Human-authenticated endpoint to record tare weight calibration for a food tray.
 *
 * WORKFLOW & PERMISSIONS:
 * 1. Requires authenticated session (requireAuth).
 * 2. Authorization:
 *    - The donor who owns the bin containing this tray
 *    - ADMIN or SUPER_ADMIN
 * 3. Validates tare weight with Zod (non-negative, realistic tray weight <= 50 kg).
 * 4. Updates food_trays:
 *    - tare_weight_kg = new value
 *    - last_calibrated_at = NOW()
 *    - updated_at = NOW()
 * 5. Returns updated tray object.
 *
 * IDOR DEFENSE:
 * Traverses food_trays -> smart_bins -> donor_profiles -> user_id to ensure
 * an unauthorized donor cannot tare another donor's tray.
 */

import { NextRequest } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireAuth } from '@/lib/auth/rbac';
import { trayTareSchema } from '@/lib/validation/iot.schema';
import { successResponse, errorResponse } from '@/lib/utils/api-response';

type AnyClient = { from: (table: string) => Record<string, Function> };

interface RouteContext {
  params: {
    id: string;
  };
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    // 1. Authenticate human user
    const authResult = await requireAuth();
    if (authResult.errorResponse) {
      return authResult.errorResponse;
    }
    const user = authResult.user;

    const trayId = params.id;
    if (!trayId) {
      return errorResponse('Tray ID is required.', 400);
    }

    // 2. Validate input payload
    const rawBody = await request.json().catch(() => null);
    if (!rawBody) {
      return errorResponse('Invalid JSON request body.', 400);
    }

    const parseResult = trayTareSchema.safeParse(rawBody);
    if (!parseResult.success) {
      return errorResponse(
        'Validation failed for tare calibration.',
        400,
        parseResult.error.flatten().fieldErrors
      );
    }
    const { tareWeightKg } = parseResult.data;

    // 3. Resolve tray and verify ownership
    const supabase = createServerClient() as unknown as AnyClient;

    const { data: trayData, error: trayError } = await supabase
      .from('food_trays')
      .select(`
        id,
        tray_number,
        assigned_category,
        current_weight_kg,
        tare_weight_kg,
        last_calibrated_at,
        smart_bins (
          id,
          bin_code,
          donor_id,
          donor_profiles (
            id,
            user_id
          )
        )
      `)
      .eq('id', trayId)
      .single();

    if (trayError || !trayData) {
      return errorResponse('Food tray not found.', 404, { code: 'TRAY_NOT_FOUND' });
    }

    const tray = trayData as {
      id: string;
      tray_number: number;
      assigned_category: string;
      current_weight_kg: number;
      tare_weight_kg: number;
      smart_bins: {
        id: string;
        bin_code: string;
        donor_id: string;
        donor_profiles: {
          id: string;
          user_id: string;
        };
      };
    };

    // 4. Verify IDOR protection: Owner or Admin only
    const trayOwnerUserId = tray.smart_bins?.donor_profiles?.user_id;
    const isOwner = trayOwnerUserId === user.id;
    const isAdmin = user.role === 'ADMIN' || user.role === 'SUPER_ADMIN';

    if (!isOwner && !isAdmin) {
      return errorResponse(
        'Forbidden: You do not have permission to calibrate a tray belonging to another donor.',
        403,
        { code: 'IDOR_PREVENTED' }
      );
    }

    // 5. Update tare calibration on the tray
    const calibratedAt = new Date().toISOString();

    const { data: updatedTray, error: updateError } = await supabase
      .from('food_trays')
      .update({
        tare_weight_kg: tareWeightKg,
        last_calibrated_at: calibratedAt,
        updated_at: calibratedAt,
      })
      .eq('id', trayId)
      .select('id, bin_id, tray_number, assigned_category, current_weight_kg, tare_weight_kg, last_calibrated_at, updated_at')
      .single();

    if (updateError) {
      return errorResponse('Failed to update tray tare calibration.', 500, {
        code: (updateError as { code?: string }).code,
      });
    }

    return successResponse(
      updatedTray,
      `Tray ${tray.tray_number} tare weight calibrated to ${tareWeightKg} kg`,
      200
    );
  } catch (err) {
    return errorResponse(
      'An unexpected error occurred during tray tare calibration.',
      500,
      { details: err instanceof Error ? err.message : 'Unknown error' }
    );
  }
}
