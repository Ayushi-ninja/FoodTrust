/**
 * app/api/claims/[id]/reject/route.ts
 * FoodTrust — Phase 7: NGO Claim Management
 *
 * REST Endpoint for rejecting an active donation claim:
 * - POST /api/claims/[id]/reject
 * Permitted actors: Donor owner of the donation or Admin.
 * Reverts the associated food donation back to 'AVAILABLE'.
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth/rbac';
import { rejectClaimSchema } from '@/lib/validation/claim.schema';
import { rejectDonationClaim } from '@/lib/services/donation-claim.service';
import { successResponse, errorResponse } from '@/lib/utils/api-response';

interface RouteContext {
  params: {
    id: string;
  };
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const authResult = await requireAuth();
    if (authResult.errorResponse) {
      return authResult.errorResponse;
    }
    const user = authResult.user;

    const claimId = params.id;
    if (!claimId) {
      return errorResponse('Claim ID is required.', 400);
    }

    let rawBody = {};
    const text = await request.text().catch(() => '');
    if (text && text.trim().length > 0) {
      try {
        rawBody = JSON.parse(text);
      } catch {
        return errorResponse('Invalid JSON request body.', 400);
      }
    }

    const parseResult = rejectClaimSchema.safeParse(rawBody);
    if (!parseResult.success) {
      return errorResponse(
        'Validation failed for claim rejection.',
        422,
        parseResult.error.flatten().fieldErrors
      );
    }

    const clientIp = request.headers.get('x-forwarded-for') || undefined;
    const result = await rejectDonationClaim(
      claimId,
      user,
      parseResult.data.reason,
      clientIp
    );

    if (!result.success || !result.claim) {
      return errorResponse(
        result.error || 'Failed to reject claim.',
        result.statusCode || 400
      );
    }

    return successResponse(
      {
        claim: result.claim,
        donation: result.donation,
      },
      'Donation claim rejected successfully. Donation released back to AVAILABLE.',
      200
    );
  } catch (err) {
    return errorResponse(
      'An unexpected error occurred during claim rejection.',
      500,
      { details: err instanceof Error ? err.message : 'Unknown error' }
    );
  }
}
