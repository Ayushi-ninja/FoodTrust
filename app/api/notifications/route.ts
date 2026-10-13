/**
 * app/api/notifications/route.ts
 * GET /api/notifications — List own notifications
 * Auth: any authenticated user
 */

import { type NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/rbac';
import { listNotifications } from '@/lib/services/notification.service';
import { listNotificationsQuerySchema } from '@/lib/validation/notification.schema';
import { successResponse, errorResponse } from '@/lib/utils/api-response';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { user, errorResponse: authErr } = await requireAuth();
  if (authErr) return authErr;

  const rawParams = Object.fromEntries(req.nextUrl.searchParams.entries());
  const parsed = listNotificationsQuerySchema.safeParse(rawParams);
  if (!parsed.success) {
    return errorResponse('Invalid query parameters.', 400, parsed.error.flatten());
  }

  try {
    const result = await listNotifications(user.id, parsed.data);
    return successResponse(result, 'Notifications retrieved successfully.');
  } catch (err) {
    console.error('[notifications] GET Error:', err);
    return errorResponse('Failed to retrieve notifications.', 500);
  }
}
