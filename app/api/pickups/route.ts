/**
 * app/api/pickups/route.ts
 * FoodTrust — Phase 8: Pickup & Fulfillment Workflow
 *
 * REST Endpoints for pickups:
 * - GET: List pickups according to caller role (NGO, Donor, Admin).
 * - POST: Schedule/create a pickup for a claimed donation (NGO or Admin).
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth/rbac';
import {
  createPickupSchema,
  listPickupsQuerySchema,
} from '@/lib/validation/pickup.schema';
import { createPickup, listPickups } from '@/lib/services/pickup.service';
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

    const parseResult = listPickupsQuerySchema.safeParse(rawQuery);
    if (!parseResult.success) {
      return errorResponse(
        'Validation failed for pickups query filters.',
        400,
        parseResult.error.flatten().fieldErrors
      );
    }

    const { status, donationId, limit, offset } = parseResult.data;

    const result = await listPickups({
      actor: user,
      status,
      donationId,
      limit,
      offset,
    });

    if (!result.success) {
      return errorResponse(result.error || 'Failed to list pickups.', result.statusCode || 400);
    }

    return successResponse(
      {
        pickups: result.pickups,
        count: result.count,
        offset: result.offset,
        limit: result.limit,
      },
      'Pickups retrieved successfully',
      200
    );
  } catch (err) {
    return errorResponse(
      'An unexpected error occurred while listing pickups.',
      500,
      { details: err instanceof Error ? err.message : 'Unknown error' }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth();
    if (authResult.errorResponse) {
      return authResult.errorResponse;
    }
    const user = authResult.user;

    let rawBody = {};
    const text = await request.text().catch(() => '');
    if (text && text.trim().length > 0) {
      try {
        rawBody = JSON.parse(text);
      } catch {
        return errorResponse('Invalid JSON request body.', 400);
      }
    }

    const parseResult = createPickupSchema.safeParse(rawBody);
    if (!parseResult.success) {
      return errorResponse(
        'Validation failed for pickup scheduling.',
        422,
        parseResult.error.flatten().fieldErrors
      );
    }

    const clientIp = request.headers.get('x-forwarded-for') || undefined;
    const result = await createPickup({
      donationId: parseResult.data.donationId,
      actor: user,
      assignedVolunteer: parseResult.data.assignedVolunteer,
      volunteerPhone: parseResult.data.volunteerPhone,
      scheduledAt: parseResult.data.scheduledAt,
      ipAddress: clientIp,
    });

    if (!result.success || !result.pickup) {
      return errorResponse(
        result.error || 'Failed to schedule pickup.',
        result.statusCode || 400
      );
    }

    // Never return raw OTP to the NGO caller
    const sanitizedPickup = { ...result.pickup };
    delete (sanitizedPickup as any).otp_code_hash;

    return successResponse(
      {
        pickup: sanitizedPickup,
        donation: result.donation,
      },
      'Pickup scheduled successfully. Donation in transit preparation.',
      201
    );
  } catch (err) {
    return errorResponse(
      'An unexpected error occurred during pickup creation.',
      500,
      { details: err instanceof Error ? err.message : 'Unknown error' }
    );
  }
}
