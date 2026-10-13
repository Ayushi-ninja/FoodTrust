# FoodTrust API Reference
## Complete Specification of All Implemented Routes (Phases 1–10)

This document provides the authoritative API reference for FoodTrust. Every endpoint documented below corresponds to an actual route handler implemented in `app/api/`.

---

## Table of Contents
1. [General Conventions & Response Structure](#general-conventions)
2. [Health & Authentication](#1-health--authentication)
3. [Profiles](#2-profiles)
4. [IoT & Telemetry](#3-iot--telemetry)
5. [Freshness Assessment](#4-freshness-assessment)
6. [Smart NGO Matching](#5-smart-ngo-matching)
7. [Donations & Lifecycle](#6-donations--lifecycle)
8. [Claims](#7-claims)
9. [Pickups & OTP Handoff](#8-pickups--otp-handoff)
10. [Analytics](#9-analytics)
11. [Notifications](#10-notifications)
12. [Administration](#11-administration)

---

## General Conventions

### Base URL
- Local development: `http://localhost:3000`
- Production: Deployment domain (e.g. `https://foodtrust.dev`)

### Response Envelope
All API handlers return responses conforming to the standard envelope:

**Success Response (HTTP 200 / 201):**
```json
{
  "success": true,
  "data": { ... },
  "message": "Operation completed successfully",
  "timestamp": "2026-10-12T12:00:00.000Z"
}
```

**Error Response (HTTP 4xx / 5xx):**
```json
{
  "success": false,
  "message": "Human-readable description of error",
  "error": { ... },
  "timestamp": "2026-10-12T12:00:00.000Z"
}
```

---

## 1. Health & Authentication

### `GET /api/health`
- **Purpose:** System liveness check and database connectivity verification.
- **Auth:** Public.
- **Response (200 OK):**
  ```json
  { "status": "healthy", "service": "foodtrust-backend", "timestamp": "..." }
  ```
- **Tested in Phase 10:** Yes.

### `POST /api/auth/register`
- **Purpose:** Registers a new user with Supabase Auth and creates corresponding `public.users` record via DB trigger.
- **Auth:** Public.
- **Request Body:**
  ```json
  {
    "email": "user@example.com",
    "password": "Password123!",
    "fullName": "Jane Doe",
    "role": "DONOR", // 'DONOR' | 'NGO'
    "phone": "+919876543210"
  }
  ```
- **Response (201 Created):** User record and session tokens.
- **Tested in Phase 10:** Yes.

### `POST /api/auth/login`
- **Purpose:** Authenticates user credentials via Supabase Auth and establishes HTTP-only session cookie.
- **Auth:** Public.
- **Request Body:**
  ```json
  { "email": "user@example.com", "password": "Password123!" }
  ```
- **Response (200 OK):** User profile, role, status, and session tokens.
- **Tested in Phase 10:** Yes.

### `GET /api/auth/me`
- **Purpose:** Returns authenticated user profile and active session metadata.
- **Auth:** Authenticated session.
- **Response (200 OK):** User record from `public.users`.
- **Tested in Phase 10:** Yes.

### `POST /api/auth/logout`
- **Purpose:** Invalidates active session and clears auth cookies.
- **Auth:** Authenticated session.
- **Response (200 OK):** Success message.
- **Tested in Phase 10:** Yes.

---

## 2. Profiles

### `GET /api/donors/profile`
- **Purpose:** Resolves and returns donor profile for current authenticated session.
- **Auth:** `DONOR` role.
- **Response (200 OK):** Donor profile row from `public.donor_profiles`.
- **Tested in Phase 10:** Yes.

### `PUT /api/donors/profile`
- **Purpose:** Updates donor profile address, coordinates, and business details.
- **Auth:** `DONOR` role.
- **Request Body:** `{ "businessName": "...", "address": "...", "latitude": 28.63, "longitude": 77.21 }`
- **Response (200 OK):** Updated donor profile.
- **Tested in Phase 10:** Yes.

### `GET /api/donors/[id]`
- **Purpose:** Fetches public donor profile details by UUID.
- **Auth:** Authenticated session.
- **Response (200 OK):** Donor profile details.
- **Tested in Phase 10:** Yes.

### `GET /api/ngos/profile`
- **Purpose:** Resolves and returns NGO profile for current authenticated session.
- **Auth:** `NGO` role.
- **Response (200 OK):** NGO profile row from `public.ngo_profiles`.
- **Tested in Phase 10:** Yes.

### `PUT /api/ngos/profile`
- **Purpose:** Updates NGO operational radius, cold storage flag, capacity, and contact info.
- **Auth:** `NGO` role.
- **Request Body:** `{ "organizationName": "...", "operationalRadiusKm": 25, "hasColdStorage": true, ... }`
- **Response (200 OK):** Updated NGO profile.
- **Tested in Phase 10:** Yes.

### `GET /api/ngos/[id]`
- **Purpose:** Fetches verified NGO organization details by UUID.
- **Auth:** Authenticated session.
- **Response (200 OK):** NGO organization details.
- **Tested in Phase 10:** Yes.

---

## 3. IoT & Telemetry

### `GET /api/iot/bins`
- **Purpose:** Lists smart bins assigned to the donor organization or all bins for admins.
- **Auth:** `DONOR` or `ADMIN`.
- **Response (200 OK):** Smart bin records array.
- **Tested in Phase 10:** Yes.

### `POST /api/iot/heartbeat`
- **Purpose:** Device keepalive reporting firmware version, battery, and network status.
- **Auth:** Device API key via `x-device-id` and `x-device-key` headers.
- **Rate Limit:** 60 requests/minute per device.
- **Response (200 OK):** Heartbeat acknowledged.
- **Tested in Phase 10:** Yes.

### `POST /api/iot/telemetry`
- **Purpose:** Ingests sensor readings (temperature, humidity, gas PPM, weight) from smart bins.
- **Auth:** Device API key via `x-device-id` and `x-device-key` headers.
- **Response (201 Created):** Telemetry stored; updates tray weight and checks thresholds.
- **Tested in Phase 10:** Yes.

### `POST /api/iot/trays/[id]/tare`
- **Purpose:** Recalibrates tare weight for a specific tray load cell.
- **Auth:** `DONOR` or `ADMIN`.
- **Response (200 OK):** Tray tare weight updated.
- **Tested in Phase 10:** Yes.

---

## 4. Freshness Assessment

### `POST /api/freshness/evaluate`
- **Purpose:** Decision-support freshness scoring using temperature decay and VOC gas penalties.
- **Auth:** Authenticated session.
- **Request Body:**
  ```json
  {
    "foodCategory": "COOKED_MEALS",
    "preparationTimestamp": "2026-10-12T10:00:00.000Z",
    "temperatureC": 4.5,
    "humidityPct": 60.0,
    "gasReadingPpm": 50
  }
  ```
- **Response (200 OK):**
  ```json
  {
    "evaluatedScore": 88,
    "freshnessStatus": "FRESH",
    "riskLevel": "LOW",
    "estimatedShelfLifeHours": 18.5,
    "disclaimer": "Decision-support indicator based on ambient telemetry; not a certified substitute for food safety testing."
  }
  ```
- **Tested in Phase 10:** Yes.

### `GET /api/donations/[id]/freshness`
- **Purpose:** Retrieves complete historical freshness audit logs for a specific donation.
- **Auth:** Donor owner, Claiming NGO, or Admin.
- **Response (200 OK):** Freshness log records from `freshness_logs`.
- **Tested in Phase 10:** Yes.

---

## 5. Smart NGO Matching

### `GET /api/matching/ngos`
- **Purpose:** Evaluates and ranks verified active NGOs for an available donation within radius.
- **Query Params:** `donationId` (UUID, required), `radiusKm` (number, optional, default 15).
- **Auth:** `DONOR` owner of donation or `ADMIN`.
- **Lifecycle Guard:** Rejects donations that are not `AVAILABLE` (400 Bad Request).
- **Response (200 OK):** Ranked list of NGOs with compatibility scores and explainability factors.
- **Tested in Phase 10:** Yes.

---

## 6. Donations & Lifecycle

### `GET /api/donations`
- **Purpose:** Lists food donations with filtering by status, category, date, and spatial bounds.
- **Auth:** Authenticated session.
- **Response (200 OK):** Array of donation items.
- **Tested in Phase 10:** Yes.

### `POST /api/donations`
- **Purpose:** Creates a food donation with initial freshness evaluation and audit log.
- **Auth:** `DONOR` role.
- **Request Body:**
  ```json
  {
    "title": "Vegetable Biryani",
    "description": "50 meals prepared for banquet",
    "foodCategory": "COOKED_MEALS",
    "quantityKg": 25.0,
    "preparationTimestamp": "2026-10-12T10:00:00.000Z",
    "pickupAddress": "Connaught Place, New Delhi",
    "latitude": 28.6315,
    "longitude": 77.2167
  }
  ```
- **Response (201 Created):** Created donation with status `AVAILABLE`.
- **Tested in Phase 10:** Yes.

### `GET /api/donations/[id]`
- **Purpose:** Retrieves detail of a single donation.
- **Auth:** Authenticated session.
- **Response (200 OK):** Donation record.
- **Tested in Phase 10:** Yes.

### `PUT /api/donations/[id]`
- **Purpose:** Updates donation details (only allowed while in `AVAILABLE` state).
- **Auth:** Donor owner or Admin.
- **Response (200 OK):** Updated donation.
- **Tested in Phase 10:** Yes.

### `POST /api/donations/[id]/transition`
- **Purpose:** OCC-guarded state machine transition.
- **Auth:** Authorized role based on transition matrix.
- **Response (200 OK):** Updated state.
- **Tested in Phase 10:** Yes.

### `POST /api/donations/[id]/cancel`
- **Purpose:** Cancels a donation and records `DONATION_CANCELLED` audit event.
- **Auth:** Donor owner or Admin.
- **Response (200 OK):** Cancelled donation record.
- **Tested in Phase 10:** Yes.

---

## 7. Claims

### `POST /api/donations/[id]/claim`
- **Purpose:** Atomically claims an `AVAILABLE` donation for a verified NGO.
- **Auth:** Verified `NGO` role.
- **Concurrency Protection:** OCC state lock + DB partial unique index `idx_single_active_claim`.
- **Response (201 Created):** Created claim with status `APPROVED`; transitions donation to `CLAIMED`.
- **Tested in Phase 10:** Yes.

### `GET /api/claims`
- **Purpose:** Lists claims filtered by status. NGOs see their claims; Donors see claims on their donations; Admins see all.
- **Auth:** Authenticated session.
- **Response (200 OK):** Paginated claims list.
- **Tested in Phase 10:** Yes.

### `GET /api/claims/[id]`
- **Purpose:** Retrieves claim details with IDOR protection.
- **Auth:** Claiming NGO, Donor owner, or Admin.
- **Response (200 OK):** Claim record.
- **Tested in Phase 10:** Yes.

### `POST /api/claims/[id]/reject`
- **Purpose:** Rejects a claim and releases the donation back to `AVAILABLE`.
- **Auth:** Donor owner or Admin.
- **Response (200 OK):** Rejection confirmed; donation released.
- **Tested in Phase 10:** Yes.

---

## 8. Pickups & OTP Handoff

### `POST /api/pickups`
- **Purpose:** Schedules pickup fulfillment for a `CLAIMED` donation.
- **Auth:** Claiming `NGO` or Admin.
- **Lifecycle Transition:** Donation transitions from `CLAIMED` to `PICKUP_IN_PROGRESS`.
- **Response (201 Created):** Pickup record in `SCHEDULED` status with OTP hash generated.
- **Tested in Phase 10:** Yes.

### `GET /api/pickups`
- **Purpose:** Lists pickups scoped by user role and ownership.
- **Auth:** Authenticated session.
- **Response (200 OK):** Array of pickups (with `otp_code_hash` stripped).
- **Tested in Phase 10:** Yes.

### `GET /api/pickups/[id]`
- **Purpose:** Retrieves pickup details (IDOR-guarded; `otp_code_hash` stripped).
- **Auth:** Claiming NGO, Donor owner, or Admin.
- **Response (200 OK):** Pickup details.
- **Tested in Phase 10:** Yes.

### `POST /api/pickups/[id]/generate-otp`
- **Purpose:** Retrieves the 6-digit handoff OTP for physical exchange.
- **Auth:** Donor owner or Admin only (NGOs receive 403 Forbidden).
- **Response (200 OK):** `{ "otpCode": "123456" }`.
- **Tested in Phase 10:** Yes.

### `POST /api/pickups/[id]/verify-otp`
- **Purpose:** Verifies physical handoff by validating the donor OTP.
- **Auth:** Collecting NGO or Admin.
- **Security:** Timing-safe comparison; max 3 failed attempts locks pickup as `FAILED`.
- **Lifecycle Transition:** Transitions pickup to `PICKED_UP` and donation to `PICKED_UP`.
- **Response (200 OK):** Handoff confirmed.
- **Tested in Phase 10:** Yes.

### `POST /api/pickups/[id]/complete`
- **Purpose:** Finalizes fulfillment and computes UNEP/FAO impact metrics.
- **Auth:** Collecting NGO or Admin.
- **Lifecycle Transition:** Transitions pickup to `DELIVERED` and donation to `DELIVERED`.
- **Impact Metrics:** Computes `meals_served` and `co2_offset_kg` into `public.impact_metrics`.
- **Response (200 OK):** Delivery completed and impact recorded.
- **Tested in Phase 10:** Yes.

---

## 9. Analytics

### `GET /api/analytics/overview`
- **Purpose:** Returns platform-wide aggregate metrics (DB-side SUM/COUNT).
- **Auth:** Any authenticated user (excluding `DEVICE`).
- **Response (200 OK):** Totals for donations, impact, users, and claims.
- **Tested in Phase 10:** Yes.

### `GET /api/analytics/donor`
- **Purpose:** Scoped impact and donation metrics for the authenticated donor.
- **Auth:** `DONOR` role.
- **Response (200 OK):** Donor metrics and top 5 categories.
- **Tested in Phase 10:** Yes.

### `GET /api/analytics/ngo`
- **Purpose:** Scoped pickup fulfillment and impact metrics for the authenticated NGO.
- **Auth:** `NGO` role.
- **Response (200 OK):** NGO claims, pickups, and delivered impact.
- **Tested in Phase 10:** Yes.

### `GET /api/analytics/admin`
- **Purpose:** System-wide breakdown of donation statuses and last 7-day activity.
- **Auth:** `ADMIN` or `SUPER_ADMIN`.
- **Response (200 OK):** System overview, status breakdown, and recent activity timeline.
- **Tested in Phase 10:** Yes.

---

## 10. Notifications

### `GET /api/notifications`
- **Purpose:** Lists in-app notifications for the authenticated user.
- **Query Params:** `limit` (int, default 20), `offset` (int, default 0), `unread_only` (bool, default false).
- **Auth:** Any authenticated user.
- **Response (200 OK):** `{ "notifications": [...], "total": 12, "unread_count": 3 }`.
- **Tested in Phase 10:** Yes.

### `PATCH /api/notifications/[id]/read`
- **Purpose:** Marks a single notification as read with strict IDOR verification.
- **Auth:** Authenticated recipient owner (404 on cross-user attempt).
- **Response (200 OK):** Updated notification record.
- **Tested in Phase 10:** Yes.

---

## 11. Administration

### `GET /api/admin/users`
- **Purpose:** Lists users with role, status, and text search filtering.
- **Auth:** `ADMIN` or `SUPER_ADMIN`.
- **Response (200 OK):** Paginated users list.
- **Tested in Phase 10:** Yes.

### `PATCH /api/admin/users/[id]`
- **Purpose:** Updates user status (`ACTIVE`, `PENDING`, `SUSPENDED`) or role.
- **Auth:** `ADMIN` or `SUPER_ADMIN`.
- **Guards:** Prevents self-suspension, forbids API-level `SUPER_ADMIN` escalation, protects last active `SUPER_ADMIN`.
- **Response (200 OK):** Updated user profile.
- **Tested in Phase 10:** Yes.

### `GET /api/admin/logs`
- **Purpose:** Paginated audit log retrieval with sensitive JSONB fields sanitized.
- **Auth:** `ADMIN` or `SUPER_ADMIN`.
- **Sanitization:** Strips `otp_code_hash`, `password`, `token`, `secret` from `old_values`/`new_values`.
- **Response (200 OK):** Sanitized audit logs.
- **Tested in Phase 10:** Yes.

### `GET /api/admin/config`
- **Purpose:** Reads current runtime configuration factors from `public.system_config`.
- **Auth:** `ADMIN` or `SUPER_ADMIN`.
- **Response (200 OK):** System configuration rows.
- **Tested in Phase 10:** Yes.

### `PATCH /api/admin/config`
- **Purpose:** Updates an allowlisted configuration key (`kg_per_meal_factor`, `co2_factor_per_kg`).
- **Auth:** `SUPER_ADMIN` only.
- **Response (200 OK):** Updated configuration row.
- **Tested in Phase 10:** Yes.
