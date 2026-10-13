/**
 * app/api/donations/[id]/transition/route.ts
 * FoodTrust — Phase 6: Food Donation Lifecycle Management
 *
 * Admin/SUPER_ADMIN-only endpoint for explicit status transitions.
 * Donors and NGOs must NOT use this endpoint for arbitrary state changes.
 * Donor-initiated cancellation goes through /api/donations/[id]/cancel.
 */

import { NextRequest } from 'next/server';
import { requireAnyRole } from '@/lib/auth/rbac';
import { transitionDonationStatus } from '@/lib/services/donation-lifecycle.service';
import { transitionDonationSchema } from '@/lib/validation/donation.schema';
import { successResponse, errorResponse } from '@/lib/utils/api-response';

interface RouteContext {
  params: { id: string };
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    // 1. Restrict to ADMIN / SUPER_ADMIN only
    const authResult = await requireAnyRole(['ADMIN', 'SUPER_ADMIN']);
    if (authResult.errorResponse) {
      return authResult.errorResponse;
    }
    const user = authResult.user;

    const donationId = params.id;
    if (!donationId) {
      return errorResponse('Donation ID is required.', 400);
    }

    // 2. Parse body
    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return errorResponse('Invalid JSON body.', 400);
    }

    const parseResult = transitionDonationSchema.safeParse(rawBody);
    if (!parseResult.success) {
      return errorResponse(
        'Validation failed for transition request.',
        422,
        parseResult.error.flatten().fieldErrors
      );
    }

    // 3. Delegate to lifecycle service (handles OCC + audit)
    const clientIp = request.headers.get('x-forwarded-for') || undefined;
    const result = await transitionDonationStatus({
      donationId,
      targetStatus: parseResult.data.targetStatus,
      actor: user,
      reason: parseResult.data.reason,
      ipAddress: clientIp,
    });

    if (!result.success || !result.donation) {
      return errorResponse(
        result.error || 'Transition failed.',
        result.statusCode || 400
      );
    }

    return successResponse(
      {
        donation: result.donation,
        previousStatus: result.previousStatus,
        newStatus: result.newStatus,
      },
      'Donation status transitioned successfully.',
      200
    );
  } catch (err) {
    return errorResponse(
      'An unexpected error occurred during status transition.',
      500,
      { details: err instanceof Error ? err.message : 'Unknown error' }
    );
  }
}
