/**
 * app/api/iot/telemetry/route.ts
 * FoodTrust — Phase 3/4: IoT Telemetry Ingestion & Real-Time Freshness Evaluation
 *
 * Ingestion endpoint for high-frequency smart bin telemetry batches.
 * Seamlessly integrates the Phase 4 deterministic Arrhenius kinetic decay model.
 */

import { NextRequest } from 'next/server';
import { authenticateDevice } from '@/lib/auth/device-auth';
import { checkRateLimit } from '@/lib/utils/rate-limiter';
import { telemetryIngestSchema } from '@/lib/validation/iot.schema';
import { getAdminSupabase } from '@/lib/supabase/admin';
import { evaluateFreshness } from '@/lib/services/freshness.service';
import { successResponse, errorResponse } from '@/lib/utils/api-response';
import type { Database } from '@/types/database.types';

type AnyClient = { from: (table: string) => Record<string, Function> };
type SensorTelemetryInsert = Database['public']['Tables']['sensor_telemetry']['Insert'];
type FoodTrayRow = Database['public']['Tables']['food_trays']['Row'];

export async function POST(request: NextRequest) {
  try {
    // 1. Device Authentication
    const authResult = await authenticateDevice(request);
    if (authResult.errorResponse) {
      return authResult.errorResponse;
    }
    const bin = authResult.bin;

    // 2. Rate Limiting (per authenticated bin identity)
    const rateLimit = checkRateLimit(`bin:${bin.id}`);
    if (!rateLimit.allowed) {
      return errorResponse(
        'Too many telemetry requests. Rate limit exceeded (maximum 60 requests per minute).',
        429,
        {
          code: 'RATE_LIMIT_EXCEEDED',
          retryAfterSeconds: rateLimit.resetSeconds,
        },
        {
          'Retry-After': String(rateLimit.resetSeconds),
          'X-RateLimit-Limit': String(rateLimit.limit),
          'X-RateLimit-Remaining': '0',
        }
      );
    }

    // 3. Parse JSON Body
    const rawBody = await request.json().catch(() => null);
    if (!rawBody) {
      return errorResponse('Invalid JSON request body.', 400);
    }

    // 4. Validate with Zod
    const parseResult = telemetryIngestSchema.safeParse(rawBody);
    if (!parseResult.success) {
      return errorResponse(
        'Validation failed for telemetry payload.',
        400,
        parseResult.error.flatten().fieldErrors
      );
    }
    const telemetry = parseResult.data;

    // 5. Authoritative Identity Check: payload binCode must match authenticated bin
    if (telemetry.binCode !== bin.bin_code) {
      return errorResponse(
        'Payload binCode does not match authenticated device identity.',
        400,
        {
          code: 'BIN_IDENTITY_MISMATCH',
          authenticatedBin: bin.bin_code,
          payloadBin: telemetry.binCode,
        }
      );
    }

    // 6. Resolve Food Trays for this authenticated bin
    const adminSupabase = getAdminSupabase();
    const queryClient = adminSupabase as unknown as AnyClient;

    const { data: traysData, error: traysError } = await queryClient
      .from('food_trays')
      .select('*')
      .eq('bin_id', bin.id);

    if (traysError) {
      return errorResponse(
        'Failed to resolve tray configurations for smart bin.',
        500,
        { code: 'TRAY_RESOLUTION_ERROR' }
      );
    }

    const existingTrays = (traysData || []) as FoodTrayRow[];
    const trayMap = new Map<number, FoodTrayRow>();
    for (const tray of existingTrays) {
      trayMap.set(tray.tray_number, tray);
    }

    // Verify all submitted trays exist in the physical bin registration
    for (const trayInput of telemetry.trays) {
      if (!trayMap.has(trayInput.trayNumber)) {
        return errorResponse(
          `Tray slot ${trayInput.trayNumber} is not registered for smart bin ${bin.bin_code}.`,
          400,
          {
            code: 'UNREGISTERED_TRAY_SLOT',
            trayNumber: trayInput.trayNumber,
            availableSlots: Array.from(trayMap.keys()),
          }
        );
      }
    }

    // 7. Prepare Batch Ingestion Records
    const recordedAt = new Date(telemetry.timestamp).toISOString();
    const recordsToInsert: SensorTelemetryInsert[] = [];

    // Ambient / Chamber Record (tray_id = null)
    recordsToInsert.push({
      bin_id: bin.id,
      tray_id: null,
      weight_kg: null,
      temperature_c: telemetry.ambient.temperatureC,
      humidity_pct: telemetry.ambient.humidityPct,
      voc_gas_ppm: telemetry.ambient.vocGasPpm,
      lid_open: telemetry.system.lidOpen,
      battery_pct: telemetry.system.batteryPct,
      firmware_version: telemetry.system.firmwareVersion,
      recorded_at: recordedAt,
    });

    // Tray Readings
    for (const trayInput of telemetry.trays) {
      const dbTray = trayMap.get(trayInput.trayNumber)!;
      recordsToInsert.push({
        bin_id: bin.id,
        tray_id: dbTray.id,
        weight_kg: trayInput.rawWeightKg,
        temperature_c: telemetry.ambient.temperatureC,
        humidity_pct: telemetry.ambient.humidityPct,
        voc_gas_ppm: telemetry.ambient.vocGasPpm,
        lid_open: telemetry.system.lidOpen,
        battery_pct: telemetry.system.batteryPct,
        firmware_version: telemetry.system.firmwareVersion,
        recorded_at: recordedAt,
      });
    }

    // 8. Atomic Telemetry Insert via Service Role Client
    const { error: insertError } = await queryClient
      .from('sensor_telemetry')
      .insert(recordsToInsert);

    if (insertError) {
      return errorResponse(
        'Failed to persist telemetry batch to time-series storage.',
        500,
        { code: (insertError as { code?: string }).code }
      );
    }

    // 9. Build Decision-Support Evaluation Response using Phase 4 Freshness Service
    const evaluations = telemetry.trays.map((tray) => {
      // In the telemetry ingestion context where donation preparation time is not yet linked,
      // the baseline assumes fresh intake at current measurement epoch.
      const evalResult = evaluateFreshness({
        foodCategory: tray.category,
        preparationTimestamp: recordedAt,
        evaluationTimestamp: recordedAt,
        temperatureC: telemetry.ambient.temperatureC,
        humidityPct: telemetry.ambient.humidityPct,
        vocGasPpm: telemetry.ambient.vocGasPpm,
      });

      return {
        trayNumber: tray.trayNumber,
        category: tray.category,
        netWeightKg: tray.netWeightKg,
        freshnessScore: evalResult.freshnessScore,
        freshnessStatus: evalResult.freshnessStatus,
        riskLevel: evalResult.riskLevel,
        estimatedShelfLifeHours: evalResult.estimatedShelfLifeHours,
        disclaimer: evalResult.disclaimer,
      };
    });

    return successResponse(
      {
        binCode: bin.bin_code,
        recordedAt,
        recordsInserted: recordsToInsert.length,
        evaluations,
      },
      'Telemetry processed successfully',
      200,
      {
        'X-RateLimit-Limit': String(rateLimit.limit),
        'X-RateLimit-Remaining': String(rateLimit.remaining),
      }
    );
  } catch (err) {
    return errorResponse(
      'An unexpected error occurred during telemetry processing.',
      500,
      { details: err instanceof Error ? err.message : 'Unknown error' }
    );
  }
}
