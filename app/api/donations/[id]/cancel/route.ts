/**
 * app/api/donations/[id]/cancel/route.ts
 * FoodTrust — Phase 6: Food Donation Lifecycle Management
 *
 * Dedicated endpoint to cancel an eligible food donation.
 * Transitions donation status to CANCELLED atomically via donation-lifecycle.service.
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth/rbac';
import { cancelDonationSchema } from '@/lib/validation/donation.schema';
import { transitionDonationStatus } from '@/lib/services/donation-lifecycle.service';
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

    // 2. Parse optional reason
    let rawBody = {};
    const text = await request.text().catch(() => '');
    if (text && text.trim().length > 0) {
      try {
        rawBody = JSON.parse(text);
      } catch {
        return errorResponse('Invalid JSON body in cancel request.', 400);
      }
    }

    const parseResult = cancelDonationSchema.safeParse(rawBody);
    if (!parseResult.success) {
      return errorResponse(
        'Validation failed for cancellation request.',
        400,
        parseResult.error.flatten().fieldErrors
      );
    }

    // 3. Delegate to lifecycle service for atomic state transition
    const clientIp = request.headers.get('x-forwarded-for') || undefined;
    const result = await transitionDonationStatus({
      donationId,
      targetStatus: 'CANCELLED',
      actor: user,
      reason: parseResult.data.reason,
      ipAddress: clientIp,
    });

    if (!result.success || !result.donation) {
      return errorResponse(
        result.error || 'Failed to cancel donation.',
        result.statusCode || 400
      );
    }

    return successResponse(
      result.donation,
      'Food donation cancelled successfully',
      200
    );
  } catch (err) {
    return errorResponse(
      'An unexpected error occurred during donation cancellation.',
      500,
      { details: err instanceof Error ? err.message : 'Unknown error' }
    );
  }
}
