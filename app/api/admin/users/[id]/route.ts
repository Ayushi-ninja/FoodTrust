/**
 * app/api/admin/users/[id]/route.ts
 * PATCH /api/admin/users/[id] — Update user status or role
 * Auth: ADMIN or SUPER_ADMIN
 *
 * Business rules enforced in admin.service.ts:
 * - Cannot self-suspend
 * - Cannot assign SUPER_ADMIN role
 * - Cannot suspend last active SUPER_ADMIN
 * - Only SUPER_ADMIN can downgrade another SUPER_ADMIN
 */

import { type NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/rbac';
import { updateUserStatus } from '@/lib/services/admin.service';
import { updateUserBodySchema } from '@/lib/validation/admin.schema';
import { successResponse, errorResponse } from '@/lib/utils/api-response';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const { user, errorResponse: authErr } = await requireRole('ADMIN');
  if (authErr) return authErr;

  const { id: targetUserId } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorResponse('Request body must be valid JSON.', 400);
  }

  const parsed = updateUserBodySchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse('Invalid request body.', 400, parsed.error.flatten());
  }

  try {
    const updatedUser = await updateUserStatus(
      targetUserId,
      user.id,
      user.role,
      parsed.data
    );
    return successResponse(updatedUser, 'User updated successfully.');
  } catch (err: unknown) {
    const statusCode = (err as { statusCode?: number }).statusCode;
    const message = (err as { message?: string }).message ?? 'Failed to update user.';

    if (statusCode === 404) return errorResponse(message, 404);
    if (statusCode === 403) return errorResponse(message, 403);
    if (statusCode === 409) return errorResponse(message, 409);

    console.error('[admin/users/[id]] PATCH Error:', err);
    return errorResponse('Failed to update user.', 500);
  }
}
