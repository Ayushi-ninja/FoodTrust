/**
 * app/api/pickups/[id]/verify-otp/route.ts
 * FoodTrust — Phase 8: Pickup & Fulfillment Workflow
 *
 * REST Endpoint for verifying physical collection OTP:
 * - POST /api/pickups/[id]/verify-otp
 * Permitted caller: Collecting NGO representative or Admin.
 * Enforces maximum 3 attempts before locking.
 * Transitions pickup and donation status to PICKED_UP.
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth/rbac';
import { verifyOtpSchema } from '@/lib/validation/pickup.schema';
import { verifyPickupOtp } from '@/lib/services/pickup.service';
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

    let rawBody = {};
    const text = await request.text().catch(() => '');
    if (text && text.trim().length > 0) {
      try {
        rawBody = JSON.parse(text);
      } catch {
        return errorResponse('Invalid JSON request body.', 400);
      }
    }

    const parseResult = verifyOtpSchema.safeParse(rawBody);
    if (!parseResult.success) {
      return errorResponse(
        'Validation failed for OTP verification.',
        422,
        parseResult.error.flatten().fieldErrors
      );
    }

    const clientIp = request.headers.get('x-forwarded-for') || undefined;
    const result = await verifyPickupOtp({
      pickupId,
      actor: user,
      otpCode: parseResult.data.otpCode,
      ipAddress: clientIp,
    });

    if (!result.success || !result.pickup) {
      return errorResponse(
        result.error || 'OTP verification failed.',
        result.statusCode || 401
      );
    }

    const sanitizedPickup = { ...result.pickup };
    delete (sanitizedPickup as any).otp_code_hash;

    return successResponse(
      {
        pickup: sanitizedPickup,
        donation: result.donation,
      },
      'Handoff OTP verified successfully. Food collection confirmed and in transit.',
      200
    );
  } catch (err) {
    return errorResponse(
      'An unexpected error occurred during OTP verification.',
      500,
      { details: err instanceof Error ? err.message : 'Unknown error' }
    );
  }
}
