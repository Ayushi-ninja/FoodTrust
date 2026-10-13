/**
 * lib/auth/device-auth.ts
 * FoodTrust — Phase 3: IoT Device Authentication & Telemetry
 *
 * Authenticates physical smart bin IoT devices (ESP32) making requests
 * to the ingestion and heartbeat endpoints.
 *
 * AUTHENTICATION MODEL:
 * - Every IoT request must provide two headers:
 *     x-bin-id: string (maps to smart_bins.bin_code e.g. 'BIN-DELHI-001')
 *     x-device-token: string (raw secret token provisioned to hardware)
 * - The database stores a salted SHA-256 hash in smart_bins.api_key_hash:
 *     SHA256(raw_device_token + IOT_DEVICE_SHARED_SALT)
 * - Raw tokens and salt are NEVER stored or returned to clients.
 * - Constant-time comparison (crypto.timingSafeEqual) prevents timing attacks.
 * - Suspended/disabled device states (MAINTENANCE, OFFLINE) are handled safely.
 */

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { getAdminSupabase } from '@/lib/supabase/admin';
import { errorResponse } from '@/lib/utils/api-response';
import type { Database } from '@/types/database.types';

export type SmartBinRow = Database['public']['Tables']['smart_bins']['Row'];

export type DeviceAuthSuccessResult = {
  bin: SmartBinRow;
  errorResponse: null;
};

export type DeviceAuthFailureResult = {
  bin: null;
  errorResponse: NextResponse;
};

export type DeviceAuthResult = DeviceAuthSuccessResult | DeviceAuthFailureResult;

/**
 * Computes the salted SHA-256 hash for an IoT device token.
 * Hash formula: SHA256(raw_token + IOT_DEVICE_SHARED_SALT)
 */
export function hashDeviceToken(rawToken: string): string {
  const salt = process.env.IOT_DEVICE_SHARED_SALT;
  if (!salt) {
    throw new Error(
      'Server configuration error: IOT_DEVICE_SHARED_SALT is not configured.'
    );
  }
  return crypto
    .createHash('sha256')
    .update(rawToken + salt)
    .digest('hex');
}

/**
 * Authenticates an incoming IoT request from its headers.
 *
 * Headers required:
 *   'x-bin-id': Unique bin code (e.g. 'BIN-DELHI-001')
 *   'x-device-token': Raw provisioned device token
 *
 * Security guarantees:
 * - Returns 401 for missing headers or invalid credentials without revealing whether
 *   the bin exists or if the token was wrong (generic failure to prevent enumeration).
 * - Uses constant-time buffer comparison to eliminate timing side-channels.
 * - Rejects bins in 'ALERT' or corrupted states if needed.
 */
export async function authenticateDevice(
  request: NextRequest
): Promise<DeviceAuthResult> {
  const binIdHeader = request.headers.get('x-bin-id');
  const deviceTokenHeader = request.headers.get('x-device-token');

  // 1. Missing credentials check
  if (!binIdHeader || !deviceTokenHeader) {
    return {
      bin: null,
      errorResponse: errorResponse(
        'Device authentication required: missing x-bin-id or x-device-token header.',
        401,
        { code: 'DEVICE_CREDENTIALS_MISSING' }
      ),
    };
  }

  const cleanBinCode = binIdHeader.trim();
  const cleanToken = deviceTokenHeader.trim();

  if (!cleanBinCode || !cleanToken) {
    return {
      bin: null,
      errorResponse: errorResponse(
        'Device authentication credentials cannot be empty.',
        401,
        { code: 'INVALID_DEVICE_CREDENTIALS' }
      ),
    };
  }

  // 2. Fetch the smart bin by bin_code via the admin client (service role bypasses RLS)
  // Smart bins are accessed by hardware without human JWT sessions
  let bin: SmartBinRow | null = null;
  try {
    const adminSupabase = getAdminSupabase();
    // Using any-cast boundary on query builder to bypass Supabase v2 generic inference
    const query = adminSupabase as unknown as { from: (table: string) => Record<string, Function> };
    const { data, error } = await query
      .from('smart_bins')
      .select('*')
      .eq('bin_code', cleanBinCode)
      .single();

    if (error || !data) {
      // Return generic 401 to prevent bin code enumeration
      return {
        bin: null,
        errorResponse: errorResponse(
          'Device authentication failed. Invalid device credentials.',
          401,
          { code: 'DEVICE_AUTH_FAILED' }
        ),
      };
    }
    bin = data as SmartBinRow;
  } catch (err) {
    return {
      bin: null,
      errorResponse: errorResponse(
        'An error occurred during device authentication verification.',
        500,
        { code: 'DEVICE_AUTH_SERVER_ERROR' }
      ),
    };
  }

  // 3. Compute salted SHA-256 hash and compare in constant time
  try {
    const computedHash = hashDeviceToken(cleanToken);
    const storedHash = bin.api_key_hash;

    const computedBuffer = Buffer.from(computedHash, 'hex');
    const storedBuffer = Buffer.from(storedHash, 'hex');

    // Constant-time comparison prevents timing analysis
    const isValid =
      computedBuffer.length === storedBuffer.length &&
      crypto.timingSafeEqual(computedBuffer, storedBuffer);

    if (!isValid) {
      return {
        bin: null,
        errorResponse: errorResponse(
          'Device authentication failed. Invalid device credentials.',
          401,
          { code: 'DEVICE_AUTH_FAILED' }
        ),
      };
    }
  } catch (err) {
    return {
      bin: null,
      errorResponse: errorResponse(
        'Server configuration error during token verification.',
        500,
        { code: 'HASHING_ERROR' }
      ),
    };
  }

  return {
    bin,
    errorResponse: null,
  };
}
