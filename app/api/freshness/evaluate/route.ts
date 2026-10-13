/**
 * app/api/freshness/evaluate/route.ts
 * FoodTrust — Phase 4: Freshness Assessment & Spoilage Kinetic Service
 *
 * Route Handler to evaluate food freshness scores and persistence.
 *
 * PERMISSIONS & SECURITY:
 * - Requires authenticated session (requireAuth).
 * - If donationId is supplied:
 *   - Fetches donation record.
 *   - Verifies ownership / RBAC:
 *     - DONOR: Must be the owner of the donation.
 *     - NGO: Must have an active claim or pickup on the donation.
 *     - ADMIN / SUPER_ADMIN: Can evaluate any donation.
 *   - Updates food_donations freshness fields.
 *   - Appends snapshot to public.freshness_logs.
 * - If donationId is omitted (ad-hoc / standalone calculation):
 *   - Evaluates input parameters and returns the decision-support breakdown.
 * - Returns uniform API envelope with mandatory compliance disclaimer.
 */

import { NextRequest } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { getAdminSupabase } from '@/lib/supabase/admin';
import { requireAuth } from '@/lib/auth/rbac';
import { freshnessEvaluateSchema } from '@/lib/validation/freshness.schema';
import { evaluateFreshness } from '@/lib/services/freshness.service';
import { successResponse, errorResponse } from '@/lib/utils/api-response';
import type { Database } from '@/types/database.types';

type AnyClient = { from: (table: string) => Record<string, Function> };
type FreshnessLogInsert = Database['public']['Tables']['freshness_logs']['Insert'];

export async function POST(request: NextRequest) {
  try {
    // 1. Authenticate human user session
    const authResult = await requireAuth();
    if (authResult.errorResponse) {
      return authResult.errorResponse;
    }
    const user = authResult.user;

    // 2. Parse request JSON body
    const rawBody = await request.json().catch(() => null);
    if (!rawBody) {
      return errorResponse('Invalid JSON request body.', 400);
    }

    // 3. Validate input with Zod
    const parseResult = freshnessEvaluateSchema.safeParse(rawBody);
    if (!parseResult.success) {
      return errorResponse(
        'Validation failed for freshness evaluation input.',
        400,
        parseResult.error.flatten().fieldErrors
      );
    }
    const input = parseResult.data;

    // 4. Compute deterministic freshness evaluation
    let evaluation;
    try {
      evaluation = evaluateFreshness({
        foodCategory: input.foodCategory,
        preparationTimestamp: input.preparationTimestamp,
        evaluationTimestamp: input.evaluationTimestamp,
        temperatureC: input.temperatureC,
        humidityPct: input.humidityPct,
        vocGasPpm: input.vocGasPpm,
      });
    } catch (evalErr) {
      return errorResponse(
        evalErr instanceof Error ? evalErr.message : 'Freshness evaluation failed.',
        400,
        { code: 'CALCULATION_ERROR' }
      );
    }

    // 5. If linked to an existing donation, perform authorization and persistence
    let persistedLogId: number | null = null;
    let updatedDonation: unknown = null;

    if (input.donationId) {
      const supabase = createServerClient() as unknown as AnyClient;
      const adminSupabase = getAdminSupabase() as unknown as AnyClient;

      // 5.1 Fetch target donation to verify ownership
      const { data: donationData, error: donationError } = await supabase
        .from('food_donations')
        .select(`
          id,
          donor_id,
          title,
          food_category,
          status,
          donor_profiles (
            id,
            user_id
          )
        `)
        .eq('id', input.donationId)
        .single();

      if (donationError || !donationData) {
        return errorResponse('Donation record not found.', 404, {
          code: 'DONATION_NOT_FOUND',
        });
      }

      const donation = donationData as {
        id: string;
        donor_id: string;
        title: string;
        food_category: string;
        status: string;
        donor_profiles: {
          id: string;
          user_id: string;
        };
      };

      // 5.2 Verify Authorization / IDOR Protection
      const donorUserId = donation.donor_profiles?.user_id;
      const isOwner = donorUserId === user.id;
      const isAdmin = user.role === 'ADMIN' || user.role === 'SUPER_ADMIN';

      // Check if user is an authorized NGO with an active claim
      let isClaimingNgo = false;
      if (user.role === 'NGO') {
        const { data: ngoProfile } = await supabase
          .from('ngo_profiles')
          .select('id')
          .eq('user_id', user.id)
          .single();

        if (ngoProfile) {
          const ngoId = (ngoProfile as { id: string }).id;
          const { data: claim } = await supabase
            .from('donation_claims')
            .select('id')
            .eq('donation_id', input.donationId)
            .eq('ngo_id', ngoId)
            .single();

          if (claim) {
            isClaimingNgo = true;
          }
        }
      }

      if (!isOwner && !isAdmin && !isClaimingNgo) {
        return errorResponse(
          'Forbidden: You do not have permission to evaluate this donation record.',
          403,
          { code: 'IDOR_PREVENTED' }
        );
      }

      // 5.3 Update food_donations record with latest freshness indicators
      const { data: updatedDonationData, error: updateDonationError } =
        await adminSupabase
          .from('food_donations')
          .update({
            freshness_score: evaluation.freshnessScore,
            freshness_status: evaluation.freshnessStatus,
            risk_level: evaluation.riskLevel,
            shelf_life_hours_remaining: evaluation.estimatedShelfLifeHours,
            updated_at: new Date().toISOString(),
          })
          .eq('id', input.donationId)
          .select(
            'id, title, food_category, freshness_score, freshness_status, risk_level, shelf_life_hours_remaining, status, updated_at'
          )
          .single();

      if (updateDonationError) {
        return errorResponse(
          'Failed to update donation freshness state.',
          500,
          { code: (updateDonationError as { code?: string }).code }
        );
      }
      updatedDonation = updatedDonationData;

      // 5.4 Persist snapshot to public.freshness_logs if requested
      if (input.persistLog !== false) {
        const logPayload: FreshnessLogInsert = {
          donation_id: input.donationId,
          evaluated_score: evaluation.freshnessScore,
          freshness_status: evaluation.freshnessStatus,
          risk_level: evaluation.riskLevel,
          shelf_life_hours: evaluation.estimatedShelfLifeHours,
          gas_reading_ppm: evaluation.vocGasPpm,
          temperature_c: evaluation.temperatureC,
          humidity_pct: evaluation.humidityPct,
          evaluated_at: new Date().toISOString(),
        };

        const { data: logData, error: logError } = await adminSupabase
          .from('freshness_logs')
          .insert(logPayload)
          .select('id')
          .single();

        if (logError) {
          // Non-blocking log persistence failure
          console.error('Failed to append to freshness_logs:', logError);
        } else if (logData) {
          persistedLogId = (logData as { id: number }).id;
        }
      }
    }

    return successResponse(
      {
        evaluation,
        donation: updatedDonation,
        persistedLogId,
      },
      'Freshness evaluation calculated successfully',
      200
    );
  } catch (err) {
    return errorResponse(
      'An unexpected error occurred during freshness assessment.',
      500,
      { details: err instanceof Error ? err.message : 'Unknown error' }
    );
  }
}
