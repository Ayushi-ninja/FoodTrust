# PHASE 6 SECURITY & REGRESSION AUDIT REPORT

**Project:** FoodTrust Backend  
**Audit Scope:** Phase 6 — Food Donation Lifecycle Management (and Regressions in Phases 1–5)  
**Date of Audit:** 2026-10-11  
**Auditor Mode:** Audit first, minimal fixes applied strictly on demonstrated defects  

---

## 1. Overall Verdict

**VERDICT: PASS WITH FIXES**

### Explanation
All core Phase 6 security controls, authorization boundaries, IDOR protections, and optimistic concurrency control (OCC) state transitions were verified against the live remote Supabase instance. Two genuine defects were identified and resolved with minimal, isolated corrections:
1. **Freshness Route Schema Alignment:** `GET /api/donations/[id]/freshness` had a property mismatch with the database schema (`prepared_at` instead of `preparation_timestamp` and mismatched field names when reading `freshness_logs`). Fixed to query the correct columns (`preparation_timestamp`, `evaluated_score`, `shelf_life_hours`, `gas_reading_ppm`).
2. **Matching Engine Lifecycle Status Guard:** `matchNgosForDonation` in Phase 5 did not explicitly assert that a donation was in the `AVAILABLE` state, allowing inactive or cancelled donations to generate recommendations. Fixed with a strict lifecycle guard ensuring non-AVAILABLE donations are rejected with a 400 Bad Request error.

---

## 2. Files and Components Inspected

| File | Type | Inspection Focus |
|---|---|---|
| [`lib/services/donation-lifecycle.service.ts`](file:///C:/Users/DELL/final_year_project/FoodTrust/lib/services/donation-lifecycle.service.ts) | Service | Transition matrix, OCC conditional SQL updates, terminal state immutability |
| [`lib/services/donation.service.ts`](file:///C:/Users/DELL/final_year_project/FoodTrust/lib/services/donation.service.ts) | Service | Creation logic, donor_id server resolution, freshness integration, update guards |
| [`lib/services/freshness.service.ts`](file:///C:/Users/DELL/final_year_project/FoodTrust/lib/services/freshness.service.ts) | Service | Spoilage kinetic calculations, ambient defaults, statutory compliance disclaimer |
| [`lib/services/ngo-matching.service.ts`](file:///C:/Users/DELL/final_year_project/FoodTrust/lib/services/ngo-matching.service.ts) | Service | Recommendation engine read-only contract, donation status filtering |
| [`lib/services/audit.service.ts`](file:///C:/Users/DELL/final_year_project/FoodTrust/lib/services/audit.service.ts) | Service | Non-blocking audit logging, avoidance of secrets and credentials |
| [`lib/auth/session.ts`](file:///C:/Users/DELL/final_year_project/FoodTrust/lib/auth/session.ts) | Auth | Server-side user profile resolution from database |
| [`lib/auth/rbac.ts`](file:///C:/Users/DELL/final_year_project/FoodTrust/lib/auth/rbac.ts) | RBAC | Role checks (`requireAuth`, `requireRole`, `requireAnyRole`) and suspended user checks |
| [`lib/validation/donation.schema.ts`](file:///C:/Users/DELL/final_year_project/FoodTrust/lib/validation/donation.schema.ts) | Validation | Zod schemas, immutability of system and freshness fields |
| `app/api/donations/route.ts` | Endpoint | Role-aware donation listing and creation |
| `app/api/donations/[id]/route.ts` | Endpoint | Donation detail retrieval (IDOR) and PATCH updates restricted to `AVAILABLE` |
| `app/api/donations/[id]/cancel/route.ts` | Endpoint | Dedicated cancellation endpoint |
| `app/api/donations/[id]/transition/route.ts` | Endpoint | Admin-only status transition route |
| `app/api/donations/[id]/freshness/route.ts` | Endpoint | Freshness evaluation endpoint with IDOR protection |
| `app/api/matching/ngos/route.ts` | Endpoint | Read-only NGO recommendation endpoint |
| `supabase/migrations/20261001000005_rls_policies.sql` | Migration | Remote RLS policies for `food_donations`, `audit_logs`, and `freshness_logs` |

---

## 3. Authorization and IDOR Findings

| Check | Result | Verification Evidence |
|---|:---:|---|
| Unauthenticated requests rejected | **PASS** | `requireAuth()` returns 401 Unauthorized across all donation endpoints. |
| Suspended users rejected | **PASS** | `requireAuth()` asserts `user.status !== 'SUSPENDED'`, returning 403 Forbidden. |
| Donors cannot create on behalf of other donors | **PASS** | `donor_id` is resolved strictly server-side from `donor_profiles` using `session.user.id`. Request body `donor_id` is stripped. |
| NGO cannot create donations | **PASS** | `createFoodDonation()` verifies `actor.role === 'DONOR'`; NGO submission rejected with 403 Forbidden. |
| Donor A cannot update Donor B's donation | **PASS** | `updateFoodDonation()` asserts `donor_profiles.user_id === actor.id`; rejected with 403 Forbidden. |
| Donor A cannot cancel Donor B's donation | **PASS** | `transitionDonationStatus()` asserts ownership or admin role; rejected with 403 Forbidden. |
| NGO cannot view private non-available donations | **PASS** | `GET /api/donations/[id]` restricts NGOs to donations in `AVAILABLE` status or claimed by that NGO. |
| Client cannot mutate `status` via `PATCH` | **PASS** | Schema lacks `status` shape; endpoint explicitly intercepts `status` in payload and returns 403 Forbidden. |
| Client cannot mutate `freshness_score` via `PATCH` | **PASS** | Schema lacks `freshness_score` shape; endpoint explicitly intercepts freshness keys and returns 403 Forbidden. |
| Client cannot mutate `donor_id` via `PATCH` | **PASS** | Schema lacks `donor_id` shape; endpoint explicitly intercepts ownership transfer attempts and returns 403 Forbidden. |
| Device credentials cannot manage donations | **PASS** | Device auth relies on `x-device-token` for `/api/iot/*` routes; donation routes strictly require human Supabase session tokens. |

---

## 4. Lifecycle and Terminal-State Findings

### Actual State Machine Matrix
```
AVAILABLE ──> RESERVED ──> CLAIMED ──> PICKUP_IN_PROGRESS ──> PICKED_UP ──> DELIVERED [Terminal]
   │             │            │
   ├─── CANCELLED [Terminal] ─┘
   └─── EXPIRED   [Terminal]
```

### Prohibited Transition Test Evidence
- `DELIVERED → AVAILABLE`: Prohibited (rejected with 409 Conflict)
- `DELIVERED → CLAIMED`: Prohibited (rejected with 409 Conflict)
- `CANCELLED → DELIVERED`: Prohibited (rejected with 409 Conflict)
- `CANCELLED → AVAILABLE`: Prohibited (rejected with 409 Conflict)
- `EXPIRED → CLAIMED`: Prohibited (rejected with 409 Conflict)
- `EXPIRED → AVAILABLE`: Prohibited (rejected with 409 Conflict)
- `PICKED_UP → AVAILABLE`: Prohibited (rejected with 409 Conflict)

Once a donation enters `CANCELLED`, `DELIVERED`, or `EXPIRED`, attempts to modify it via `PATCH /api/donations/[id]` or transition it via `/transition` are rejected with HTTP 409 Conflict.

---

## 5. Atomicity and Concurrency

### Implementation
All status transitions perform atomic SQL updates with an Optimistic Concurrency Control (OCC) predicate:
```sql
UPDATE food_donations
SET status = :targetStatus, updated_at = NOW()
WHERE id = :donationId AND status = :expectedCurrentStatus
RETURNING *;
```

### Concurrency Race Test Evidence
Simulated two simultaneous requests (`Promise.all`) competing to transition the same donation from `AVAILABLE`:
- **Attempt 1:** Transition from `AVAILABLE` to `CANCELLED`
- **Attempt 2:** Transition from `AVAILABLE` to `RESERVED`
- **Result:** Exactly **one** transition succeeded (200 OK); the losing transaction affected 0 rows and received **HTTP 409 Conflict**. No dirty overwrites occurred.

---

## 6. Freshness Integrity

- **Centralized Calculation:** Freshness scores are evaluated solely through `evaluateFreshness()` in `lib/services/freshness.service.ts`.
- **Missing Telemetry Handling:** If sensor telemetry is unavailable (such as manual donations without an active smart bin), the service applies documented ambient defaults (22°C ambient, 55% humidity, 50 ppm VOC clean air baseline). Telemetry is never fabricated as real sensor readings; the API response flags `source: 'ambient_defaults'`.
- **Disclaimer Presence:** All freshness evaluations return the mandatory decision-support disclaimer:  
  `"Decision-support indicator based on ambient telemetry; not a certified substitute for food safety testing."`
- **Safety Certification Prohibition:** No `safe_to_eat` binary flag is present or exposed.
- **Sensitive Data Exposure:** Error handlers sanitize internal database errors, preventing leakages of stack traces, connection strings, or service keys.

---

## 7. NGO Matching Regression

- **Lifecycle Status Filtering:** Corrected matching engine to assert `donation.status === 'AVAILABLE'`. Ineligible donations (`CANCELLED`, `EXPIRED`, `DELIVERED`, `CLAIMED`) are rejected with `400 Bad Request`.
- **Read-Only Recommendation Contract:** Confirmed that running `matchNgosForDonation()` produces **zero** side effects:
  - `donation_claims` rows created: **0**
  - `pickups` rows created: **0**
  - Notifications created: **0**
  - Donation status changed: **None** (remains `AVAILABLE`)

---

## 8. Audit Logging

- **Event Coverage:** Verified audit events are appended for `DONATION_CREATED`, `DONATION_UPDATED`, `DONATION_STATUS_CHANGED`, and `DONATION_CANCELLED`.
- **Actor and Target Tracking:** Entries correctly record `actor_id`, `actor_role`, `target_table`, `target_id`, `old_values`, `new_values`, and client IP.
- **Credential Hygiene:** Verified that audit log payloads contain **no** secrets, passwords, or device tokens.
- **Reliability:** Audit logging operates as a **non-blocking, best-effort** service using try/catch to ensure audit storage hiccups do not fail customer donation transactions.

---

## 9. RLS and Database Integrity

- **Inspection:** Inspected migrations in `supabase/migrations/20261001000005_rls_policies.sql`.
- **RLS Enabled:** Verified RLS is active on `food_donations`, `donor_profiles`, `ngo_profiles`, `freshness_logs`, and `audit_logs`.
- **Client Security:** Confirmed `getAdminSupabase()` is isolated to server-side Node.js execution and checks `typeof window === 'undefined'`.

---

## 10. Automated Tests

| Test Suite | Command | Total | Passed | Failed |
|---|---|:---:|:---:|:---:|
| Base Phase 6 Lifecycle Suite | `npx tsx scratch/test-phase6-donations.ts` | 37 | 37 | 0 |
| Phase 6 Security & Regression Audit | `npx tsx scratch/test-phase6-security-audit.ts` | 33 | 33 | 0 |
| **Combined Verified Tests** | | **70** | **70** | **0** |

---

## 11. Live Supabase Verification

Executed against remote Supabase project `https://bucrsoebioyygbmwwysx.supabase.co`:
- **Live Donation Creation:** Created isolated test donation via `createFoodDonation` linked to seed donor. Verified `AVAILABLE` status and initial `freshness_logs` snapshot.
- **Live OCC Race Test:** Two concurrent status mutations executed against the live remote database; exactly one succeeded, and the second returned `409 Conflict`.
- **Live Cancellation & Terminal Immunity:** Transitioned donation to `CANCELLED`; subsequent update attempts and status transitions were rejected with `409 Conflict`.
- **Live Audit Trail:** Verified that `audit_logs` recorded `DONATION_CREATED` and `DONATION_CANCELLED` rows.
- **Seed Data Integrity:** Verified seed donation `a0000006-0000-4000-8000-000000000006` remained untouched and functional for matching.

---

## 12. Fixes Applied

### 1. `app/api/donations/[id]/freshness/route.ts`
- **Defect:** Used `donation.prepared_at` instead of `donation.preparation_timestamp`, and queried non-existent column names `latestLog.freshness_score` and `latestLog.gas_voc_ppm`.
- **Fix:** Corrected mapping to `donation.preparation_timestamp`, `latestLog.evaluated_score`, `latestLog.shelf_life_hours`, and `latestLog.gas_reading_ppm`.
- **Evidence:** Tested with live donation freshness retrieval; verified proper live estimate computation and persisted snapshot return.

### 2. `lib/services/ngo-matching.service.ts` & `app/api/matching/ngos/route.ts`
- **Defect:** Matching engine did not check whether a donation was in the `AVAILABLE` state, allowing inactive/cancelled donations to be matched.
- **Fix:** Added validation guard in `matchNgosForDonation` throwing an error if `donation.status !== 'AVAILABLE'`. Handled in route to return `400 Bad Request`.
- **Evidence:** Verified in Audit E: `AVAILABLE` donation matched successfully; `CANCELLED` donation threw matching eligibility rejection.

---

## 13. Quality Gates

- **TypeScript Compilation (`npm run typecheck`):**
  ```
  > foodtrust-backend@1.0.0 typecheck
  > tsc --noEmit
  [Exit code 0, 0 errors]
  ```
- **Next.js Production Build (`npm run build`):**
  ```
  ▲ Next.js 14.2.35
  ✓ Compiled successfully
  ✓ Generating static pages (17/17)
  [Exit code 0, all routes registered]
  ```

---

## 14. Remaining Risks

1. **Non-blocking Audit Logging:** In the event of high database load or network partition between the application server and Supabase, audit log inserts may fail without failing the primary donation operation. This matches the documented best-effort design.
2. **Clock Skew in Preparation Timestamps:** Client preparation timestamps are validated with a 5-minute tolerance to accommodate device clock skew. If a client clock is significantly skewed, donations may be rejected by the validation schema.

---

## 15. Phase Boundary Confirmation

**EXPLICIT CONFIRMATION:**  
Phase 7 has **NOT** been implemented.
- No NGO claim workflows (`POST /api/donations/[id]/claim` was not created).
- No pickup scheduling, OTP generation/verification, or volunteer dispatch logic was introduced.
- No push notification or Supabase Realtime listeners were created.
- The static frontend views remain completely untouched.
- Phase 7 remains clean for implementation in the next phase.
