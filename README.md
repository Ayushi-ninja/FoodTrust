# 🍱 FoodTrust — AI + IoT Smart Food Waste Monitoring & Redistribution System

FoodTrust is an enterprise-grade platform connecting commercial food donors (restaurants, banquets, hotels) with verified NGOs for rapid surplus redistribution. The system pairs physical Smart Bin IoT units with automated decision-support freshness scoring, geospatial NGO matching, verifiable OTP pickup handoff, and FAO/UNEP carbon and meal impact tracking.

---

## 🏛️ System Architecture & Technology Stack

| Layer | Technologies & Frameworks |
| :--- | :--- |
| **Backend API** | Next.js 14 App Router, TypeScript (Strict), Node.js Runtime |
| **Database & GIS** | Supabase PostgreSQL, PostGIS spatial extensions, Row-Level Security (RLS) |
| **Authentication & RBAC** | Supabase Auth, Secure Cookie Sessions, Database-Driven RBAC (`lib/auth/rbac.ts`) |
| **Validation** | Zod Schema Validation on all incoming requests |
| **IoT Telemetry** | Salted SHA-256 API Key Verification, Sliding-Window Rate Limiting (60 req/min) |
| **Freshness Engine** | Arrhenius Thermal Abuse Decay + Gas VOC Penalties (`lib/services/freshness.service.ts`) |
| **API Testing & Tooling** | Postman v2.1 Collection, TypeScript Automated Test Suites |
| **Static Prototype UI** | Vanilla HTML5/CSS3/JavaScript, Leaflet.js, Chart.js (`public/`) |

---

## 🚀 Quickstart & Developer Setup

### 1. Prerequisites
- **Node.js:** v18.17.0+ or v20.x
- **npm:** v9.x or higher
- **Supabase Account / Project:** Remote or local instance

### 2. Environment Configuration
Create `.env.local` in the project root based on `.env.example`:

```bash
NODE_ENV=development
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_SUPABASE_URL=https://<your-supabase-project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-supabase-anon-key>
SUPABASE_SERVICE_ROLE_KEY=<your-supabase-service-role-key>
IOT_DEVICE_SHARED_SALT=prototype_test_salt_secure_2026
IOT_INGESTION_RATE_LIMIT=60
DEFAULT_SEARCH_RADIUS_KM=15
```

### 3. Install Dependencies
```bash
npm install
```

### 4. Database Migrations
Database migration scripts are located in `supabase/migrations/`:
- `20261001000001_extensions_and_enums.sql`
- `20261001000002_core_tables.sql`
- `20261001000003_indexes_and_constraints.sql`
- `20261001000004_triggers_and_functions.sql`
- `20261001000005_rls_policies.sql`
- `20261001000009_system_config.sql`

Execute these SQL scripts in numerical order using the **Supabase Dashboard SQL Editor** or via the Supabase CLI.

### 5. Run Local Development Server
```bash
npm run dev
```
The server will start at `http://localhost:3000`.

---

## 🧪 Verification & Automated Testing

The repository contains automated test suites exercising all backend subsystems:

```bash
# 1. Typecheck & Build Gates
npm run typecheck
npm run build

# 2. Phase 12 IoT & Hardware Suite (30 Tests)
npx tsx scratch/test-phase12-iot.ts

# 3. Phase 11 Frontend Integration Suite (36 Tests)
npx tsx scratch/test-phase11-frontend.ts

# 4. Phase 10 End-to-End Lifecycle Suite (46 Tests)
npx tsx scratch/test-phase10-e2e.ts

# 5. Phase 9 Analytics & Admin Oversight Suite (62 Tests)
npx tsx scratch/test-phase9-analytics.ts

# 6. Phase 8 Pickups & OTP Fulfillment Suite (34 Tests)
npx tsx scratch/test-phase8-pickups.ts

# 7. Phase 7 NGO Claims & OCC Race Suite (22 Tests)
npx tsx scratch/test-phase7-claims.ts

# 8. Phase 6 Donation Lifecycle Suite (37 Tests)
npx tsx scratch/test-phase6-donations.ts

# 9. Phase 6 Security & IDOR Audit Suite (33 Tests)
npx tsx scratch/test-phase6-security-audit.ts
```

**Total Test Coverage:** **300 / 300 passing automated assertions across all test suites.**

---

## 📡 ESP32 Hardware Integration & IoT Simulator

### 1. ESP32 Microcontroller Firmware (`firmware/esp32-foodtrust/`)
Production-ready Arduino / PlatformIO C++ firmware configured for the ESP32-WROOM-32 microcontroller:
- **Sensors:** DHT22 (chamber temp/humidity), MQ-135 (VOC spoilage gas), dual HX711 (tray load cells), and magnetic reed switch (lid status).
- **Security:** Salted SHA-256 pre-shared tokens (`x-bin-id`, `x-device-token`), redacted serial logs, TLS 1.3 / HTTPS.
- **Physical Safety:** Hermetic separation of external Electronics Unit from sanitary food storage.

### 2. Local CLI IoT Simulator
Simulate physical smart bin telemetries across varying environmental and food conditions:
```bash
# Optimal cold-chain refrigeration (normal mode)
npm run iot:simulate -- --mode=normal --once

# Thermal breach simulation (accelerated spoilage)
npm run iot:simulate -- --mode=warm --interval=10

# Dry-run validation (inspect JSON payload without network requests)
npm run iot:simulate -- --dry-run --once
```

---

## 📬 Postman Collection & API Testing

An exportable Postman collection and environment template are included:

- **Collection:** `postman/FoodTrust_API_v1.postman_collection.json` (covers all 41 API endpoints)
- **Environment:** `postman/FoodTrust_Local.postman_environment.json`

### Importing into Postman
1. Open Postman, click **Import**, and select both JSON files from `postman/`.
2. Activate the **FoodTrust Local Environment**.
3. Run requests starting from `1. Health & Authentication` to obtain and propagate session IDs.

---

## 📚 Technical Documentation Directory

- [`docs/ESP32_HARDWARE_INTEGRATION.md`](docs/ESP32_HARDWARE_INTEGRATION.md) — ESP32 pinouts, wiring diagrams, HX711 calibration, and device provisioning runbook.
- [`docs/DEMO_RUNBOOK.md`](docs/DEMO_RUNBOOK.md) — Step-by-step evaluator walkthrough from hardware telemetry to delivery completion and impact analytics.
- [`docs/DEPLOYMENT_CHECKLIST.md`](docs/DEPLOYMENT_CHECKLIST.md) — Production hardening checklist for environment secrets, TLS, database constraints, and operational safety.
- [`docs/FRONTEND_INTEGRATION.md`](docs/FRONTEND_INTEGRATION.md) — Frontend API client, screen connections, and session handling.
- [`docs/API_REFERENCE.md`](docs/API_REFERENCE.md) — Complete endpoint reference for all 41 API routes.
- [`docs/END_TO_END_TESTING.md`](docs/END_TO_END_TESTING.md) — Comprehensive guide for testing and lifecycle execution.
- [`docs/DONATION_LIFECYCLE.md`](docs/DONATION_LIFECYCLE.md) — State machine transition matrix and OCC rules.
- [`docs/NGO_CLAIM_WORKFLOW.md`](docs/NGO_CLAIM_WORKFLOW.md) — Verified claim reservation protocol.
- [`docs/PICKUP_FULFILLMENT_WORKFLOW.md`](docs/PICKUP_FULFILLMENT_WORKFLOW.md) — OTP security handoff and proof of delivery.
- [`docs/ANALYTICS_NOTIFICATIONS_ADMIN.md`](docs/ANALYTICS_NOTIFICATIONS_ADMIN.md) — Aggregation formulas and audit sanitization.
- [`docs/IOT_API_CONTRACT.md`](docs/IOT_API_CONTRACT.md) — Hardware sensor payload specifications and rate limits.
- [`docs/FRESHNESS_MODEL.md`](docs/FRESHNESS_MODEL.md) — Spoilage kinetic formulas and mathematical modeling.
