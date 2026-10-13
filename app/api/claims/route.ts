/**
 * app/api/claims/route.ts
 * FoodTrust — Phase 7: NGO Claim Management
 *
 * REST Endpoint for listing claims:
 * - GET /api/claims
 * Returns claims scoped by role:
 * - NGO: sees its own claims
 * - DONOR: sees claims on its own donations
 * - ADMIN: sees all claims
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth/rbac';
import { listClaimsQuerySchema } from '@/lib/validation/claim.schema';
import { listClaims } from '@/lib/services/donation-claim.service';
import { successResponse, errorResponse } from '@/lib/utils/api-response';

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth();
    if (authResult.errorResponse) {
      return authResult.errorResponse;
    }
    const user = authResult.user;

    const url = new URL(request.url);
    const rawQuery = {
      status: url.searchParams.get('status') || undefined,
      donationId: url.searchParams.get('donationId') || undefined,
      limit: url.searchParams.get('limit') || undefined,
      offset: url.searchParams.get('offset') || undefined,
    };

    const parseResult = listClaimsQuerySchema.safeParse(rawQuery);
    if (!parseResult.success) {
      return errorResponse(
        'Validation failed for claims query filters.',
        400,
        parseResult.error.flatten().fieldErrors
      );
    }

    const { status, donationId, limit, offset } = parseResult.data;

    const result = await listClaims({
      actor: user,
      status,
      donationId,
      limit,
      offset,
    });

    if (!result.success) {
      return errorResponse(result.error || 'Failed to list claims.', result.statusCode || 400);
    }

    return successResponse(
      {
        claims: result.claims,
        count: result.count,
        offset: result.offset,
        limit: result.limit,
      },
      'Claims retrieved successfully',
      200
    );
  } catch (err) {
    return errorResponse(
      'An unexpected error occurred while listing claims.',
      500,
      { details: err instanceof Error ? err.message : 'Unknown error' }
    );
  }
}
