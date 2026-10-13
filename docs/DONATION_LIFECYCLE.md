# Food Donation Lifecycle Specification

**FoodTrust Backend Architecture — Phase 6**

This document specifies the authoritative state machine, validation rules, optimistic concurrency control (OCC), access control matrix, and audit logging model for food donations.

---

## 1. Donation Lifecycle State Machine

The food donation lifecycle is strictly modeled as a finite state machine:

```
                  ┌──────────────────────┐
                  │      AVAILABLE       │
                  └──────────┬───────────┘
                             │
            ┌────────────────┼────────────────┐
            │ (NGO Match/    │ (Donor/Admin   │ (Shelf Life
            │  Claim Intent) │  Cancellation) │  Expiration)
            ▼                ▼                ▼
     ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
     │  RESERVED   │  │  CANCELLED  │  │   EXPIRED   │
     └──────┬──────┘  │  (Terminal) │  │  (Terminal) │
            │         └─────────────┘  └─────────────┘
      ┌─────┴───────────────────────┐
      │ (NGO Formal Confirmation)   │ (Claim Expiry / Release)
      ▼                             ▼
┌─────────────┐              ┌─────────────┐
│   CLAIMED   │              │  AVAILABLE  │
└──────┬──────┘              └─────────────┘
       │
       │ (Volunteer Dispatch)
       ▼
┌──────────────────────┐
│  PICKUP_IN_PROGRESS  │
└──────────┬───────────┘
           │
           │ (OTP Handoff Verification)
           ▼
     ┌─────────────┐
     │  PICKED_UP  │
     └──────┬──────┘
            │
            │ (Proof of Drop-off / Delivery)
            ▼
     ┌─────────────┐
     │  DELIVERED  │
     │  (Terminal) │
     └─────────────┘
```

---

## 2. Transition Matrix

| Current Status | Allowed Target States | Permitted Roles / Trigger | Notes |
| :--- | :--- | :--- | :--- |
| `AVAILABLE` | `RESERVED`, `CANCELLED`, `EXPIRED` | Donor (Owner), Admin, System | Initial state upon donation creation. |
| `RESERVED` | `CLAIMED`, `AVAILABLE`, `CANCELLED`, `EXPIRED` | NGO, Donor, Admin, System | Claim hold / reservation window. |
| `CLAIMED` | `PICKUP_IN_PROGRESS`, `CANCELLED`, `EXPIRED` | NGO, Donor, Admin | Formal claim accepted. |
| `PICKUP_IN_PROGRESS` | `PICKED_UP` | System (Phase 7 OTP completion) | Driver in transit. |
| `PICKED_UP` | `DELIVERED` | System (Phase 7 Delivery confirmation) | Food in transit to NGO facility. |
| `DELIVERED` | None | None | **Terminal State.** Immutable. |
| `CANCELLED` | None | None | **Terminal State.** Immutable. |
| `EXPIRED` | None | None | **Terminal State.** Immutably closed. |

Any transition not listed above is explicitly rejected with HTTP 409 Conflict.

---

## 3. Optimistic Concurrency Control (OCC)

To prevent race conditions, double claiming, and dirty updates during high-concurrency operations, all status mutations enforce atomic SQL conditional updates:

```sql
UPDATE food_donations
SET status = :targetStatus, updated_at = NOW()
WHERE id = :donationId AND status = :expectedCurrentStatus
RETURNING *;
```

If 0 rows are affected by this query, the operation detects that the donation was modified concurrently by another transaction and immediately rejects the operation with an HTTP 409 Conflict error.

---

## 4. Role & Field Permission Matrix

| Operation | Path | DONOR | NGO | ADMIN / SUPER_ADMIN |
| :--- | :--- | :---: | :---: | :---: |
| **List Donations** | `GET /api/donations` | View own | View `AVAILABLE` | View all |
| **Get Donation** | `GET /api/donations/[id]` | View own | View `AVAILABLE` or claimed | View all |
| **Create Donation** | `POST /api/donations` | Allowed | Forbidden (403) | Forbidden (403) |
| **Update Donation** | `PATCH /api/donations/[id]` | Allowed (while `AVAILABLE`) | Forbidden (403) | Allowed (while `AVAILABLE`) |
| **Cancel Donation** | `POST /api/donations/[id]/cancel` | Allowed (own donation) | Forbidden (403) | Allowed (any donation) |
| **Transition Status**| `POST /api/donations/[id]/transition` | Forbidden (403) | Forbidden (403) | Allowed |
| **View Freshness** | `GET /api/donations/[id]/freshness` | View own | View `AVAILABLE` or claimed | View all |

### Critical Security Constraints
1. **No Spoofing `donor_id`**: The `donor_id` is resolved strictly server-side from `donor_profiles.user_id = session.user.id`. Any `donor_id` in request payloads is ignored.
2. **Immutable System Fields via PATCH**: Clients cannot update `status`, `freshness_score`, `freshness_status`, `risk_level`, or `shelf_life_hours_remaining` via `PATCH /api/donations/[id]`.
3. **Modifications restricted to AVAILABLE**: Once a donation transitions out of `AVAILABLE`, all core attributes (quantity, category, location) are locked.

---

## 5. Audit Logging

Every state transition and donation creation appends an immutable entry to `audit_logs`:

- `actor_id`: User ID initiating the transition
- `actor_role`: Role of the user at the time of the action
- `action`: `DONATION_CREATED`, `DONATION_UPDATED`, `DONATION_STATUS_CHANGED`, `DONATION_CANCELLED`
- `target_table`: `food_donations`
- `target_id`: UUID of the donation record
- `old_values`: Previous state / attributes
- `new_values`: New state / attributes and optional reason
- `ip_address`: Client IP address from request headers
- `created_at`: Timestamp (UTC)
