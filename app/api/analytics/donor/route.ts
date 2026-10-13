/**
 * app/api/analytics/donor/route.ts
 * GET /api/analytics/donor
 * Auth: DONOR role only
 */

import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/rbac';
import { getDonorAnalytics } from '@/lib/services/analytics.service';
import { getAdminSupabase } from '@/lib/supabase/admin';
import { successResponse, errorResponse } from '@/lib/utils/api-response';

export async function GET(): Promise<NextResponse> {
  const { user, errorResponse: authErr } = await requireRole('DONOR');
  if (authErr) return authErr;

  try {
    // Resolve donor profile id
    const adminSupabase = getAdminSupabase() as unknown as {
      from: (table: string) => Record<string, Function>;
    };
    const { data: profile, error: profileErr } = await (adminSupabase
      .from('donor_profiles')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle() as unknown as Promise<{
      data: { id: string } | null;
      error: { message: string } | null;
    }>);

    if (profileErr || !profile) {
      return errorResponse('Donor profile not found.', 404);
    }

    const analytics = await getDonorAnalytics(profile.id);
    return successResponse(analytics, 'Donor analytics retrieved successfully.');
  } catch (err) {
    console.error('[analytics/donor] Error:', err);
    return errorResponse('Failed to retrieve donor analytics.', 500);
  }
}
