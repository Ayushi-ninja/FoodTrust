# PHASE 3 STATUS — IoT Device Authentication & Telemetry

**Project:** FoodTrust Backend  
**Phase:** 3 of N  
**Date Completed:** 2026-10-04  
**Status:** ✅ COMPLETE — All checks pass, remote Supabase verified

---

## Verification Summary

| Check | Result |
|-------|--------|
| `npm run typecheck` | ✅ 0 errors |
| `npm run build` | ✅ Exit code 0 (14/14 static pages generated) |
| Automated Security Test Suite | ✅ 15/15 test cases PASSED (401, 400, 429, leakage audit) |
| Live Supabase Telemetry Ingestion | ✅ Verified (telemetry row inserted into remote `sensor_telemetry`) |
| Live Supabase Tray Weight Sync Trigger | ✅ Verified (`food_trays.current_weight_kg` auto-updated to 14.50 kg) |
| Live Supabase Bin Heartbeat Trigger | ✅ Verified (`smart_bins.last_heartbeat_at` auto-updated) |
| Maintenance Status Preservation | ✅ Verified (`MAINTENANCE` status preserved on heartbeat) |
| Sliding-Window Rate Limiting (429) | ✅ Verified (HTTP 429 triggered at 60 req/min threshold) |
| Static Frontend Preservation | ✅ Untouched (all 11 Phase 0 HTML views byte-identical) |
| Phase 4+ Non-Implementation | ✅ Verified (no freshness engine, donations, or pickups created) |

---

## 1. Hardware Architecture & Physical Separation

The backend code and documentation adhere strictly to the approved physical separation:

```
+--------------------------------------------------------------+
| 1. FOOD HANDLING UNIT (Sanitary Interior Chamber)            |
|    - Food-grade Removable Trays (Stainless Steel / PETG)     |
|    - Tray Weighing Sub-assemblies                            |
|    - Load Cells (Mounted below tray brackets)                |
|    - DHT22 (Temperature & Humidity, sealed probe)            |
|    - MQ-135 (VOC & Spoilage gas sensor, splash-guarded)     |
+--------------------------------------------------------------+
                               ||
         Hermetic Wire Pass-through (Food-grade Silicone)
                               ||
+--------------------------------------------------------------+
| 2. ELECTRONICS UNIT (External Lower Compartment)             |
|    - HX711 24-bit ADC Modules (Amplifies load cell mV)       |
|    - ESP32 Microcontroller (Dual-core Wi-Fi/BLE)            |
|    - 5V DC Power Supply & Thermal Fuses                      |
|    - Calibration/Status LEDs and Buzzer                      |
+--------------------------------------------------------------+
```

---

## 2. Device Authentication & Security Model

### Headers Required on Every Hardware Request
- `x-bin-id`: Human-readable bin code (e.g. `BIN-DELHI-001`).
- `x-device-token`: Secret hardware token provisioned in ESP32 NVS (e.g. `dt_sec_9f8e7d6c5b4a3120`).

### Cryptographic Design
- **Formula:** $\text{api\_key\_hash} = \text{SHA256}(\text{deviceToken} + \text{IOT\_DEVICE\_SHARED\_SALT})$
- **Salt Storage:** Server-side secret `IOT_DEVICE_SHARED_SALT` configured in `.env.local`. Never exposed to clients or returned in responses.
- **Timing Defense:** Uses `crypto.timingSafeEqual` over raw buffer values to eliminate timing side-channel attacks.
- **Enumeration Prevention:** Unregistered bin codes and invalid tokens both return identical generic `HTTP 401 Unauthorized` responses.
- **Leakage Audit:** Automated tests verify `api_key_hash` and `IOT_DEVICE_SHARED_SALT` are never returned in response bodies or headers.

---

## 3. Endpoints Implemented

| Endpoint | Method | Auth Scheme | Purpose |
|----------|--------|-------------|---------|
| [`/api/iot/telemetry`](file:///C:/Users/DELL/final_year_project/FoodTrust/app/api/iot/telemetry/route.ts) | POST | Hardware (`x-bin-id` + `x-device-token`) | High-frequency telemetry batch ingestion (ambient + tray weights). Auto-triggers DB weight sync. |
| [`/api/iot/heartbeat`](file:///C:/Users/DELL/final_year_project/FoodTrust/app/api/iot/heartbeat/route.ts) | POST | Hardware (`x-bin-id` + `x-device-token`) | Lightweight ping updating `last_heartbeat_at` and firmware. Preserves `MAINTENANCE` and `ALERT` statuses. |
| [`/api/iot/bins`](file:///C:/Users/DELL/final_year_project/FoodTrust/app/api/iot/bins/route.ts) | GET | Human JWT (`requireAuth`) | Lists smart bins with nested food trays. DONOR sees only owned bins; ADMIN sees all. `api_key_hash` excluded. |
| [`/api/iot/trays/[id]/tare`](file:///C:/Users/DELL/final_year_project/FoodTrust/app/api/iot/trays/%5Bid%5D/tare/route.ts) | POST | Human JWT (`requireAuth`) | Calibrates `tare_weight_kg` and `last_calibrated_at`. Strictly enforces IDOR ownership check. |

---

## 4. Database Trigger Synergy & Maintenance Safety

1. **`trg_sync_tray_weight`**: Automatically updates `food_trays.current_weight_kg` upon each `sensor_telemetry` insert. The backend inserts the telemetry batch and relies on the PostgreSQL trigger to maintain tray weight, preventing dual competing write paths.
2. **`trg_sync_bin_heartbeat`**: Updates `smart_bins.last_heartbeat_at`.
3. **Maintenance Preservation Fix**: If a bin has been placed into `MAINTENANCE` or `ALERT` status by a technician, incoming heartbeats and telemetry update the heartbeat timestamp but strictly **preserve** the maintenance status, ensuring maintenance mode is not silently cleared by automated pings.

---

## 5. Rate Limiting Architecture

- **Helper:** [`lib/utils/rate-limiter.ts`](file:///C:/Users/DELL/final_year_project/FoodTrust/lib/utils/rate-limiter.ts)
- **Rate Limit:** 60 requests per minute per authenticated bin identity (configured via `IOT_INGESTION_RATE_LIMIT`).
- **Algorithm:** In-memory sliding window with periodic stale entry pruning.
- **Behavior on Exceed:** Returns `HTTP 429 Too Many Requests` with `Retry-After`, `X-RateLimit-Limit`, and `X-RateLimit-Remaining: 0` headers. Verified with automated load tests.

---

## 6. Remote Supabase Verification Results

Tested against remote Supabase project `https://bucrsoebioyygbmwwysx.supabase.co`:

1. **Test Bin Registered:** `BIN-DELHI-001` (`id: a0000003-0000-4000-8000-000000000003`).
2. **API Key Hash Configured:** `63fe54080c88889b9a869dd83e8ff6d770f57749f1527fe8cd3c0ee9f612ab00`.
3. **Live Ingestion Verified:**
   - Ingested ambient readings ($22.5^\circ\text{C}$, $55\%$ humidity, $110\text{ ppm}$ VOC) and Tray 1 weight ($14.50\text{ kg}$).
   - `public.sensor_telemetry` received the records.
   - Remote trigger updated `food_trays.current_weight_kg` to `14.50`.
   - Remote trigger updated `smart_bins.last_heartbeat_at`.

---

## 7. Security Tests Executed

Automated security suite executed via [`scratch/test-phase3-security.js`](file:///C:/Users/DELL/final_year_project/FoodTrust/scratch/test-phase3-security.js):

| # | Test Case | Target | Expected | Result |
|---|-----------|--------|----------|--------|
| 1 | Missing `x-bin-id` | Telemetry | 401 | ✅ PASS |
| 2 | Missing `x-device-token` | Telemetry | 401 | ✅ PASS |
| 3 | Invalid token | Telemetry | 401 | ✅ PASS |
| 4 | Unknown bin code | Telemetry | 401 | ✅ PASS |
| 5 | Valid credentials + valid payload | Telemetry | 200 | ✅ PASS |
| 6 | Payload `binCode` mismatch | Telemetry | 400 | ✅ PASS |
| 7 | Temperature out of bounds (-25°C) | Telemetry | 400 | ✅ PASS |
| 8 | Humidity > 100% | Telemetry | 400 | ✅ PASS |
| 9 | Battery > 100% | Telemetry | 400 | ✅ PASS |
| 10 | Tray number 0 | Telemetry | 400 | ✅ PASS |
| 11 | Negative weight | Telemetry | 400 | ✅ PASS |
| 12 | Unregistered tray slot | Telemetry | 400 | ✅ PASS |
| 13 | Valid heartbeat | Heartbeat | 200 | ✅ PASS |
| 14 | Missing heartbeat headers | Heartbeat | 401 | ✅ PASS |
| 15 | Secret leakage audit | All | No leaks | ✅ PASS |
| 16 | Rate limit flood (65 requests) | Heartbeat | 429 at #60 | ✅ PASS |
| 17 | Maintenance status preservation | Heartbeat | Status stays MAINTENANCE | ✅ PASS |

---

## 8. Documentation Delivered

- [`docs/IOT_API_CONTRACT.md`](file:///C:/Users/DELL/final_year_project/FoodTrust/docs/IOT_API_CONTRACT.md): Comprehensive hardware-to-cloud specification for future ESP32 C++ firmware implementation.
- [`docs/IOT_CURL_GUIDE.md`](file:///C:/Users/DELL/final_year_project/FoodTrust/docs/IOT_CURL_GUIDE.md): Copy-paste cURL examples for manual testing and Postman reproduction.

---

## 9. Known Limitations & Production Recommendations

1. **Rate Limiter Storage:** The current sliding window rate limiter operates in-memory on the Node.js runtime. In distributed multi-region serverless deployments, this should be backed by Upstash Redis or AWS ElastiCache.
2. **Replay Protection:** Telemetry rejects timestamps $>5\text{ minutes}$ in the future (clock skew threshold). Full nonce-based replay protection can be added in a future security hardening iteration if edge hardware supports RTC clock synchronization.

---

## 10. Phase 4 Prerequisites (Freshness Assessment Service)

Before Phase 4 is initiated:
- Telemetry ingestion is confirmed operational.
- Decay kinetics formula from `ARCHITECTURE.md` Section 7 is ready for implementation:
  $$S = S_0 \times e^{-k(T) \cdot \Delta t} \times \left(1 - \frac{G - G_0}{G_{\max}}\right)$$
- Mandatory decision-support disclaimers are standardized across all evaluation responses.

---

## 11. Boundary Enforcement (Do NOT Implement)

The following were explicitly excluded from Phase 3 per project rules:
- ❌ Freshness evaluation service & background jobs
- ❌ NGO matching engine & PostGIS proximity queries
- ❌ Donation creation and lifecycle endpoints (`/api/donations/*`)
- ❌ Pickup fulfillment & OTP generation (`/api/pickups/*`)
- ❌ Realtime notification broadcast
- ❌ Complete ESP32 production C++ firmware project
