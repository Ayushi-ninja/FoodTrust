/**
 * app/api/matching/ngos/route.ts
 * FoodTrust — Phase 5: Smart NGO Matching Engine
 *
 * Primary matching endpoint: returns ranked NGO match recommendations for a donation.
 *
 * SUPPORTED METHODS:
 * - GET: /api/matching/ngos?donationId=<uuid>&limit=<number>
 *
 * SECURITY & RBAC RULES:
 * 1. Requires active authenticated session (requireAuth).
 * 2. Authorization / IDOR Protection:
 *    - DONOR: Must be the owner of the specified donation.
 *    - ADMIN / SUPER_ADMIN: Can request matches for any donation.
 *    - NGO: Returns 403 Forbidden (NGOs cannot query matching engine on other donors' behalf).
 * 3. READ-ONLY CONTRACT:
 *    - This endpoint produces ZERO write side-effects.
 *    - No claim, no reservation, no pickup, no notification is created.
 */

import { NextRequest } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireAuth } from '@/lib/auth/rbac';
import { matchingQuerySchema } from '@/lib/validation/matching.schema';
import { matchNgosForDonation } from '@/lib/services/ngo-matching.service';
import { successResponse, errorResponse } from '@/lib/utils/api-response';

type AnyClient = { from: (table: string) => Record<string, Function> };

export async function GET(request: NextRequest) {
  try {
    // 1. Authenticate human user
    const authResult = await requireAuth();
    if (authResult.errorResponse) {
      return authResult.errorResponse;
    }
    const user = authResult.user;

    // 2. Parse and validate query parameters
    const url = new URL(request.url);
    const rawQuery = {
      donationId: url.searchParams.get('donationId'),
      limit: url.searchParams.get('limit') || undefined,
    };

    const parseResult = matchingQuerySchema.safeParse(rawQuery);
    if (!parseResult.success) {
      return errorResponse(
        'Validation failed for matching query parameters.',
        400,
        parseResult.error.flatten().fieldErrors
      );
    }
    const { donationId, limit } = parseResult.data;

    // 3. IDOR & Ownership Verification
    const supabase = createServerClient() as unknown as AnyClient;

    const { data: donationData, error: donationError } = await supabase
      .from('food_donations')
      .select(`
        id,
        donor_id,
        status,
        donor_profiles (
          id,
          user_id
        )
      `)
      .eq('id', donationId)
      .single();

    if (donationError || !donationData) {
      return errorResponse('Food donation not found.', 404, {
        code: 'DONATION_NOT_FOUND',
      });
    }

    const donation = donationData as {
      id: string;
      donor_id: string;
      status: string;
      donor_profiles: {
        id: string;
        user_id: string;
      };
    };

    const donorUserId = donation.donor_profiles?.user_id;
    const isOwner = donorUserId === user.id;
    const isAdmin = user.role === 'ADMIN' || user.role === 'SUPER_ADMIN';

    if (!isOwner && !isAdmin) {
      return errorResponse(
        'Forbidden: You do not have permission to view matching candidates for this donation.',
        403,
        { code: 'IDOR_PREVENTED' }
      );
    }

    // 4. Execute matching engine
    const matchResult = await matchNgosForDonation(donationId, limit);

    return successResponse(
      matchResult,
      `Matched ${matchResult.matchesCount} eligible NGO candidates for donation`,
      200
    );
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    if (errorMessage.includes('not eligible for NGO matching')) {
      return errorResponse(errorMessage, 400, { code: 'DONATION_NOT_ELIGIBLE_FOR_MATCHING' });
    }
    return errorResponse(
      'An unexpected error occurred during NGO matching.',
      500,
      { details: errorMessage }
    );
  }
}
