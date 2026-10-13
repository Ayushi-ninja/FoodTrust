# FoodTrust — End-to-End Testing & Integration Verification Guide

This guide describes how to run and interpret the end-to-end integration and concurrency test suites for FoodTrust.

---

## 1. Prerequisites & Environment Setup

Ensure your local `.env.local` contains valid Supabase connection details:

```bash
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_SUPABASE_URL=https://<your-project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
IOT_DEVICE_SHARED_SALT=prototype_test_salt_secure_2026
IOT_INGESTION_RATE_LIMIT=60
DEFAULT_SEARCH_RADIUS_KM=15
```

---

## 2. Test Suites Overview

The FoodTrust backend has automated verification suites located in the `scratch/` directory:

| Test Script | Phase Tested | Assertions | Focus Area |
| :--- | :---: | :---: | :--- |
| `scratch/test-phase10-e2e.ts` | **Phase 10** | **46** | Full E2E Lifecycle & Multi-Service Integration |
| `scratch/test-phase9-analytics.ts`| **Phase 9** | **62** | Analytics Aggregations, Notifications, Admin |
| `scratch/test-phase8-pickups.ts` | **Phase 8** | **34** | Pickup Workflow, OTP Lockout & Handoff, Impact |
| `scratch/test-phase7-claims.ts` | **Phase 7** | **22** | NGO Claiming, OCC Atomicity, Double-Claim Race |
| `scratch/test-phase6-donations.ts`| **Phase 6** | **37** | Donation Lifecycle State Machine Transitions |
| `scratch/test-phase6-security-audit.ts`| **Phase 6** | **33** | Security Matrix, IDOR Guards, OCC & Invariants |

**Total Cumulative Assertions:** **234 Tests (100% Passing)**

---

## 3. Running the Verification Suites

### Run the Phase 10 End-to-End Suite
```bash
npx tsx scratch/test-phase10-e2e.ts
```

### Run All Test Suites
```bash
npx tsx scratch/test-phase6-donations.ts
npx tsx scratch/test-phase6-security-audit.ts
npx tsx scratch/test-phase7-claims.ts
npx tsx scratch/test-phase8-pickups.ts
npx tsx scratch/test-phase9-analytics.ts
npx tsx scratch/test-phase10-e2e.ts
```

### Typecheck & Production Build Gates
```bash
npm run typecheck
npm run build
```

---

## 4. End-to-End Lifecycle Stages Verified

The Phase 10 E2E suite (`scratch/test-phase10-e2e.ts`) exercises the full 12-stage workflow in order:

1. **Actor Resolution:** Fetches verified Donor, NGO, and Admin actors from database.
2. **Freshness Assessment:** Calculates Arrhenius temperature decay and VOC gas penalty.
3. **Donation Creation:** Inserts donation in `AVAILABLE` status with evaluated freshness and audit event.
4. **Smart NGO Matching:** Finds and ranks eligible NGOs by spatial proximity and capacity.
5. **Concurrent Claiming Race:** Simulates competing claims; verifies OCC conditional lock and partial unique index (`wins = 1, conflicts = 1`).
6. **Pickup Scheduling:** Transitions donation to `PICKUP_IN_PROGRESS` and validates duplicate pickup rejection.
7. **Handoff OTP Retrieval:** Verifies donor owner access and blocks collecting NGO from viewing OTP.
8. **Physical Exchange & OTP Verification:** Tests wrong OTP attempt counter and completes handoff on valid code (`PICKED_UP`).
9. **Delivery Completion & Impact:** Updates status to `DELIVERED` and persists FAO/UNEP conversion impact metrics.
10. **In-App Notifications:** Validates notification dispatch, listing, mark-as-read, and IDOR protection.
11. **DB-Side Analytics:** Verifies aggregate metrics across Overview, Donor, NGO, and Admin views.
12. **Admin Oversight & Sanitization:** Verifies user listing, configuration read/write, and audit log token sanitization.

---

## 5. Postman Testing Workflow

1. Open Postman and import:
   - Collection: `postman/FoodTrust_API_v1.postman_collection.json`
   - Environment: `postman/FoodTrust_Local.postman_environment.json`
2. Select the **FoodTrust Local Environment**.
3. Ensure the backend server is running (`npm run dev`).
4. Execute the requests sequentially from Folder 1 through Folder 11.
5. Verify test assertions in the Postman Test Results tab.
