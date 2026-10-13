/**
 * app/api/pickups/[id]/route.ts
 * FoodTrust — Phase 8: Pickup & Fulfillment Workflow
 *
 * REST Endpoint for viewing a single pickup:
 * - GET /api/pickups/[id]
 * Enforces IDOR protection: Assigned NGO, Donor owner, or Admin only.
 * OTP hash is NEVER exposed in the response.
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth/rbac';
import { getPickupById } from '@/lib/services/pickup.service';
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

    const pickupId = params.id;
    if (!pickupId) {
      return errorResponse('Pickup ID is required.', 400);
    }

    const result = await getPickupById(pickupId, user);

    if (!result.success || !result.pickup) {
      return errorResponse(result.error || 'Pickup not found.', result.statusCode || 404);
    }

    return successResponse(result.pickup, 'Pickup retrieved successfully', 200);
  } catch (err) {
    return errorResponse(
      'An unexpected error occurred while retrieving pickup.',
      500,
      { details: err instanceof Error ? err.message : 'Unknown error' }
    );
  }
}
