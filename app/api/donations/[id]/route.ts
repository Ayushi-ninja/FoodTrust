/**
 * app/api/donations/[id]/route.ts
 * FoodTrust — Phase 6: Food Donation Lifecycle Management
 *
 * REST Endpoints for Individual Food Donation:
 * - GET: Retrieve donation details, freshness status, and metadata.
 * - PATCH: Update editable fields (owner donor or admin only, strictly while in AVAILABLE status).
 */

import { NextRequest } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireAuth } from '@/lib/auth/rbac';
import { updateDonationSchema } from '@/lib/validation/donation.schema';
import { updateFoodDonation } from '@/lib/services/donation.service';
import { successResponse, errorResponse } from '@/lib/utils/api-response';
import type { FoodDonation } from '@/types/database.types';

type AnyClient = { from: (table: string) => Record<string, Function> };

interface RouteContext {
  params: {
    id: string;
  };
}

export async function GET(request: NextRequest, { params }: RouteContext) {
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

    // 2. Fetch donation details
    const supabase = createServerClient() as unknown as AnyClient;
    const { data: donationData, error } = await supabase
      .from('food_donations')
      .select(`
        *,
        donor_profiles (
          id,
          business_name,
          user_id
        )
      `)
      .eq('id', donationId)
      .single();

    if (error || !donationData) {
      return errorResponse('Food donation not found.', 404, {
        code: 'DONATION_NOT_FOUND',
      });
    }

    const donation = donationData as FoodDonation & {
      donor_profiles: { id: string; business_name: string; user_id: string };
    };

    // 3. IDOR / Access Control Check
    const isOwner = donation.donor_profiles?.user_id === user.id;
    const isAdmin = user.role === 'ADMIN' || user.role === 'SUPER_ADMIN';
    const isAvailableToNgo = user.role === 'NGO' && donation.status === 'AVAILABLE';

    if (!isOwner && !isAdmin && !isAvailableToNgo) {
      return errorResponse(
        'Forbidden: You do not have permission to view this donation record.',
        403,
        { code: 'IDOR_PREVENTED' }
      );
    }

    return successResponse(
      donation,
      'Food donation retrieved successfully',
      200
    );
  } catch (err) {
    return errorResponse(
      'An unexpected error occurred while retrieving food donation.',
      500,
      { details: err instanceof Error ? err.message : 'Unknown error' }
    );
  }
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
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

    // 2. Parse request JSON body
    const rawBody = await request.json().catch(() => null);
    if (!rawBody) {
      return errorResponse('Invalid JSON request body.', 400);
    }

    // 3. Reject forbidden status / freshness manipulations via PATCH!
    if ('status' in rawBody) {
      return errorResponse(
        "Forbidden: Donation status cannot be modified via PATCH. Use the dedicated '/api/donations/[id]/transition' or '/api/donations/[id]/cancel' endpoints.",
        403,
        { code: 'DIRECT_STATUS_MUTATION_FORBIDDEN' }
      );
    }

    if (
      'freshness_score' in rawBody ||
      'freshnessScore' in rawBody ||
      'freshness_status' in rawBody ||
      'risk_level' in rawBody
    ) {
      return errorResponse(
        "Forbidden: Freshness parameters cannot be client-overwritten. Use the '/api/freshness/evaluate' service.",
        403,
        { code: 'DIRECT_FRESHNESS_MUTATION_FORBIDDEN' }
      );
    }

    if ('donor_id' in rawBody || 'donorId' in rawBody) {
      return errorResponse(
        'Forbidden: Donor ownership cannot be transferred.',
        403,
        { code: 'DONOR_ID_IMMUTABLE' }
      );
    }

    // 4. Validate allowed updates with Zod
    const parseResult = updateDonationSchema.safeParse(rawBody);
    if (!parseResult.success) {
      return errorResponse(
        'Validation failed for donation update.',
        400,
        parseResult.error.flatten().fieldErrors
      );
    }

    // 5. Delegate to centralized service
    const clientIp = request.headers.get('x-forwarded-for') || undefined;
    const result = await updateFoodDonation(donationId, parseResult.data, user, clientIp);

    if (!result.success || !result.donation) {
      return errorResponse(
        result.error || 'Failed to update donation.',
        result.statusCode || 400
      );
    }

    return successResponse(
      result.donation,
      'Food donation updated successfully',
      200
    );
  } catch (err) {
    return errorResponse(
      'An unexpected error occurred during donation update.',
      500,
      { details: err instanceof Error ? err.message : 'Unknown error' }
    );
  }
}
