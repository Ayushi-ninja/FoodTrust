/**
 * app/api/pickups/[id]/complete/route.ts
 * FoodTrust — Phase 8: Pickup & Fulfillment Workflow
 *
 * REST Endpoint for completing delivery:
 * - POST /api/pickups/[id]/complete
 * Permitted caller: Collecting NGO representative or Admin.
 * Accepts optional proof_image_url pointing to the proof-photos storage bucket.
 * Transitions pickup and donation status to DELIVERED.
 * Automatically computes and persists UNEP/FAO impact metrics in impact_metrics.
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth/rbac';
import { completeDeliverySchema } from '@/lib/validation/pickup.schema';
import { completePickupDelivery } from '@/lib/services/pickup.service';
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

    const parseResult = completeDeliverySchema.safeParse(rawBody);
    if (!parseResult.success) {
      return errorResponse(
        'Validation failed for delivery completion.',
        422,
        parseResult.error.flatten().fieldErrors
      );
    }

    const clientIp = request.headers.get('x-forwarded-for') || undefined;
    const result = await completePickupDelivery({
      pickupId,
      actor: user,
      proofImageUrl: parseResult.data.proofImageUrl,
      ipAddress: clientIp,
    });

    if (!result.success || !result.pickup) {
      return errorResponse(
        result.error || 'Failed to complete delivery.',
        result.statusCode || 400
      );
    }

    const sanitizedPickup = { ...result.pickup };
    delete (sanitizedPickup as any).otp_code_hash;

    return successResponse(
      {
        pickup: sanitizedPickup,
        donation: result.donation,
        impactMetrics: result.impactMetrics,
      },
      'Delivery completed successfully. Food redistribution logged and impact metrics recorded.',
      200
    );
  } catch (err) {
    return errorResponse(
      'An unexpected error occurred during delivery completion.',
      500,
      { details: err instanceof Error ? err.message : 'Unknown error' }
    );
  }
}
