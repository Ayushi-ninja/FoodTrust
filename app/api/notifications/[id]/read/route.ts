/**
 * app/api/notifications/[id]/read/route.ts
 * PATCH /api/notifications/[id]/read — Mark a single notification as read
 * Auth: any authenticated user (IDOR-protected in service)
 */

import { type NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/rbac';
import { markNotificationRead } from '@/lib/services/notification.service';
import { successResponse, errorResponse } from '@/lib/utils/api-response';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const { user, errorResponse: authErr } = await requireAuth();
  if (authErr) return authErr;

  const { id } = await params;

  if (!id) {
    return errorResponse('Notification ID is required.', 400);
  }

  try {
    const notification = await markNotificationRead(id, user.id);
    return successResponse(notification, 'Notification marked as read.');
  } catch (err: unknown) {
    const statusCode = (err as { statusCode?: number }).statusCode;
    if (statusCode === 404) {
      return errorResponse('Notification not found or access denied.', 404);
    }
    console.error('[notifications/[id]/read] PATCH Error:', err);
    return errorResponse('Failed to mark notification as read.', 500);
  }
}
