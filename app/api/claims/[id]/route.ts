/**
 * app/api/claims/[id]/route.ts
 * FoodTrust — Phase 7: NGO Claim Management
 *
 * REST Endpoint for viewing a single claim:
 * - GET /api/claims/[id]
 * Enforces IDOR protection: NGO owner, Donor owner, or Admin only.
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth/rbac';
import { getClaimById } from '@/lib/services/donation-claim.service';
import { successResponse, errorResponse } from '@/lib/utils/api-response';

interface RouteContext {
  params: {
    id: string;
  };
}

export async function GET(request: NextRequest, { params }: RouteContext) {
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

    const result = await getClaimById(claimId, user);

    if (!result.success || !result.claim) {
      return errorResponse(result.error || 'Claim not found.', result.statusCode || 404);
    }

    return successResponse(result.claim, 'Claim retrieved successfully', 200);
  } catch (err) {
    return errorResponse(
      'An unexpected error occurred while retrieving claim.',
      500,
      { details: err instanceof Error ? err.message : 'Unknown error' }
    );
  }
}
