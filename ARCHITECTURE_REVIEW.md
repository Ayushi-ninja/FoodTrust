# 🔬 Architecture Validation & Reconciliation Review
## AI + IoT Smart Food Waste Monitoring & Redistribution System (**FoodTrust**)

**Document:** `ARCHITECTURE_REVIEW.md`  
**Author:** Lead Backend Engineer  
**Date:** September 2026  
**Status:** Approved Architectural Reconciliation  
**Primary References:** `ARCHITECTURE.md` (v1.0.0), `DEVELOPMENT_PLAN.md` (v1.0.0)

---

## 1. Executive Summary & Purpose

This document performs an exhaustive, point-by-point reconciliation of the **FoodTrust** project architecture. It validates the compatibility between:
1. The **existing static multi-page frontend** ([`FoodTrust/`](file:///C:/Users/DELL/final_year_project/FoodTrust)).
2. The **physical dual-unit hardware design** (Food Handling Unit vs. Electronics Unit).
3. The **target backend stack** (Next.js App Router, TypeScript, Supabase PostgreSQL with PostGIS, Auth, Realtime, Storage, Zod).

Every discrepancy, ambiguity, security risk, and missing relationship is evaluated and categorized as **REQUIRED**, **RECOMMENDED**, or **OPTIONAL**.

---

## 2. 20-Point Architectural Reconciliation

### Point 1: Existing Repository Structure
- **Current State:** The repository contains 10 static HTML files (`index.html`, `donor-dashboard.html`, `nearby-donations.html`, `admin-dashboard.html`, etc.), custom stylesheet (`CSS/style.css`), client-side logic (`js/script.js`), brand assets (`assets/logo2.png`), and git history.
- **Evaluation:** No Next.js or Node build configuration exists. Introducing Next.js at the root must not alter or delete any existing file.
- **Finding [Issue 1.1 - REQUIRED]:** Next.js App Router root layout must not conflict with existing HTML views.
  - *Correction:* The static frontend files will reside in `public/` (or be served side-by-side) so that browsing `http://localhost:3000/index.html` or opening files directly continues to work without disruption.

### Point 2: Existing Frontend Files Preservation
- **Evaluation:** Existing HTML views rely on relative paths like `CSS/style.css`, `js/script.js`, and `assets/logo2.png`.
- **Finding [Issue 2.1 - REQUIRED]:** Moving or modifying paths will break visual styling and map rendering.
  - *Correction:* Preserve directory case and structure (`public/CSS/style.css`, `public/js/script.js`, `public/assets/logo2.png`). Next.js will serve these at the root path, ensuring 100% backward compatibility.

### Point 3: Architecture Document Alignment
- **Evaluation:** `ARCHITECTURE.md` outlines a complete modern production architecture.
- **Finding [Issue 3.1 - REQUIRED]:** `ARCHITECTURE.md` previously treated the Smart Bin as a single generic block.
  - *Correction:* Updated in Section 1.1 to reflect the strict physical separation between the **Food Handling Unit** (sanitary chamber) and the **Electronics Unit** (external electronics).

### Point 4: Backend Development Plan Alignment
- **Evaluation:** `DEVELOPMENT_PLAN.md` organizes implementation into 10 phases (Phase 0 to Phase 9).
- **Finding [Issue 4.1 - RECOMMENDED]:** Phase 0 must include a Mock IoT Ingestion Endpoint and API Healthcheck to allow simulated testing before database provisioning.
  - *Correction:* Reflected in `DEVELOPMENT_PLAN.md` Phase 0 tasks.

### Point 5: Database Schema & Relational Integrity
- **Evaluation:** Review of tables, foreign keys, cascades, and constraints.
- **Finding [Issue 5.1 - REQUIRED]:** In `smart_bins` and `food_trays`, tare weight management must account for tray removal.
  - *Correction:* `food_trays` must enforce a composite UNIQUE constraint `(bin_id, tray_number)` and maintain both `tare_weight_kg` and `last_calibrated_at`.
- **Finding [Issue 5.2 - REQUIRED]:** `auth.users` to `public.users` synchronization must be resilient.
  - *Correction:* Do not rely solely on client-side creation. Create a PostgreSQL `AFTER INSERT ON auth.users` trigger (`handle_new_user()`) that atomically instantiates `public.users`.
- **Finding [Issue 5.3 - REQUIRED]:** `donation_claims` can suffer from race conditions if two NGOs claim simultaneously.
  - *Correction:* Add a partial unique index on `donation_claims(donation_id)` where `status = 'APPROVED'` to ensure at most ONE active claim per donation at the database engine level.

### Point 6: API Endpoint Structure
- **Evaluation:** Review of RESTful paths and HTTP verbs.
- **Finding [Issue 6.1 - RECOMMENDED]:** Missing explicit Healthcheck route.
  - *Correction:* Add `GET /api/health` returning system uptime, database latency, and timestamp.
- **Finding [Issue 6.2 - RECOMMENDED]:** Missing explicit Tray Tare endpoint.
  - *Correction:* Add `POST /api/iot/bins/[id]/tare` to trigger remote tare calibration of an empty tray.

### Point 7: Authentication Design
- **Evaluation:** Supabase Auth issues JWTs with `sub` pointing to `auth.users.id`.
- **Finding [Issue 7.1 - REQUIRED]:** Next.js App Router Route Handlers must verify JWT tokens in the `Authorization: Bearer <token>` header or `sb-access-token` cookie using `@supabase/ssr` / `@supabase/supabase-js`.
  - *Correction:* Provide centralized `getSessionUser(req)` helper in `lib/auth/session.ts`.

### Point 8: Row Level Security (RLS) Design
- **Evaluation:** All tables must enable RLS.
- **Finding [Issue 8.1 - REQUIRED]:** Recursive query trap in RLS when querying `public.users.role`.
  - *Correction:* Create a PostgreSQL `SECURITY DEFINER` function `get_current_user_role()` that retrieves the role of `auth.uid()` without triggering recursive table policy checks.

### Point 9: ESP32 / Device Authentication
- **Evaluation:** Microcontrollers cannot execute OAuth2 token refresh workflows.
- **Finding [Issue 9.1 - REQUIRED]:** Hardware authentication must use a secure header mechanism.
  - *Correction:* ESP32 transmits `x-bin-id` and `x-device-token`. The server computes `SHA-256(x-device-token + IOT_DEVICE_SHARED_SALT)` and verifies against `smart_bins.api_key_hash`.

### Point 10: IoT Telemetry Design & Physical Unit Separation
- **Evaluation:** Food Handling Unit houses load cells (trays) and environment sensors; Electronics Unit houses ESP32, HX711, power.
- **Finding [Issue 10.1 - REQUIRED]:** The telemetry ingest endpoint must accept a batch payload containing chamber telemetry plus individual tray readings in a single HTTP request.
  - *Correction:* Formalized in Section 4 below (Special Requirement D).

### Point 11: Freshness Model Terminology (Special Requirement A)
- **Evaluation:** `ARCHITECTURE.md` Section 7 defines an exponential thermal abuse and gas decay equation.
- **Finding [Issue 11.1 - REQUIRED]:** The model is an empirical decision-support heuristic, not certified microbiology.
  - *Correction:*
    - Rename output fields from absolute claims (`safe_to_eat`) to decision-support terminology: `freshness_score` (0–100), `freshness_status` (`FRESH`, `MODERATE`, `CRITICAL`, `EXPIRED`), and `risk_level` (`LOW`, `MODERATE`, `HIGH`, `CRITICAL`).
    - Every API response containing freshness calculations must include an explanatory notice: `"Decision-support indicator based on ambient telemetry; not a certified substitute for food safety testing."`

### Point 12: Donation State Machine
- **Evaluation:** Donation transitions from generation to delivery.
- **Finding [Issue 12.1 - REQUIRED]:** Missing reservation timeout rollback.
  - *Correction:* If a donation transitions to `RESERVED` but the NGO fails to confirm or dispatch pickup within `CLAIM_TIMEOUT_MINUTES` (default: 30 minutes), an automated check or cron worker rolls the status back to `AVAILABLE`.

### Point 13: NGO Matching Design (PostGIS)
- **Evaluation:** Proximity matching uses spatial distance calculations.
- **Finding [Issue 13.1 - REQUIRED]:** Latitude/longitude columns must be synchronized with a PostGIS `GEOGRAPHY(Point, 4326)` column.
  - *Correction:* Define `location` as a generated stored column or populate it via a database trigger:
    ```sql
    location GEOGRAPHY(Point, 4326) GENERATED ALWAYS AS (
      ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)
    ) STORED
    ```
  - Create a spatial index: `CREATE INDEX idx_ngo_location ON ngo_profiles USING GIST(location);`

### Point 14: Pickup / OTP Workflow
- **Evaluation:** Handoff verification between donor and NGO volunteer.
- **Finding [Issue 14.1 - REQUIRED]:** OTP brute-force vulnerability.
  - *Correction:* OTP is 6 digits, cryptographically random, hashed before storage (`otp_code_hash`). The system enforces a hard limit of 3 failed attempts, after which the OTP is invalidated and must be regenerated by the donor.

### Point 15: Analytics Formulas (Special Requirement B)
- **Evaluation:** `meals_served = ROUND(weight_kg / 0.4)` and `co2_offset_kg = weight_kg * 2.5`.
- **Finding [Issue 15.1 - REQUIRED]:** Presenting fixed formulas as universal facts can be misleading.
  - *Correction:*
    - Maintain formulas as configurable system parameters (`DEFAULT_KG_PER_MEAL = 0.4`, `DEFAULT_CO2_OFFSET_PER_KG = 2.5`).
    - Expose fields as `estimated_meals_served` and `estimated_co2_offset_kg`.
    - Provide metadata indicating: `{"is_estimate": true, "methodology": "Standard UNEP/FAO food waste conversion factor"}`.

### Point 16: Supabase Realtime Usage
- **Evaluation:** Live WebSocket dispatch for donations and alerts.
- **Finding [Issue 16.1 - RECOMMENDED]:** Public WebSocket channels can leak private donor information.
  - *Correction:* Use Supabase Private Broadcast Channels or filter events by recipient user ID (`notifications:user_id=eq.{userId}`) to ensure NGOs only receive notifications intended for them.

### Point 17: Supabase Storage Usage
- **Evaluation:** Storing proof of delivery photos.
- **Finding [Issue 17.1 - RECOMMENDED]:** Unrestricted bucket uploads could lead to storage abuse.
  - *Correction:* Configure bucket `proof-photos` with:
    - Maximum file size: 5 MB.
    - Allowed MIME types: `image/jpeg`, `image/png`, `image/webp`.
    - RLS policy: Only authenticated NGO volunteers can upload; public/authenticated users can view proof associated with their donation.

### Point 18: PostGIS Extensions & Availability
- **Evaluation:** PostGIS must be explicitly enabled on Supabase.
- **Finding [Issue 18.1 - REQUIRED]:** Migration script must run `CREATE EXTENSION IF NOT EXISTS postgis;` and `CREATE EXTENSION IF NOT EXISTS "uuid-ossp";` before any spatial table definition.

### Point 19: Environment Variables
- **Evaluation:** Centralizing configuration.
- **Finding [Issue 19.1 - REQUIRED]:** Ensure clear separation between public client variables (`NEXT_PUBLIC_*`) and secret server-only variables (`SUPABASE_SERVICE_ROLE_KEY`, `IOT_DEVICE_SHARED_SALT`).

### Point 20: Security & IDOR Protection
- **Evaluation:** Insecure Direct Object References (IDOR).
- **Finding [Issue 20.1 - REQUIRED]:** Any endpoint accepting `[id]` (e.g. `/api/donors/[id]`, `/api/pickups/[id]`) must verify that the requesting user's `user_id` matches the resource owner, unless the caller has the `ADMIN` or `SUPER_ADMIN` role.

---

## 3. Special Review Requirements Deep-Dive

### A. Freshness Model (Decision-Support Specification)
The decay formula in `ARCHITECTURE.md` Section 7:
$$S = S_0 \times e^{-k(T) \cdot \Delta t} \times \left(1 - \frac{G - G_0}{G_{\max}}\right)$$

**Mandatory Terminology Standard:**
- **Score Key:** `freshness_score` (Integer, 0 to 100)
- **Status Key:** `freshness_status` (Enum: `FRESH`, `MODERATE`, `CRITICAL`, `EXPIRED`)
- **Risk Level Key:** `risk_level` (Enum: `LOW`, `MODERATE`, `HIGH`, `CRITICAL`)
- **Estimated Remaining Life:** `estimated_shelf_life_hours` (Numeric, 1 decimal place)
- **Compliance Disclaimer:** Every API payload returning this model MUST include:
  ```json
  "disclaimer": "Decision-support indicator based on ambient telemetry; not a certified substitute for food safety testing."
  ```

### B. Impact Metrics (Configurable Modeling)
The impact formulas are preserved and wrapped with clear parametric metadata:
- $\text{Estimated Meals} = \text{ROUND}\left(\frac{\text{weight\_kg}}{\text{CONFIG.KG\_PER\_MEAL}}\right)$ (Default: $0.4\text{ kg/meal}$)
- $\text{Estimated CO}_2\text{e Offset} = \text{weight\_kg} \times \text{CONFIG.CO2\_PER\_KG}$ (Default: $2.5\text{ kg CO}_2\text{e/kg}$)
- **API Representation:**
  ```json
  "impact": {
    "weight_kg": 25.0,
    "estimated_meals_served": 63,
    "estimated_co2_offset_kg": 62.5,
    "methodology": {
      "kg_per_meal": 0.4,
      "co2_factor": 2.5,
      "is_estimate": true
    }
  }
  ```

### C. Physical Hardware Architecture Support
The backend directly mirrors the physical separation of the smart bin:

```
┌────────────────────────────────────────────────────────────────────────┐
│ 1. FOOD HANDLING UNIT (Inside Food Chamber - Washable & Food-Safe)     │
│    • Removable Food Trays (Trays 1..N)                                 │
│    • Tray Weighing Platforms (Load cells underneath)                   │
│    • Chamber Temperature & Humidity Sensor (DHT22)                     │
│    • Chamber VOC / Spoilage Gas Sensor (MQ-135)                        │
├────────────────────────────────────────────────────────────────────────┤
│    ═══════════ MOISTURE-SEALED ELECTRICAL GROMMETS ══════════════════   │
├────────────────────────────────────────────────────────────────────────┤
│ 2. ELECTRONICS UNIT (External / Base Compartment - Electrically Safe)  │
│    • HX711 24-bit ADC Amplifier Modules                                │
│    • ESP32 Microcontroller (Wi-Fi HTTPS Client)                        │
│    • Regulated Power Supply & Surge Protection                         │
│    • Calibration / Status Indicators (LEDs / Buzzer)                   │
└────────────────────────────────────────────────────────────────────────┘
```

The database structures:
- `smart_bins` records the physical bin and its Electronics Unit metadata (MAC address, firmware version, API key hash, heartbeat).
- `food_trays` records each individual removable tray platform inside the Food Handling Unit with tare weight calibrations.
- `sensor_telemetry` stores time-series environmental measurements (chamber ambient) and individual tray load measurements.

### D. IoT Testing: Exact Telemetry JSON Contract (ESP32 Simulation)
To allow thorough testing of the backend without physical hardware, the exact contract for `POST /api/iot/telemetry` is defined below:

#### HTTP Request Headers:
```http
POST /api/iot/telemetry HTTP/1.1
Host: localhost:3000
Content-Type: application/json
x-bin-id: BIN-DELHI-001
x-device-token: dt_live_a89f4c3b2e1d0987654321fedcba
```

#### JSON Request Body:
```json
{
  "binCode": "BIN-DELHI-001",
  "timestamp": "2026-09-30T17:45:00.000Z",
  "ambient": {
    "temperatureC": 22.4,
    "humidityPct": 55.8,
    "vocGasPpm": 118.2
  },
  "system": {
    "lidOpen": false,
    "batteryPct": 94,
    "firmwareVersion": "1.0.4"
  },
  "trays": [
    {
      "trayNumber": 1,
      "category": "COOKED_MEALS",
      "rawWeightKg": 14.80,
      "tareWeightKg": 2.50,
      "netWeightKg": 12.30
    },
    {
      "trayNumber": 2,
      "category": "VEGETABLES",
      "rawWeightKg": 7.10,
      "tareWeightKg": 2.50,
      "netWeightKg": 4.60
    }
  ]
}
```

#### Successful JSON Response (HTTP 200 OK):
```json
{
  "success": true,
  "message": "Telemetry ingested and evaluated successfully",
  "data": {
    "binCode": "BIN-DELHI-001",
    "recordedAt": "2026-09-30T17:45:00.000Z",
    "evaluations": [
      {
        "trayNumber": 1,
        "netWeightKg": 12.30,
        "freshnessScore": 91,
        "freshnessStatus": "FRESH",
        "riskLevel": "LOW",
        "estimatedShelfLifeHours": 6.5,
        "autoDonationCreated": false
      },
      {
        "trayNumber": 2,
        "netWeightKg": 4.60,
        "freshnessScore": 84,
        "freshnessStatus": "FRESH",
        "riskLevel": "LOW",
        "estimatedShelfLifeHours": 18.0,
        "autoDonationCreated": false
      }
    ]
  },
  "timestamp": "2026-09-30T17:45:00.120Z"
}
```

---

## 4. Summary of Identified Issues & Action Matrix

| ID | Category | Description | Severity | Action |
| :--- | :--- | :--- | :--- | :--- |
| **1.1** | Coexistence | Next.js root layout must not break static frontend | **REQUIRED** | Preserve HTML/CSS/JS in `public/` and verify static routing |
| **5.1** | Database | Multi-tray tare calibration when removable trays are cleaned | **REQUIRED** | Add `(bin_id, tray_number)` unique index and `tare_weight_kg` tracking |
| **5.2** | Database | Split-brain risk between `auth.users` and `public.users` | **REQUIRED** | Implement PostgreSQL `handle_new_user()` trigger |
| **5.3** | Database | Concurrent double-claiming race condition by NGOs | **REQUIRED** | Add partial unique index on active claims + `SELECT FOR UPDATE` |
| **8.1** | Security | Recursive RLS query when fetching user role | **REQUIRED** | Create `SECURITY DEFINER` function `get_current_user_role()` |
| **9.1** | Security | ESP32 hardware authentication | **REQUIRED** | Salted SHA-256 hash lookup in `smart_bins.api_key_hash` |
| **11.1**| Domain | Freshness model must be decision-support, not certified safety | **REQUIRED** | Use `freshness_score`, `freshness_status`, `risk_level` + disclaimers |
| **13.1**| Database | PostGIS spatial synchronization for NGO distance queries | **REQUIRED** | Enable PostGIS extension and generate stored `GEOGRAPHY(Point, 4326)` |
| **14.1**| Security | Pickup OTP brute-force prevention | **REQUIRED** | 6-digit hashed OTP with strict 3-attempt limit |
| **15.1**| Domain | Impact metrics must be configurable estimates | **REQUIRED** | Expose as `estimated_meals_served` & `estimated_co2_offset_kg` |
| **20.1**| Security | Insecure Direct Object Reference (IDOR) prevention | **REQUIRED** | Validate ownership in route handlers before returning resources |
| **4.1** | Testing | Testability without physical hardware | **RECOMMENDED** | Implement simulated ESP32 payload in Postman collection |
| **6.1** | API | System health monitoring | **RECOMMENDED** | Implement `GET /api/health` |
| **16.1**| Security | Public Supabase Realtime channel privacy | **RECOMMENDED** | Use user-scoped private broadcast channels |
| **17.1**| Security | Unrestricted photo upload storage risks | **RECOMMENDED** | Enforce 5MB limit and JPEG/PNG/WebP MIME filter on `proof-photos` |

---

## 5. Architectural Approval Status

With these reconciliations formalized, the architecture is **coherent, secure, testable, and ready for phased execution**.
