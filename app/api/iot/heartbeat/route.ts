/**
 * app/api/iot/heartbeat/route.ts
 * FoodTrust — Phase 3: IoT Device Authentication & Telemetry
 *
 * Lightweight device heartbeat endpoint for smart bin connectivity check.
 *
 * WORKFLOW:
 * 1. Authenticate hardware via x-bin-id and x-device-token headers.
 * 2. Enforce sliding-window rate limit (60 req/min).
 * 3. Validate optional body (firmwareVersion, batteryPct, timestamp) with Zod.
 * 4. Update smart_bins:
 *    - last_heartbeat_at = current timestamp
 *    - firmware_version (if provided)
 *    - status: Set to ONLINE ONLY IF status is currently 'OFFLINE'.
 *      CRITICAL SAFETY RULE: Never overwrite 'MAINTENANCE' or 'ALERT' status!
 *      A bin undergoing physical servicing or inspection must stay in MAINTENANCE.
 * 5. Return safe success response with bin operational status.
 */

import { NextRequest } from 'next/server';
import { authenticateDevice } from '@/lib/auth/device-auth';
import { checkRateLimit } from '@/lib/utils/rate-limiter';
import { heartbeatSchema } from '@/lib/validation/iot.schema';
import { getAdminSupabase } from '@/lib/supabase/admin';
import { successResponse, errorResponse } from '@/lib/utils/api-response';

type AnyClient = { from: (table: string) => Record<string, Function> };

export async function POST(request: NextRequest) {
  try {
    // 1. Device Authentication
    const authResult = await authenticateDevice(request);
    if (authResult.errorResponse) {
      return authResult.errorResponse;
    }
    const bin = authResult.bin;

    // 2. Rate Limiting
    const rateLimit = checkRateLimit(`heartbeat:${bin.id}`);
    if (!rateLimit.allowed) {
      return errorResponse(
        'Heartbeat rate limit exceeded.',
        429,
        {
          code: 'RATE_LIMIT_EXCEEDED',
          retryAfterSeconds: rateLimit.resetSeconds,
        },
        {
          'Retry-After': String(rateLimit.resetSeconds),
        }
      );
    }

    // 3. Parse optional body
    let rawBody = {};
    const text = await request.text().catch(() => '');
    if (text && text.trim().length > 0) {
      try {
        rawBody = JSON.parse(text);
      } catch {
        return errorResponse('Invalid JSON body in heartbeat request.', 400);
      }
    }

    const parseResult = heartbeatSchema.safeParse(rawBody);
    if (!parseResult.success) {
      return errorResponse(
        'Validation failed for heartbeat payload.',
        400,
        parseResult.error.flatten().fieldErrors
      );
    }
    const heartbeatData = parseResult.data;

    // 4. Update Bin Metadata
    const adminSupabase = getAdminSupabase();
    const queryClient = adminSupabase as unknown as AnyClient;

    const heartbeatTime = heartbeatData.timestamp
      ? new Date(heartbeatData.timestamp).toISOString()
      : new Date().toISOString();

    const updatePayload: Record<string, unknown> = {
      last_heartbeat_at: heartbeatTime,
      updated_at: new Date().toISOString(),
    };

    if (heartbeatData.firmwareVersion) {
      updatePayload.firmware_version = heartbeatData.firmwareVersion;
    }

    // SAFETY RULE: Only transition to 'ONLINE' if the bin was previously 'OFFLINE'.
    // If the bin is set to 'MAINTENANCE' or 'ALERT', preserve that status!
    if (bin.status === 'OFFLINE') {
      updatePayload.status = 'ONLINE';
    }

    const { error: updateError } = await queryClient
      .from('smart_bins')
      .update(updatePayload)
      .eq('id', bin.id);

    if (updateError) {
      return errorResponse(
        'Failed to record device heartbeat.',
        500,
        { code: (updateError as { code?: string }).code }
      );
    }

    return successResponse(
      {
        binCode: bin.bin_code,
        status: (updatePayload.status as string) || bin.status,
        lastHeartbeatAt: heartbeatTime,
        firmwareVersion: heartbeatData.firmwareVersion || bin.firmware_version,
      },
      'Heartbeat acknowledged',
      200
    );
  } catch (err) {
    return errorResponse(
      'An unexpected error occurred during heartbeat processing.',
      500,
      { details: err instanceof Error ? err.message : 'Unknown error' }
    );
  }
}
