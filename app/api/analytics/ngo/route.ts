/**
 * app/api/analytics/ngo/route.ts
 * GET /api/analytics/ngo
 * Auth: NGO role only
 */

import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/rbac';
import { getNgoAnalytics } from '@/lib/services/analytics.service';
import { getAdminSupabase } from '@/lib/supabase/admin';
import { successResponse, errorResponse } from '@/lib/utils/api-response';

export async function GET(): Promise<NextResponse> {
  const { user, errorResponse: authErr } = await requireRole('NGO');
  if (authErr) return authErr;

  try {
    const adminSupabase = getAdminSupabase() as unknown as {
      from: (table: string) => Record<string, Function>;
    };
    const { data: profile, error: profileErr } = await (adminSupabase
      .from('ngo_profiles')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle() as unknown as Promise<{
      data: { id: string } | null;
      error: { message: string } | null;
    }>);

    if (profileErr || !profile) {
      return errorResponse('NGO profile not found.', 404);
    }

    const analytics = await getNgoAnalytics(profile.id);
    return successResponse(analytics, 'NGO analytics retrieved successfully.');
  } catch (err) {
    console.error('[analytics/ngo] Error:', err);
    return errorResponse('Failed to retrieve NGO analytics.', 500);
  }
}
