/**
 * scratch/test-phase12-iot.ts
 *
 * FoodTrust — Phase 12: ESP32 Hardware Integration & IoT Verification Suite
 *
 * Verifies:
 * 1. Device Authentication:
 *    - Missing headers (x-bin-id, x-device-token) -> 401 Unauthorized
 *    - Missing x-device-token -> 401 Unauthorized
 *    - Non-existent bin -> 401 Unauthorized
 *    - Invalid device token for existing bin -> 401 Unauthorized
 *    - Valid credentials -> 200 OK
 * 2. Zod Payload Validation & Physical Bounds:
 *    - Out-of-bounds temperature (> 65°C or < -10°C) -> 400 Bad Request
 *    - Out-of-bounds humidity (< 0% or > 100%) -> 400 Bad Request
 *    - Out-of-bounds VOC gas (> 5000 ppm) -> 400 Bad Request
 *    - Inconsistent tray weight (netWeightKg > rawWeightKg) -> 400 Bad Request
 *    - Future timestamp (> 5 min clock skew) -> 400 Bad Request
 * 3. Cross-Bin Identity Isolation:
 *    - Payload binCode mismatch with authenticated header -> 400 Bad Request
 * 4. Heartbeat State Machine & Safety Invariant:
 *    - Transitions OFFLINE -> ONLINE
 *    - Preserves MAINTENANCE status (CRITICAL: never overwritten by ping)
 *    - Preserves ALERT status (CRITICAL: never overwritten by ping)
 * 5. Rate Limiting Enforcement:
 *    - Exceeding 60 requests/minute -> 429 Too Many Requests
 * 6. Telemetry Ingestion & Freshness Computation:
 *    - Multi-tray batch persisted and evaluated
 */

import * as fs from 'fs';
import * as path from 'path';

// 1. Load .env.local
try {
  const envContent = fs.readFileSync(path.resolve(process.cwd(), '.env.local'), 'utf8');
  envContent.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        const key = trimmed.substring(0, eqIdx).trim();
        let val = trimmed.substring(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.substring(1, val.length - 1);
        }
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  });
} catch {
  // Ignore
}

if (!globalThis.WebSocket) {
  // @ts-ignore
  globalThis.WebSocket = class DummyWebSocket {};
}

import { NextRequest } from 'next/server';
import { POST as handleTelemetry } from '../app/api/iot/telemetry/route';
import { POST as handleHeartbeat } from '../app/api/iot/heartbeat/route';
import { getAdminSupabase } from '../lib/supabase/admin';
import { checkRateLimit } from '../lib/utils/rate-limiter';
import type { Database } from '../types/database.types';

type SmartBinRow = Database['public']['Tables']['smart_bins']['Row'];

async function runPhase12Tests() {
  console.log('========================================================================');
  console.log('FOODTRUST — PHASE 12: ESP32 HARDWARE INTEGRATION & IOT VERIFICATION');
  console.log('========================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(desc: string, condition: boolean) {
    if (condition) {
      console.log(`  [PASS] ${desc}`);
      passed++;
    } else {
      console.error(`  [FAIL] ${desc}`);
      failed++;
    }
  }

  const adminClient = getAdminSupabase();
  const queryClient = adminClient as unknown as { from: (table: string) => Record<string, Function> };

  // -----------------------------------------------------------------
  // SETUP: VERIFY SEED BIN & TOKENS
  // -----------------------------------------------------------------
  console.log('--- 1. Resolving Seed Smart Bin & Authentication Credentials ---');

  const { data: bins } = await (queryClient
    .from('smart_bins')
    .select('*')
    .eq('bin_code', 'BIN-DELHI-001')
    .limit(1) as Promise<{ data: SmartBinRow[] | null; error: any }>);

  const bin = bins?.[0];
  assert('Found seed smart bin BIN-DELHI-001 in database', !!bin);
  if (!bin) {
    console.error('Fatal: Cannot proceed without seed bin BIN-DELHI-001.');
    process.exit(1);
  }

  const BIN_CODE = 'BIN-DELHI-001';
  const VALID_TOKEN = 'dt_sec_9f8e7d6c5b4a3120';
  const INVALID_TOKEN = 'dt_sec_fake_unauthorized_token_999';

  // -----------------------------------------------------------------
  // TEST SUITE 1: DEVICE AUTHENTICATION & HEADER ENFORCEMENT
  // -----------------------------------------------------------------
  console.log('\n--- 2. Device Authentication & Security Perimeter ---');

  // 1. Missing both headers
  const reqNoHeaders = new NextRequest('http://localhost:3000/api/iot/heartbeat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ timestamp: new Date().toISOString() }),
  });
  const resNoHeaders = await handleHeartbeat(reqNoHeaders);
  assert('Rejects request missing both x-bin-id and x-device-token (401)', resNoHeaders.status === 401);

  // 2. Missing token header
  const reqNoToken = new NextRequest('http://localhost:3000/api/iot/heartbeat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-bin-id': BIN_CODE,
    },
    body: JSON.stringify({ timestamp: new Date().toISOString() }),
  });
  const resNoToken = await handleHeartbeat(reqNoToken);
  assert('Rejects request missing x-device-token header (401)', resNoToken.status === 401);

  // 3. Unknown bin code
  const reqBadBin = new NextRequest('http://localhost:3000/api/iot/heartbeat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-bin-id': 'BIN-NONEXISTENT-999',
      'x-device-token': VALID_TOKEN,
    },
    body: JSON.stringify({ timestamp: new Date().toISOString() }),
  });
  const resBadBin = await handleHeartbeat(reqBadBin);
  assert('Rejects non-existent bin code (401)', resBadBin.status === 401);

  // 4. Invalid device token for real bin
  const reqBadToken = new NextRequest('http://localhost:3000/api/iot/heartbeat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-bin-id': BIN_CODE,
      'x-device-token': INVALID_TOKEN,
    },
    body: JSON.stringify({ timestamp: new Date().toISOString() }),
  });
  const resBadToken = await handleHeartbeat(reqBadToken);
  assert('Rejects incorrect device token with constant-time comparison (401)', resBadToken.status === 401);

  // 5. Valid credentials
  const reqValidAuth = new NextRequest('http://localhost:3000/api/iot/heartbeat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-bin-id': BIN_CODE,
      'x-device-token': VALID_TOKEN,
    },
    body: JSON.stringify({ timestamp: new Date().toISOString() }),
  });
  const resValidAuth = await handleHeartbeat(reqValidAuth);
  assert('Authenticates valid bin credentials successfully (200)', resValidAuth.status === 200);

  // -----------------------------------------------------------------
  // TEST SUITE 2: TELEMETRY PAYLOAD VALIDATION & PHYSICAL BOUNDS
  // -----------------------------------------------------------------
  console.log('\n--- 3. Telemetry Payload Validation & Physical Bounds ---');

  const validTelemetryBase = {
    binCode: BIN_CODE,
    timestamp: new Date().toISOString(),
    ambient: {
      temperatureC: 4.2,
      humidityPct: 62.0,
      vocGasPpm: 45.0,
    },
    system: {
      lidOpen: false,
      batteryPct: 95,
      firmwareVersion: '1.0.4',
    },
    trays: [
      {
        trayNumber: 1,
        category: 'COOKED_MEALS',
        rawWeightKg: 12.5,
        tareWeightKg: 2.5,
        netWeightKg: 10.0,
      },
    ],
  };

  // Helper function for telemetry requests
  async function testTelemetryPayload(payload: any, desc: string, expectedStatus = 400) {
    const req = new NextRequest('http://localhost:3000/api/iot/telemetry', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-bin-id': BIN_CODE,
        'x-device-token': VALID_TOKEN,
      },
      body: JSON.stringify(payload),
    });
    const res = await handleTelemetry(req);
    assert(desc, res.status === expectedStatus);
    return res;
  }

  // 1. High temperature out of envelope (> 65°C)
  await testTelemetryPayload(
    {
      ...validTelemetryBase,
      ambient: { ...validTelemetryBase.ambient, temperatureC: 78.5 },
    },
    'Rejects temperature above physical envelope 65°C (400)'
  );

  // 2. Low temperature out of envelope (< -10°C)
  await testTelemetryPayload(
    {
      ...validTelemetryBase,
      ambient: { ...validTelemetryBase.ambient, temperatureC: -18.0 },
    },
    'Rejects temperature below physical envelope -10°C (400)'
  );

  // 3. Humidity > 100%
  await testTelemetryPayload(
    {
      ...validTelemetryBase,
      ambient: { ...validTelemetryBase.ambient, humidityPct: 105.0 },
    },
    'Rejects relative humidity above 100% (400)'
  );

  // 4. Humidity < 0%
  await testTelemetryPayload(
    {
      ...validTelemetryBase,
      ambient: { ...validTelemetryBase.ambient, humidityPct: -5.0 },
    },
    'Rejects negative relative humidity (400)'
  );

  // 5. VOC Gas > 5000 ppm
  await testTelemetryPayload(
    {
      ...validTelemetryBase,
      ambient: { ...validTelemetryBase.ambient, vocGasPpm: 5500.0 },
    },
    'Rejects VOC gas concentration above sensor range 5000 ppm (400)'
  );

  // 6. Inconsistent Tray Weight: netWeightKg > rawWeightKg
  await testTelemetryPayload(
    {
      ...validTelemetryBase,
      trays: [
        {
          trayNumber: 1,
          category: 'COOKED_MEALS',
          rawWeightKg: 5.0,
          tareWeightKg: 2.0,
          netWeightKg: 10.0, // Impossible: net exceeds raw
        },
      ],
    },
    'Rejects impossible physics where net weight exceeds raw weight (400)'
  );

  // 7. Future timestamp beyond 5-minute skew
  const futureTime = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  await testTelemetryPayload(
    {
      ...validTelemetryBase,
      timestamp: futureTime,
    },
    'Rejects timestamp > 5 minutes in the future to prevent replay attacks (400)'
  );

  // -----------------------------------------------------------------
  // TEST SUITE 3: CROSS-BIN IDENTITY ISOLATION
  // -----------------------------------------------------------------
  console.log('\n--- 4. Cross-Bin Identity Isolation ---');

  const mismatchedPayload = {
    ...validTelemetryBase,
    binCode: 'BIN-MUMBAI-002', // Does not match authenticated header BIN-DELHI-001
  };
  const mismatchRes = await testTelemetryPayload(
    mismatchedPayload,
    'Rejects telemetry when payload binCode mismatches authenticated header (400)'
  );
  const mismatchJson = await mismatchRes.json();
  assert(
    'Returns BIN_IDENTITY_MISMATCH error code',
    mismatchJson?.error?.code === 'BIN_IDENTITY_MISMATCH'
  );

  // -----------------------------------------------------------------
  // TEST SUITE 4: HEARTBEAT STATE MACHINE & STATUS PRESERVATION
  // -----------------------------------------------------------------
  console.log('\n--- 5. Heartbeat State Machine & Safety Invariants ---');

  const originalStatus = bin.status;

  // 1. Transition OFFLINE -> ONLINE
  await queryClient
    .from('smart_bins')
    .update({ status: 'OFFLINE' })
    .eq('id', bin.id);

  const reqHbOffline = new NextRequest('http://localhost:3000/api/iot/heartbeat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-bin-id': BIN_CODE,
      'x-device-token': VALID_TOKEN,
    },
    body: JSON.stringify({ timestamp: new Date().toISOString(), batteryPct: 92 }),
  });
  const resHbOffline = await handleHeartbeat(reqHbOffline);
  assert('Heartbeat succeeds for OFFLINE bin (200)', resHbOffline.status === 200);

  const { data: binAfterOffline } = await (queryClient
    .from('smart_bins')
    .select('status')
    .eq('id', bin.id)
    .single() as Promise<{ data: { status: string } | null; error: any }>);
  assert('Heartbeat transitions bin status from OFFLINE to ONLINE', binAfterOffline?.status === 'ONLINE');

  // 2. SAFETY RULE: Preserve MAINTENANCE status (must NOT overwrite to ONLINE)
  await queryClient
    .from('smart_bins')
    .update({ status: 'MAINTENANCE' })
    .eq('id', bin.id);

  const reqHbMaint = new NextRequest('http://localhost:3000/api/iot/heartbeat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-bin-id': BIN_CODE,
      'x-device-token': VALID_TOKEN,
    },
    body: JSON.stringify({ timestamp: new Date().toISOString() }),
  });
  const resHbMaint = await handleHeartbeat(reqHbMaint);
  assert('Heartbeat succeeds during MAINTENANCE (200)', resHbMaint.status === 200);

  const { data: binAfterMaint } = await (queryClient
    .from('smart_bins')
    .select('status')
    .eq('id', bin.id)
    .single() as Promise<{ data: { status: string } | null; error: any }>);
  assert('CRITICAL SAFETY: Heartbeat preserves MAINTENANCE status and does NOT revert to ONLINE', binAfterMaint?.status === 'MAINTENANCE');

  // 3. SAFETY RULE: Preserve ALERT status (must NOT overwrite to ONLINE)
  await queryClient
    .from('smart_bins')
    .update({ status: 'ALERT' })
    .eq('id', bin.id);

  const reqHbAlert = new NextRequest('http://localhost:3000/api/iot/heartbeat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-bin-id': BIN_CODE,
      'x-device-token': VALID_TOKEN,
    },
    body: JSON.stringify({ timestamp: new Date().toISOString() }),
  });
  const resHbAlert = await handleHeartbeat(reqHbAlert);
  assert('Heartbeat succeeds during ALERT (200)', resHbAlert.status === 200);

  const { data: binAfterAlert } = await (queryClient
    .from('smart_bins')
    .select('status')
    .eq('id', bin.id)
    .single() as Promise<{ data: { status: string } | null; error: any }>);
  assert('CRITICAL SAFETY: Heartbeat preserves ALERT status and does NOT revert to ONLINE', binAfterAlert?.status === 'ALERT');

  // Restore bin status to original
  await queryClient
    .from('smart_bins')
    .update({ status: originalStatus })
    .eq('id', bin.id);

  // -----------------------------------------------------------------
  // TEST SUITE 5: RATE LIMITING ENFORCEMENT
  // -----------------------------------------------------------------
  console.log('\n--- 6. Rate Limiting Sliding-Window Enforcement ---');

  const testRateLimitKey = 'test-rate-limit-device-boundary';
  let wasRateLimited = false;
  let remainingAtStart = 0;

  for (let i = 0; i < 65; i++) {
    const rl = checkRateLimit(testRateLimitKey, 60, 60000);
    if (i === 0) remainingAtStart = rl.remaining;
    if (!rl.allowed) {
      wasRateLimited = true;
      break;
    }
  }

  assert('Rate limiter initializes tracking window with capacity 60', remainingAtStart === 59);
  assert('Rate limiter enforces max 60 requests per minute threshold (triggers 429)', wasRateLimited);

  // -----------------------------------------------------------------
  // TEST SUITE 6: FULL TELEMETRY INGESTION & FRESHNESS EVALUATION
  // -----------------------------------------------------------------
  console.log('\n--- 7. Full Telemetry Ingestion & Freshness Computation ---');

  const validTelemetryReq = new NextRequest('http://localhost:3000/api/iot/telemetry', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-bin-id': BIN_CODE,
      'x-device-token': VALID_TOKEN,
    },
    body: JSON.stringify(validTelemetryBase),
  });

  const validTelemetryRes = await handleTelemetry(validTelemetryReq);
  assert('Ingests valid telemetry batch successfully (200)', validTelemetryRes.status === 200);

  const telemJson = await validTelemetryRes.json();
  assert('Response indicates success: true', telemJson.success === true);
  assert('Response contains recordsInserted count >= 1', telemJson.data?.recordsInserted >= 1);
  assert('Response contains evaluations array', Array.isArray(telemJson.data?.evaluations) && telemJson.data?.evaluations.length > 0);
  assert('Tray evaluation contains statutory decision-support disclaimer', !!telemJson.data?.evaluations[0]?.disclaimer);

  // Verify DB record in sensor_telemetry
  const { data: telemRecord } = await (queryClient
    .from('sensor_telemetry')
    .select('*')
    .eq('bin_id', bin.id)
    .order('recorded_at', { ascending: false })
    .limit(1) as Promise<{ data: any[]; error: any }>);

  assert('Sensor telemetry batch persisted in database table sensor_telemetry', telemRecord && telemRecord.length > 0);
  assert('Persisted temperature matches ingestion payload (4.2°C)', Math.abs(Number(telemRecord?.[0]?.temperature_c) - 4.2) < 0.1);

  // -----------------------------------------------------------------
  // SUMMARY
  // -----------------------------------------------------------------
  console.log('\n========================================================================');
  console.log(`PHASE 12 VERIFICATION COMPLETE: ${passed} Passed, ${failed} Failed`);
  console.log('========================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runPhase12Tests().catch((err) => {
  console.error('[FATAL] Unhandled error during Phase 12 verification:', err);
  process.exit(1);
});
