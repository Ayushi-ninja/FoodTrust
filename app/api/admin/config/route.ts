/**
 * app/api/admin/config/route.ts
 * GET  /api/admin/config — Read system config (ADMIN or SUPER_ADMIN)
 * PATCH /api/admin/config — Update a config value (SUPER_ADMIN only)
 *
 * Allowlisted keys: kg_per_meal_factor, co2_factor_per_kg
 * Values are persisted to public.system_config and read by the analytics
 * service — changes propagate immediately on the next analytics request.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/rbac';
import { getSystemConfig, updateSystemConfig } from '@/lib/services/admin.service';
import { updateConfigBodySchema } from '@/lib/validation/admin.schema';
import { successResponse, errorResponse } from '@/lib/utils/api-response';

export async function GET(): Promise<NextResponse> {
  const { errorResponse: authErr } = await requireRole('ADMIN');
  if (authErr) return authErr;

  try {
    const config = await getSystemConfig();
    return successResponse(config, 'System config retrieved successfully.');
  } catch (err) {
    console.error('[admin/config] GET Error:', err);
    return errorResponse('Failed to retrieve system config.', 500);
  }
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  // Only SUPER_ADMIN can mutate config
  const { user, errorResponse: authErr } = await requireRole('SUPER_ADMIN');
  if (authErr) return authErr;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorResponse('Request body must be valid JSON.', 400);
  }

  const parsed = updateConfigBodySchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse('Invalid request body.', 400, parsed.error.flatten());
  }

  try {
    const updated = await updateSystemConfig(parsed.data.key, parsed.data.value, user.id);
    return successResponse(updated, `Config '${parsed.data.key}' updated successfully.`);
  } catch (err: unknown) {
    const statusCode = (err as { statusCode?: number }).statusCode;
    const message = (err as { message?: string }).message ?? 'Failed to update config.';
    if (statusCode === 404) return errorResponse(message, 404);
    console.error('[admin/config] PATCH Error:', err);
    return errorResponse('Failed to update system config.', 500);
  }
}
