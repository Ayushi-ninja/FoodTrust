/**
 * app/api/donations/[id]/freshness/route.ts
 * FoodTrust — Phase 6: Food Donation Lifecycle Management
 *
 * Returns the current freshness breakdown for a specific donation.
 * Access: owner donor, admin, or NGO (if AVAILABLE or NGO has an active claim).
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth/rbac';
import { getAdminSupabase } from '@/lib/supabase/admin';
import { evaluateFreshness, FRESHNESS_CONSTANTS } from '@/lib/services/freshness.service';
import { successResponse, errorResponse } from '@/lib/utils/api-response';
import type { FoodCategory } from '@/types/database.types';

interface RouteContext {
  params: { id: string };
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const authResult = await requireAuth();
    if (authResult.errorResponse) {
      return authResult.errorResponse;
    }
    const user = authResult.user;

    const donationId = params.id;
    if (!donationId) {
      return errorResponse('Donation ID is required.', 400);
    }

    const adminSupabase = getAdminSupabase();
    const queryClient = adminSupabase as unknown as {
      from: (table: string) => Record<string, Function>;
    };

    // 1. Fetch the donation
    const { data: donation, error: donationError } = await (queryClient
      .from('food_donations')
      .select('*')
      .eq('id', donationId)
      .single() as Promise<{ data: Record<string, unknown> | null; error: unknown }>);

    if (donationError || !donation) {
      return errorResponse('Donation not found.', 404);
    }

    // 2. IDOR Protection
    const isAdmin = user.role === 'ADMIN' || user.role === 'SUPER_ADMIN';

    if (!isAdmin) {
      let allowed = false;

      if (user.role === 'DONOR') {
        const { data: donorProfile } = await (queryClient
          .from('donor_profiles')
          .select('id')
          .eq('user_id', user.id)
          .single() as Promise<{ data: Record<string, unknown> | null; error: unknown }>);

        if (donorProfile && donorProfile.id === donation.donor_id) {
          allowed = true;
        }
      } else if (user.role === 'NGO') {
        if (donation.status === 'AVAILABLE') {
          allowed = true;
        } else {
          const { data: ngoProfile } = await (queryClient
            .from('ngo_profiles')
            .select('id')
            .eq('user_id', user.id)
            .single() as Promise<{ data: Record<string, unknown> | null; error: unknown }>);

          if (ngoProfile) {
            const { data: claim } = await (queryClient
              .from('donation_claims')
              .select('id')
              .eq('donation_id', donationId)
              .eq('ngo_id', ngoProfile.id)
              .limit(1)
              .single() as Promise<{ data: Record<string, unknown> | null; error: unknown }>);

            if (claim) allowed = true;
          }
        }
      }

      if (!allowed) {
        return errorResponse('Forbidden: You are not authorized to view this donation freshness.', 403);
      }
    }

    // 3. Fetch latest persisted freshness log (if any)
    const { data: latestLog } = await (queryClient
      .from('freshness_logs')
      .select('*')
      .eq('donation_id', donationId)
      .order('evaluated_at', { ascending: false })
      .limit(1)
      .single() as Promise<{ data: Record<string, unknown> | null; error: unknown }>);

    // 4. Compute live estimate
    const preparedAt =
      (donation.preparation_timestamp as string | null) ||
      (donation.created_at as string);
    const foodCategory = donation.food_category as FoodCategory;

    const temperatureC =
      latestLog && typeof latestLog.temperature_c === 'number'
        ? Number(latestLog.temperature_c)
        : 22.0;
    const humidityPct =
      latestLog && typeof latestLog.humidity_pct === 'number'
        ? Number(latestLog.humidity_pct)
        : 55.0;
    const vocGasPpm =
      latestLog && typeof latestLog.gas_reading_ppm === 'number'
        ? Number(latestLog.gas_reading_ppm)
        : 50.0;

    const liveEvaluation = evaluateFreshness({
      foodCategory,
      preparationTimestamp: preparedAt,
      temperatureC,
      humidityPct,
      vocGasPpm,
    });

    return successResponse(
      {
        donationId,
        liveEstimate: {
          freshnessScore: liveEvaluation.freshnessScore,
          freshnessStatus: liveEvaluation.freshnessStatus,
          riskLevel: liveEvaluation.riskLevel,
          estimatedShelfLifeHours: liveEvaluation.estimatedShelfLifeHours,
          elapsedHours: liveEvaluation.elapsedHours,
          evaluatedAt: new Date().toISOString(),
          sensorTelemetry: {
            temperatureC,
            humidityPct,
            vocGasPpm,
            source: latestLog ? 'sensor_telemetry' : 'ambient_defaults',
          },
        },
        lastPersistedLog: latestLog
          ? {
              id: latestLog.id,
              freshnessScore: latestLog.evaluated_score,
              freshnessStatus: latestLog.freshness_status,
              riskLevel: latestLog.risk_level,
              shelfLifeHoursRemaining: latestLog.shelf_life_hours,
              evaluatedAt: latestLog.evaluated_at,
            }
          : null,
        disclaimer: FRESHNESS_CONSTANTS.COMPLIANCE_DISCLAIMER,
      },
      'Freshness evaluation retrieved successfully.',
      200
    );
  } catch (err) {
    return errorResponse(
      'An unexpected error occurred while retrieving freshness evaluation.',
      500,
      { details: err instanceof Error ? err.message : 'Unknown error' }
    );
  }
}
