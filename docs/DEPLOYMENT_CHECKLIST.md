# 🚀 FoodTrust — Production Deployment & Operational Readiness Checklist

**Document Version:** 1.0.0  
**Phase:** Phase 12 — ESP32 Hardware Integration & Deployment Readiness  
**Target Environments:** Vercel / Node.js Container, Supabase PostgreSQL, ESP32 Edge Devices

---

## 1. Environment Variables & Secret Hygiene

Verify that all required environment variables are set in production and never committed to version control:

| Variable | Scope | Requirement / Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Public / Edge | Supabase project HTTPS endpoint |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public / Edge | Client-side anon key (governed by RLS) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only | Service-role administrative bypass key |
| `IOT_DEVICE_SHARED_SALT` | Server-only | Cryptographic salt for device token SHA-256 hashing |
| `NEXT_PUBLIC_APP_URL` | Public / App | Base canonical domain (e.g., `https://foodtrust.org`) |
| `NODE_ENV` | Runtime | Must be `production` |

> [!CAUTION]
> Ensure `IOT_DEVICE_SHARED_SALT` is at least 32 random characters and stored securely in your deployment platform's secret manager (e.g., AWS Secrets Manager, Vercel Environment Variables). Never log this salt.

---

## 2. Supabase PostgreSQL & PostGIS Verification

Ensure database infrastructure satisfies all requirements:

- [x] **PostGIS Extension:** Verified active (`CREATE EXTENSION IF NOT EXISTS postgis;`).
- [x] **Database Migrations:** All 9 migration scripts applied up to `20261001000009_system_config.sql`.
- [x] **Row-Level Security (RLS):** Enabled on all 11 core tables (`users`, `donor_profiles`, `ngo_profiles`, `smart_bins`, `food_trays`, `sensor_telemetry`, `food_donations`, `donation_claims`, `pickups`, `notifications`, `system_config`, `audit_logs`).
- [x] **Partial Unique Indexes:** Verified active on `donation_claims(donation_id)` for pending/approved claims to enforce OCC.
- [x] **Database Constraints:** Weight limits, status enums, and foreign key cascades validated.

---

## 3. Server & Network Security Posture

- [x] **TLS 1.3 Enforcement:** All incoming client and device traffic must use HTTPS. Plain HTTP traffic must redirect to HTTPS (HTTP 301).
- [x] **IoT Constant-Time Auth:** Header authentication via `crypto.timingSafeEqual` prevents timing attacks on `x-device-token`.
- [x] **Sliding-Window Rate Limiting:** In-memory sliding window enforces 60 requests/minute per smart bin (`lib/utils/rate-limiter.ts`).
- [x] **Sanitized Logging:** OTP codes, password hashes, and device tokens are redacted from server logs and audit endpoints.
- [x] **CORS & Cookies:** Session cookies configured with `HttpOnly; Secure; SameSite=Lax`.

---

## 4. ESP32 Microcontroller Deployment

Before deploying hardware in the field:

- [x] **Sanitary Isolation:** Electronics unit is physically outside the refrigerated food chamber with IP67 silicone cable gland.
- [x] **Hardware Power Failover:** 5V step-down mains power backed up by LiFePO4 battery pack with 2A thermal fuse protection.
- [x] **Firmware Secrets:** `include/config.h` populated from `config.h.example` with local Wi-Fi and unique provisioned device token.
- [x] **Transmission Intervals:** Firmware adheres to rate limits (telemetry every 30s, heartbeat every 60s).
- [x] **OTA / Maintenance Plan:** Bin maintenance mode keeps the device in `MAINTENANCE` status, preventing automatic `ONLINE` overwrites.

---

## 5. Verification Commands for Release Signoff

Execute before every release deployment:

```bash
# 1. TypeScript Strict Typecheck
npm run typecheck

# 2. Production Build Verification
npm run build

# 3. Phase 12 IoT Automated Suite
npx tsx scratch/test-phase12-iot.ts

# 4. Phase 10 End-to-End Regression Suite
npx tsx scratch/test-phase10-e2e.ts

# 5. Phase 11 Frontend Integration Suite
npx tsx scratch/test-phase11-frontend.ts
```

All suites must report 0 failures before deploying to production.
