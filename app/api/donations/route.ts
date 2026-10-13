/**
 * app/api/donations/route.ts
 * FoodTrust — Phase 6: Food Donation Lifecycle Management
 *
 * REST Endpoints for Food Donations:
 * - GET: List active/available donations with bounded pagination and safe filters.
 * - POST: Submit a new food donation (strictly for authenticated DONOR users).
 */

import { NextRequest } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireAuth } from '@/lib/auth/rbac';
import {
  createDonationSchema,
  listDonationQuerySchema,
} from '@/lib/validation/donation.schema';
import { createFoodDonation } from '@/lib/services/donation.service';
import { successResponse, errorResponse } from '@/lib/utils/api-response';
import type { FoodDonation } from '@/types/database.types';

type AnyClient = { from: (table: string) => Record<string, Function> };

export async function GET(request: NextRequest) {
  try {
    // 1. Authenticate human user
    const authResult = await requireAuth();
    if (authResult.errorResponse) {
      return authResult.errorResponse;
    }
    const user = authResult.user;

    // 2. Parse query parameters
    const url = new URL(request.url);
    const rawQuery = {
      status: url.searchParams.get('status') || undefined,
      category: url.searchParams.get('category') || undefined,
      limit: url.searchParams.get('limit') || undefined,
      offset: url.searchParams.get('offset') || undefined,
    };

    const parseResult = listDonationQuerySchema.safeParse(rawQuery);
    if (!parseResult.success) {
      return errorResponse(
        'Validation failed for donation query filters.',
        400,
        parseResult.error.flatten().fieldErrors
      );
    }
    const { status, category, limit, offset } = parseResult.data;

    // 3. Role-Aware Query Filtering
    const supabase = createServerClient() as unknown as AnyClient;
    let query = supabase.from('food_donations').select('*');

    if (user.role === 'DONOR') {
      // Donors see all of their own donations, or filter by status
      const { data: donorProfile } = await supabase
        .from('donor_profiles')
        .select('id')
        .eq('user_id', user.id)
        .single();

      if (donorProfile) {
        const donorId = (donorProfile as { id: string }).id;
        query = query.eq('donor_id', donorId);
      }
    } else if (user.role === 'NGO') {
      // NGOs see all AVAILABLE donations in the public distribution pool
      query = query.eq('status', status || 'AVAILABLE');
    }

    if (status && user.role !== 'NGO') {
      query = query.eq('status', status);
    }
    if (category) {
      query = query.eq('food_category', category);
    }

    query = query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    const { data: donations, error } = await query;

    if (error) {
      return errorResponse('Failed to retrieve food donations.', 500, {
        code: (error as { code?: string }).code,
      });
    }

    return successResponse(
      {
        donations: (donations || []) as FoodDonation[],
        count: (donations || []).length,
        offset,
        limit,
      },
      'Food donations retrieved successfully',
      200
    );
  } catch (err) {
    return errorResponse(
      'An unexpected error occurred while listing food donations.',
      500,
      { details: err instanceof Error ? err.message : 'Unknown error' }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    // 1. Authenticate human user
    const authResult = await requireAuth();
    if (authResult.errorResponse) {
      return authResult.errorResponse;
    }
    const user = authResult.user;

    // 2. Parse request JSON body
    const rawBody = await request.json().catch(() => null);
    if (!rawBody) {
      return errorResponse('Invalid JSON request body.', 400);
    }

    // 3. Validate payload with Zod
    const parseResult = createDonationSchema.safeParse(rawBody);
    if (!parseResult.success) {
      return errorResponse(
        'Validation failed for donation creation.',
        400,
        parseResult.error.flatten().fieldErrors
      );
    }

    // 4. Delegate to centralized creation service
    const clientIp = request.headers.get('x-forwarded-for') || undefined;
    const result = await createFoodDonation(parseResult.data, user, clientIp);

    if (!result.success || !result.donation) {
      return errorResponse(
        result.error || 'Failed to create donation.',
        result.statusCode || 400
      );
    }

    return successResponse(
      result.donation,
      'Food donation created successfully',
      201
    );
  } catch (err) {
    return errorResponse(
      'An unexpected error occurred during donation submission.',
      500,
      { details: err instanceof Error ? err.message : 'Unknown error' }
    );
  }
}
