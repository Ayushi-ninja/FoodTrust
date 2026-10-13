# 🎬 FoodTrust — Live Demonstration & Evaluator Runbook

**Document Version:** 1.0.0  
**Phase:** Phase 12 — ESP32 Hardware Integration & Deployment Readiness  
**Target Audience:** Project Evaluators, Demonstrators, and QA Engineers  
**Scope:** Complete End-to-End Walkthrough (Hardware Ingestion -> Freshness Scoring -> Donation Lifecycle -> NGO Matching -> OTP Verification -> Delivery Impact -> Analytics)

---

## 1. Prerequisites & Environment Setup

1. **Start the FoodTrust Next.js Server:**
   ```bash
   npm run dev
   # Server listens on http://localhost:3000
   ```
2. **Verify Database Connectivity:**
   Ensure remote Supabase PostgreSQL/PostGIS connection is active in `.env.local`.
3. **Seed Accounts Ready for Testing:**
   - **Donor User:** `donor@foodtrust.dev` (Password: standard dev password / cookie)
   - **Verified NGO:** `ngo@foodtrust.dev`
   - **System Admin:** `admin@foodtrust.dev`
   - **Smart Bin ID:** `BIN-DELHI-001` (Secret Token: `dt_sec_9f8e7d6c5b4a3120`)

---

## 2. Step-by-Step Demonstration Sequence

### Stage 1: Smart Bin Hardware Ingestion & Heartbeat

Simulate or flash the physical ESP32 to send chamber conditions to the backend:

```bash
# Run the local IoT simulator in warm or normal refrigeration mode:
npm run iot:simulate -- --mode=normal --once
```

**What Evaluators See:**
- Device Heartbeat pings `POST /api/iot/heartbeat` with `x-bin-id: BIN-DELHI-001`. Status transitions from `OFFLINE` to `ONLINE`.
- Telemetry batch `POST /api/iot/telemetry` reports:
  - Temperature: `4.2°C`
  - Humidity: `62.0%`
  - Airborne VOC Spoilage Gas: `42 ppm`
  - Tray 1 Load Cell: `10.5 kg` (`COOKED_MEALS`)
  - Tray 2 Load Cell: `6.2 kg` (`VEGETABLES`)
- Response includes real-time freshness evaluations and statutory decision-support disclaimers.

---

### Stage 2: Freshness Assessment Model

Examine the deterministic kinetic decay calculation:

```bash
curl -X POST "http://localhost:3000/api/freshness/evaluate" \
  -H "Content-Type: application/json" \
  -d '{
    "foodCategory": "COOKED_MEALS",
    "preparationTimestamp": "2026-10-12T10:00:00.000Z",
    "temperatureC": 4.5,
    "humidityPct": 60.0,
    "vocGasPpm": 40.0
  }'
```

**Evaluator Insight:**
- Score computed using the calibrated Arrhenius temperature coefficient and microbial gas penalty factor.
- Returned score: `~92/100` (`FRESH`).
- Legal decision-support disclaimer explicitly attached.

---

### Stage 3: Donor Creates Food Donation

Open the Web Portal at `http://localhost:3000/donor-dashboard.html` or submit via API:

```bash
# Logged in as donor@foodtrust.dev:
curl -X POST "http://localhost:3000/api/donations" \
  -H "Content-Type: application/json" \
  -H "Cookie: <DONOR_SESSION_COOKIE>" \
  -d '{
    "title": "Fresh Cooked Rice & Dal Meals",
    "description": "Surplus lunch batches from Connaught restaurant",
    "foodCategory": "COOKED_MEALS",
    "quantityKg": 25.0,
    "preparationTimestamp": "2026-10-12T11:00:00.000Z",
    "pickupAddress": "Connaught Place, New Delhi",
    "latitude": 28.6315,
    "longitude": 77.2167
  }'
```

**Evaluator Insight:**
- Donation created with lifecycle status `AVAILABLE`.
- Freshness score persisted automatically with the donation record.

---

### Stage 4: Smart NGO Proximity Matching

Query nearby verified recipient NGOs using PostGIS spherical distance:

```bash
curl -X GET "http://localhost:3000/api/matching/ngos?donationId=<DONATION_ID>&radiusKm=15" \
  -H "Cookie: <DONOR_SESSION_COOKIE>"
```

**Evaluator Insight:**
- NGOs ranked by compatibility score combining geographic distance, operational capacity, and historical fulfillment rating.

---

### Stage 5: NGO Claims the Donation

Open `http://localhost:3000/nearby-donations.html` as the verified NGO or send claim request:

```bash
curl -X POST "http://localhost:3000/api/donations/<DONATION_ID>/claim" \
  -H "Cookie: <NGO_SESSION_COOKIE>"
```

**Evaluator Insight:**
- Optimistic Concurrency Control (OCC) and partial unique indexes prevent double-claims.
- Donation status atomically moves from `AVAILABLE` to `CLAIMED`.
- Competing claims receive `HTTP 409 Conflict`.

---

### Stage 6: Pickup Scheduling & Handoff OTP Generation

1. NGO schedules pickup route:
   ```bash
   curl -X POST "http://localhost:3000/api/pickups" \
     -H "Content-Type: application/json" \
     -H "Cookie: <NGO_SESSION_COOKIE>" \
     -d '{
       "donationId": "<DONATION_ID>",
       "scheduledPickupTime": "2026-10-12T16:00:00.000Z"
     }'
   ```
   *Donation transitions to `PICKUP_IN_PROGRESS`.*

2. Donor generates secure 6-digit handoff OTP:
   ```bash
   curl -X POST "http://localhost:3000/api/pickups/<PICKUP_ID>/generate-otp" \
     -H "Cookie: <DONOR_SESSION_COOKIE>"
   ```
   *Returns 6-digit numeric OTP (e.g., `482910`). NGO cannot view this OTP (403 Forbidden).*

---

### Stage 7: Physical Handoff OTP Verification

The NGO arrives at the donor facility, inspects the food, and inputs the OTP:

```bash
curl -X POST "http://localhost:3000/api/pickups/<PICKUP_ID>/verify-otp" \
  -H "Content-Type: application/json" \
  -H "Cookie: <NGO_SESSION_COOKIE>" \
  -d '{ "otpCode": "482910" }'
```

**Evaluator Insight:**
- Validates cryptographic SHA-256 hash.
- Invalid attempts increment failed counter (locked out at 3 attempts).
- On success, pickup moves to `PICKED_UP`, and donation status updates to `PICKED_UP`.

---

### Stage 8: Delivery Completion & Environmental Impact Calculation

NGO delivers the food to the community shelter:

```bash
curl -X POST "http://localhost:3000/api/pickups/<PICKUP_ID>/complete" \
  -H "Cookie: <NGO_SESSION_COOKIE>"
```

**Evaluator Insight:**
- Pickup status updates to `DELIVERED`.
- Donation terminal status set to `DELIVERED`.
- Automated, idempotent FAO/UNEP impact metrics recorded:
  - $\text{Meals Served} = \frac{25\text{ kg}}{0.40\text{ kg/meal}} = 62\text{ meals}$
  - $\text{CO}_2\text{ Offset} = 25\text{ kg} \times 2.50\text{ kg CO}_2\text{/kg} = 62.50\text{ kg CO}_2$

---

### Stage 9: Administrative Oversight & Analytics Inspection

Open `http://localhost:3000/admin-dashboard.html`:
- Inspect system overview metrics: total food diverted, meals served, active donors, active NGOs.
- Review immutable audit log: verify user logins, claim events, and OTP verification records.
- Confirm all sensitive tokens and OTP hashes are redacted from UI and responses.
