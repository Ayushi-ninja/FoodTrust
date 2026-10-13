/**
 * app/api/pickups/[id]/generate-otp/route.ts
 * FoodTrust — Phase 8: Pickup & Fulfillment Workflow
 *
 * REST Endpoint for generating/viewing the 6-digit handoff OTP:
 * - POST /api/pickups/[id]/generate-otp
 * STRICTLY restricted to the DONOR owner of the donation or Admin.
 * NGO representatives can NEVER call this endpoint.
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth/rbac';
import { getOrGeneratePickupOtp } from '@/lib/services/pickup.service';
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

    const pickupId = params.id;
    if (!pickupId) {
      return errorResponse('Pickup ID is required.', 400);
    }

    const clientIp = request.headers.get('x-forwarded-for') || undefined;
    const result = await getOrGeneratePickupOtp(pickupId, user, clientIp);

    if (!result.success || !result.otp) {
      return errorResponse(
        result.error || 'Failed to generate OTP.',
        result.statusCode || 400
      );
    }

    return successResponse(
      {
        otp: result.otp,
        expiresAt: result.expiresAt,
      },
      'Handoff OTP generated successfully. Share this 6-digit code with the collecting NGO volunteer upon physical handover.',
      200
    );
  } catch (err) {
    return errorResponse(
      'An unexpected error occurred while generating handoff OTP.',
      500,
      { details: err instanceof Error ? err.message : 'Unknown error' }
    );
  }
}
