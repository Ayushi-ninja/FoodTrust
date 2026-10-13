/**
 * app/api/analytics/overview/route.ts
 * GET /api/analytics/overview
 * Auth: any authenticated user (DONOR, NGO, ADMIN, SUPER_ADMIN)
 */

import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/rbac';
import { getOverviewAnalytics } from '@/lib/services/analytics.service';
import { successResponse, errorResponse } from '@/lib/utils/api-response';

export async function GET(): Promise<NextResponse> {
  const { user, errorResponse: authErr } = await requireAuth();
  if (authErr) return authErr;

  // DEVICE role should not access analytics
  if (user.role === 'DEVICE') {
    return errorResponse('Forbidden: DEVICE role cannot access analytics.', 403);
  }

  try {
    const analytics = await getOverviewAnalytics();
    return successResponse(analytics, 'Overview analytics retrieved successfully.');
  } catch (err) {
    console.error('[analytics/overview] Error:', err);
    return errorResponse('Failed to retrieve overview analytics.', 500);
  }
}
