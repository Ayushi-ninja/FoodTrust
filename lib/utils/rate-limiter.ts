/**
 * lib/utils/rate-limiter.ts
 * FoodTrust — Phase 3: IoT Device Authentication & Telemetry
 *
 * Sliding-window rate limiter designed for IoT ingestion endpoints.
 *
 * RATE LIMIT CONTRACT:
 * - Default: 60 requests per minute per smart bin identity (IOT_INGESTION_RATE_LIMIT).
 * - Keyed on authenticated bin ID (or IP address as secondary fallback).
 * - Exceeding limit returns HTTP 429 Too Many Requests.
 *
 * ARCHITECTURAL NOTE ON STATE:
 * In this single-node / development environment, this uses an in-memory sliding window
 * tracker with automatic periodic pruning of stale timestamps.
 * Production multi-instance deployments (e.g. Vercel serverless / distributed containers)
 * should swap the underlying store with Upstash Redis / Redis token bucket.
 */

interface RateLimitRecord {
  timestamps: number[];
}

const rateLimitStore = new Map<string, RateLimitRecord>();

// Clean up stale buckets every 5 minutes to avoid memory leaks
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
let lastCleanup = Date.now();

function pruneStaleEntries(windowMs: number) {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;

  lastCleanup = now;
  const cutoff = now - windowMs;

  for (const [key, record] of rateLimitStore.entries()) {
    record.timestamps = record.timestamps.filter((ts) => ts > cutoff);
    if (record.timestamps.length === 0) {
      rateLimitStore.delete(key);
    }
  }
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetSeconds: number;
}

/**
 * Checks and records a request against the sliding window rate limit.
 *
 * @param key Unique identifier (e.g. `bin:${binId}`)
 * @param limit Max allowed requests within the window (default read from IOT_INGESTION_RATE_LIMIT or 60)
 * @param windowMs Time window in milliseconds (default 60,000 ms = 1 minute)
 */
export function checkRateLimit(
  key: string,
  limit?: number,
  windowMs = 60000
): RateLimitResult {
  const configuredLimit =
    limit ??
    parseInt(process.env.IOT_INGESTION_RATE_LIMIT || '60', 10);

  const now = Date.now();
  pruneStaleEntries(windowMs);

  let record = rateLimitStore.get(key);
  if (!record) {
    record = { timestamps: [] };
    rateLimitStore.set(key, record);
  }

  // Remove timestamps outside the current sliding window
  const windowStart = now - windowMs;
  record.timestamps = record.timestamps.filter((ts) => ts > windowStart);

  const currentCount = record.timestamps.length;

  if (currentCount >= configuredLimit) {
    // Oldest timestamp in current window gives the reset time
    const oldestTimestamp = record.timestamps[0] || now;
    const resetSeconds = Math.max(
      1,
      Math.ceil((oldestTimestamp + windowMs - now) / 1000)
    );

    return {
      allowed: false,
      limit: configuredLimit,
      remaining: 0,
      resetSeconds,
    };
  }

  // Record this request
  record.timestamps.push(now);

  const remaining = configuredLimit - record.timestamps.length;
  const resetSeconds = Math.ceil(windowMs / 1000);

  return {
    allowed: true,
    limit: configuredLimit,
    remaining,
    resetSeconds,
  };
}
