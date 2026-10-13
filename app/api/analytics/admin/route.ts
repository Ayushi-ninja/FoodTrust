/**
 * app/api/analytics/admin/route.ts
 * GET /api/analytics/admin
 * Auth: ADMIN or SUPER_ADMIN
 */

import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/rbac';
import { getAdminAnalytics } from '@/lib/services/analytics.service';
import { successResponse, errorResponse } from '@/lib/utils/api-response';

export async function GET(): Promise<NextResponse> {
  const { errorResponse: authErr } = await requireRole('ADMIN');
  if (authErr) return authErr;

  try {
    const analytics = await getAdminAnalytics();
    return successResponse(analytics, 'Admin analytics retrieved successfully.');
  } catch (err) {
    console.error('[analytics/admin] Error:', err);
    return errorResponse('Failed to retrieve admin analytics.', 500);
  }
}
