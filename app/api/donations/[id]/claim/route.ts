/**
 * app/api/donations/[id]/claim/route.ts
 * FoodTrust — Phase 7: NGO Claim Management
 *
 * REST Endpoint for claiming a food donation:
 * - POST /api/donations/[id]/claim
 * Strictly for authenticated, verified NGOs.
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth/rbac';
import { createClaimSchema } from '@/lib/validation/claim.schema';
import { createDonationClaim } from '@/lib/services/donation-claim.service';
import { successResponse, errorResponse } from '@/lib/utils/api-response';

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

    const donationId = params.id;
    if (!donationId) {
      return errorResponse('Donation ID is required.', 400);
    }

    // 2. Parse optional request body
    let rawBody = {};
    const text = await request.text().catch(() => '');
    if (text && text.trim().length > 0) {
      try {
        rawBody = JSON.parse(text);
      } catch {
        return errorResponse('Invalid JSON request body.', 400);
      }
    }

    const parseResult = createClaimSchema.safeParse(rawBody);
    if (!parseResult.success) {
      return errorResponse(
        'Validation failed for claim submission.',
        422,
        parseResult.error.flatten().fieldErrors
      );
    }

    // 3. Delegate to centralized atomic claim service
    const clientIp = request.headers.get('x-forwarded-for') || undefined;
    const result = await createDonationClaim({
      donationId,
      actor: user,
      notes: parseResult.data.notes,
      ipAddress: clientIp,
    });

    if (!result.success || !result.claim) {
      return errorResponse(
        result.error || 'Failed to claim food donation.',
        result.statusCode || 400
      );
    }

    return successResponse(
      {
        claim: result.claim,
        donation: result.donation,
      },
      'Food donation claimed successfully.',
      201
    );
  } catch (err) {
    return errorResponse(
      'An unexpected error occurred during donation claim submission.',
      500,
      { details: err instanceof Error ? err.message : 'Unknown error' }
    );
  }
}
