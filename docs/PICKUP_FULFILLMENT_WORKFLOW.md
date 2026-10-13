# Pickup & Fulfillment Workflow Specification

**FoodTrust Backend Architecture — Phase 8**

This document specifies the authoritative workflow for donation collection, physical handoff verification via cryptographic 6-digit OTP, delivery completion, proof-of-delivery metadata, and impact metric computation.

---

## 1. Domain Workflow & Lifecycle State Machine

The pickup lifecycle operates in lockstep with the donation lifecycle:

```
Claim: APPROVED 
Donation: CLAIMED
       │
       ▼ (Collecting NGO or Admin Schedules Pickup)
Pickup:   SCHEDULED
Donation: PICKUP_IN_PROGRESS
       │
       ▼ (Donor Generates/Views 6-digit OTP on Donor Dashboard)
Pickup:   SCHEDULED (otp_code_hash updated)
       │
       ▼ (Physical Handover: NGO Volunteer Submits OTP to Server)
Pickup:   PICKED_UP (picked_up_at recorded)
Donation: PICKED_UP
       │
       ▼ (NGO Delivers Food to Facility & Uploads Proof Photo)
Pickup:   DELIVERED (delivered_at, proof_image_url)
Donation: DELIVERED (Terminal State)
       │
       ▼ (Automated UNEP/FAO Impact Metric Logging)
public.impact_metrics: Record created (idempotent ON CONFLICT DO NOTHING)
```

### State Mapping Table

| Pickup Status | Donation Status | Allowed Operations | Authorized Actors |
|---|---|---|---|
| `SCHEDULED` / `EN_ROUTE` / `ARRIVED` | `PICKUP_IN_PROGRESS` | View Pickup, View OTP (Donor only), Verify OTP | Donor, Assigned NGO, Admin |
| `FAILED` | `PICKUP_IN_PROGRESS` | Locked out (Max 3 failed OTP attempts exceeded) | Inactive (Requires Admin review) |
| `PICKED_UP` | `PICKED_UP` | Complete Delivery with Proof Photo | Assigned NGO, Admin |
| `DELIVERED` | `DELIVERED` | View Only (Terminal state) | Donor, Assigned NGO, Admin |

---

## 2. Secure OTP Specification

### Cryptographic Generation & Storage
- **Length:** 6 uniformly distributed numeric digits (`100000` to `999999`) generated using `crypto.randomInt()`.
- **Hashing Formula:**  
  $$\text{Hash} = \text{SHA256}(\text{otp} : \text{IOT\_DEVICE\_SHARED\_SALT} : \text{pickupId})$$
- **Storage Hygiene:** The plaintext OTP is **NEVER** stored in the database, audit logs, or error traces.
- **Exposure Control:** The plaintext OTP is exposed strictly to the **DONOR owner** of the donation (or Admin) via `POST /api/pickups/[id]/generate-otp`. The collecting NGO representative **CANNOT** view or retrieve the OTP.
- **Exclusion in DTOs:** In all `GET /api/pickups` and `GET /api/pickups/[id]` endpoints, `otp_code_hash` is explicitly deleted before sending JSON responses to clients.

### Verification & Brute-Force Resistance
- **Constant-Time Comparison:** Evaluated using `crypto.timingSafeEqual` to prevent side-channel timing attacks.
- **Attempt Counter:** The pickup record tracks `otp_attempt_count`. Each incorrect submission increments the counter atomically.
- **Lockout:** Upon reaching **3 failed attempts**, the pickup status immediately transitions to `FAILED` and all further verification attempts are rejected with `HTTP 403 Forbidden`.
- **Validity Window:** OTP expires after **120 minutes** (`OTP_CONFIG.EXPIRY_MINUTES`). Expired OTPs reject verification with `HTTP 409 Conflict`.

---

## 3. Atomicity & Concurrency Strategy

1. **Unique Pickup Constraint:** `public.pickups` enforces `donation_id UUID NOT NULL UNIQUE REFERENCES food_donations(id)`. Two concurrent scheduling attempts on the same donation are blocked by PostgreSQL unique constraint violation.
2. **OCC State Transitions:**
   - Scheduling: Conditional update `WHERE id = donation_id AND status = 'CLAIMED'`.
   - Verification: Conditional update `WHERE id = pickup_id AND status IN ('SCHEDULED', 'EN_ROUTE', 'ARRIVED')`.
   - Completion: Conditional update `WHERE id = pickup_id AND status = 'PICKED_UP'`.
   If 0 rows are affected by any of these queries, the operation detects a concurrent mutation and returns `HTTP 409 Conflict`.

---

## 4. Proof of Delivery & Storage

- The endpoint `POST /api/pickups/[id]/complete` accepts an optional `proofImageUrl`.
- **Validation:** URLs must be valid HTTPS URLs referencing the designated `proof-photos` storage bucket.
- **Integrity Rule:** A photo URL is metadata of delivery completion; it is never a substitute for cryptographic OTP physical handoff verification.

---

## 5. UNEP / FAO Impact Metrics

Upon transition to `DELIVERED`, the system computes:
- $\text{estimated\_meals\_served} = \text{ROUND}(\text{weight\_kg} / 0.40)$
- $\text{estimated\_co2\_offset\_kg} = \text{weight\_kg} \times 2.50$

The metric is inserted into `public.impact_metrics` (`donation_id UNIQUE`). Duplicate delivery completion requests cannot create duplicate impact metrics.

---

## 6. Authorization Matrix

| Operation | Path | DONOR | Assigned NGO | Unrelated NGO | ADMIN |
|---|---|:---:|:---:|:---:|:---:|
| **List Pickups** | `GET /api/pickups` | Own donations | Own pickups | Forbidden (403) | All pickups |
| **Get Pickup** | `GET /api/pickups/[id]` | Own donation | Assigned pickup | Forbidden (403) | Any pickup |
| **Schedule Pickup** | `POST /api/pickups` | Forbidden (403) | Allowed (claimed donation) | Forbidden (403) | Allowed |
| **Generate/View OTP**| `POST /api/pickups/[id]/generate-otp` | Allowed (own donation) | Forbidden (403) | Forbidden (403) | Allowed |
| **Verify OTP** | `POST /api/pickups/[id]/verify-otp` | Forbidden (403) | Allowed (assigned pickup) | Forbidden (403) | Allowed |
| **Complete Delivery**| `POST /api/pickups/[id]/complete` | Forbidden (403) | Allowed (assigned pickup) | Forbidden (403) | Allowed |
