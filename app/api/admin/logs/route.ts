/**
 * app/api/admin/logs/route.ts
 * GET /api/admin/logs — Paginated audit log with sanitized JSONB fields
 * Auth: ADMIN or SUPER_ADMIN
 *
 * Sensitive fields (otp_code_hash, password, token, hash, etc.) are
 * stripped from old_values/new_values by the admin service before returning.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/rbac';
import { listAuditLogs } from '@/lib/services/admin.service';
import { listAuditLogsQuerySchema } from '@/lib/validation/admin.schema';
import { successResponse, errorResponse } from '@/lib/utils/api-response';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { errorResponse: authErr } = await requireRole('ADMIN');
  if (authErr) return authErr;

  const rawParams = Object.fromEntries(req.nextUrl.searchParams.entries());
  const parsed = listAuditLogsQuerySchema.safeParse(rawParams);
  if (!parsed.success) {
    return errorResponse('Invalid query parameters.', 400, parsed.error.flatten());
  }

  try {
    const result = await listAuditLogs(parsed.data);
    return successResponse(result, 'Audit logs retrieved successfully.');
  } catch (err) {
    console.error('[admin/logs] GET Error:', err);
    return errorResponse('Failed to retrieve audit logs.', 500);
  }
}
