# NGO Claim Workflow Specification

**FoodTrust Backend Architecture — Phase 7**

This document specifies the authoritative claim lifecycle, atomicity and race-condition prevention mechanics, access control, and interaction with donation lifecycle states.

---

## 1. Overview & Objective

The NGO Claim Management subsystem enables eligible, verified NGOs to claim available food donations.
The system guarantees that:
1. Matching is strictly recommendation-only; claims require explicit, intentional submission.
2. Concurrent claim attempts on the same donation are handled deterministically without race conditions or double allocations.
3. Donation status and claim status remain tightly synchronized.
4. Unauthorized access, IDOR vulnerabilities, and credential impersonation are prevented.

---

## 2. Claim & Donation State Mapping

The system manages two interacting state machines: `food_donations.status` and `donation_claims.status`.

```
Donation: AVAILABLE ──[ NGO Claim Committed ]──> Donation: CLAIMED
                                                     │
                                            Claim: APPROVED
                                                     │
                             ┌───────────────────────┴───────────────────────┐
                             │ (Donor/Admin Rejection)                       │ (Phase 8: Fulfillment)
                             ▼                                               ▼
                     Donation: AVAILABLE                             Donation: PICKUP_IN_PROGRESS
                     Claim:    REJECTED                              Claim:    APPROVED
```

### State Mapping Table

| Donation Status | Allowed Active Claim Status | Meaning | Permitted Operations |
|---|---|---|---|
| `AVAILABLE` | None | Open in distribution pool. | Matching, Claiming, Updating (Donor), Cancellation (Donor/Admin) |
| `CLAIMED` | `APPROVED` | Allocated to claiming NGO. | Claim Retrieval, Claim Rejection (Donor/Admin), Pickup Dispatch (Phase 8) |
| `RESERVED` | `PENDING` / `APPROVED` | Temporary hold (if explicit reservation applied). | Claim Confirmation, Timeout Rollback |
| `CANCELLED` | None / `REJECTED` | Donor withdrawn from circulation. | Inactive. Immutable. |
| `EXPIRED` | None / `EXPIRED` | Shelf life decayed past viable distribution. | Inactive. Immutable. |

---

## 3. Atomicity & Concurrency Strategy

To guarantee that two NGOs claiming the same donation simultaneously cannot both succeed:

### Two-Tier Concurrency Guard
1. **Tier 1 (Optimistic Concurrency Control):**
   The donation status is atomically checked and mutated in a conditional query:
   ```sql
   UPDATE food_donations
   SET status = 'CLAIMED', updated_at = NOW()
   WHERE id = :donationId AND status = 'AVAILABLE'
   RETURNING *;
   ```
   If zero rows are returned, the transaction detects a concurrent state mutation and immediately halts with `HTTP 409 Conflict`.

2. **Tier 2 (Database Partial Unique Index):**
   The database enforces index `idx_single_active_claim`:
   ```sql
   CREATE UNIQUE INDEX idx_single_active_claim
     ON public.donation_claims (donation_id)
     WHERE status IN ('APPROVED', 'PENDING');
   ```
   If a duplicate insert is attempted, PostgreSQL throws error code `23505` (unique violation), and a compensating rollback reverts the donation status.

---

## 4. Authorization Matrix

| Role | Submit Claim (`POST /api/donations/[id]/claim`) | List Claims (`GET /api/claims`) | View Claim (`GET /api/claims/[id]`) | Reject Claim (`POST /api/claims/[id]/reject`) |
|---|:---:|:---:|:---:|:---:|
| **NGO (Verified)** | Allowed (own profile) | Allowed (own claims only) | Allowed (own claims only) | Forbidden (403) |
| **NGO (Unverified/Pending)** | Forbidden (403) | Allowed (own claims) | Allowed (own claims) | Forbidden (403) |
| **DONOR** | Forbidden (403) | Allowed (claims on own donations) | Allowed (claims on own donations) | Allowed (claims on own donations) |
| **ADMIN / SUPER_ADMIN**| Forbidden (403 directly) | Allowed (all claims) | Allowed (all claims) | Allowed (any claim) |
| **DEVICE** | Forbidden (401/403) | Forbidden (401/403) | Forbidden (401/403) | Forbidden (401/403) |

---

## 5. API Endpoints

- `POST /api/donations/[id]/claim` — Submit a claim for an available donation.
- `GET /api/claims` — List claims (filtered by role and query params `status`, `donationId`, `limit`, `offset`).
- `GET /api/claims/[id]` — View individual claim details.
- `POST /api/claims/[id]/reject` — Reject active claim and return donation to `AVAILABLE`.

---

## 6. Audit Trail

Audit records are logged via `lib/services/audit.service.ts`:
- `DONATION_CLAIM_CREATED` — Generated upon successful claim submission.
- `DONATION_CLAIM_REJECTED` — Generated when a donor or admin rejects a claim.
