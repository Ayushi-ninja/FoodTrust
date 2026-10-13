/**
 * app/api/admin/users/route.ts
 * GET /api/admin/users — List all users
 * Auth: ADMIN or SUPER_ADMIN
 */

import { type NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/rbac';
import { listUsers } from '@/lib/services/admin.service';
import { listUsersQuerySchema } from '@/lib/validation/admin.schema';
import { successResponse, errorResponse } from '@/lib/utils/api-response';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { errorResponse: authErr } = await requireRole('ADMIN');
  if (authErr) return authErr;

  const rawParams = Object.fromEntries(req.nextUrl.searchParams.entries());
  const parsed = listUsersQuerySchema.safeParse(rawParams);
  if (!parsed.success) {
    return errorResponse('Invalid query parameters.', 400, parsed.error.flatten());
  }

  try {
    const result = await listUsers(parsed.data);
    return successResponse(result, 'Users retrieved successfully.');
  } catch (err) {
    console.error('[admin/users] GET Error:', err);
    return errorResponse('Failed to retrieve users.', 500);
  }
}
