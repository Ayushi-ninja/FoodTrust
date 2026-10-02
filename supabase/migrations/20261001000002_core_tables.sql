-- =============================================================================
-- Migration: 20261001000002_core_tables.sql
-- Project:   FoodTrust — AI + IoT Smart Food Waste Monitoring & Redistribution
-- Phase:     Phase 1 — Database Foundation
-- Step:      2 of 5 — Core Application Tables
--
-- PREREQUISITES: 20261001000001_extensions_and_enums.sql must be applied first.
--
-- Creation order follows foreign key dependency graph:
--   users (root, mirrors auth.users)
--   ↓ donor_profiles, ngo_profiles
--   ↓ smart_bins
--   ↓ food_trays
--   ↓ sensor_telemetry
--   ↓ food_donations
--   ↓ donation_claims, freshness_logs
--   ↓ pickups
--   ↓ notifications, impact_metrics
--   ↓ audit_logs (last — references all)
--
-- References:
--   ARCHITECTURE.md       Section 5 (Table Definitions)
--   IMPLEMENTATION_DECISIONS.md Section 2 (Database Decisions)
--   ARCHITECTURE_REVIEW.md      Issues 5.1, 11.1, 13.1, 15.1
-- =============================================================================

-- ---------------------------------------------------------------------------
-- TABLE 1: users
-- Mirrors auth.users. Populated automatically by handle_new_user() trigger
-- (defined in migration 20261001000004). The id is the Supabase Auth UUID.
-- Ref: IMPLEMENTATION_DECISIONS.md Section 2.1
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.users (
  id            UUID          PRIMARY KEY,           -- Matches auth.users.id exactly
  email         VARCHAR(255)  NOT NULL UNIQUE,
  phone         VARCHAR(20),
  full_name     VARCHAR(100)  NOT NULL,
  role          user_role_enum NOT NULL DEFAULT 'DONOR',
  status        user_status_enum NOT NULL DEFAULT 'PENDING',
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.users IS
  'Application user profiles. Populated and kept in sync with auth.users via the handle_new_user() trigger.';
COMMENT ON COLUMN public.users.id IS
  'Must exactly match auth.users.id. Supabase Auth is the source of truth for authentication.';
COMMENT ON COLUMN public.users.role IS
  'DEVICE role is reserved for IoT ESP32 smart bin identities, not human users.';

-- ---------------------------------------------------------------------------
-- TABLE 2: donor_profiles
-- Represents restaurants, hotels, cafeterias, wedding halls, hostels, etc.
-- The location GEOGRAPHY column supports PostGIS proximity queries.
-- Ref: IMPLEMENTATION_DECISIONS.md Section 2.3
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.donor_profiles (
  id                  UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id             UUID          NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
  business_name       VARCHAR(150)  NOT NULL,
  establishment_type  VARCHAR(50),                  -- 'Restaurant', 'Hotel', 'Wedding Hall', etc.
  fssai_license       VARCHAR(50),                  -- Indian food safety license (optional)
  address             TEXT          NOT NULL,
  latitude            DOUBLE PRECISION NOT NULL,
  longitude           DOUBLE PRECISION NOT NULL,
  -- PostGIS stored generated column. Derived from latitude/longitude.
  -- Used by ST_DWithin / ST_Distance for NGO proximity matching.
  location            GEOGRAPHY(Point, 4326) GENERATED ALWAYS AS (
                        ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)
                      ) STORED,
  contact_person      VARCHAR(100),
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.donor_profiles IS
  'Donor organization profiles (restaurants, hotels, cafeterias, wedding halls, hostels, etc.).';
COMMENT ON COLUMN public.donor_profiles.location IS
  'PostGIS GEOGRAPHY(Point, 4326) generated column. Always derived from latitude and longitude. Never set directly.';

-- ---------------------------------------------------------------------------
-- TABLE 3: ngo_profiles
-- Organizations that collect and redistribute donated food.
-- operational_radius_km and daily_capacity_kg drive the NGO matching engine.
-- Ref: ARCHITECTURE.md Section 8 (NGO Matching Engine)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ngo_profiles (
  id                      UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id                 UUID          NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
  organization_name       VARCHAR(150)  NOT NULL,
  registration_number     VARCHAR(100)  NOT NULL, -- Darpan ID / 12A / 80G certificate number
  operational_radius_km   NUMERIC(5,2)  NOT NULL DEFAULT 15.0,
  has_cold_storage        BOOLEAN       NOT NULL DEFAULT FALSE,
  daily_capacity_kg       NUMERIC(8,2)  NOT NULL DEFAULT 100.0,
  latitude                DOUBLE PRECISION NOT NULL,
  longitude               DOUBLE PRECISION NOT NULL,
  -- PostGIS stored generated column for spatial proximity queries.
  -- ST_DWithin(ngo.location, donation.location, radius_m) is the primary matching filter.
  location                GEOGRAPHY(Point, 4326) GENERATED ALWAYS AS (
                            ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)
                          ) STORED,
  verification_status     verification_status_enum NOT NULL DEFAULT 'PENDING',
  address                 TEXT,
  contact_person          VARCHAR(100),
  contact_phone           VARCHAR(20),
  created_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.ngo_profiles IS
  'NGO organization profiles for organizations that collect and redistribute food donations.';
COMMENT ON COLUMN public.ngo_profiles.verification_status IS
  'NGOs must reach VERIFIED status before appearing in NGO matching engine results.';
COMMENT ON COLUMN public.ngo_profiles.operational_radius_km IS
  'Maximum distance (km) within which this NGO can collect donations.';

-- ---------------------------------------------------------------------------
-- TABLE 4: smart_bins
-- Represents the ELECTRONICS UNIT of the physical dual-module smart bin.
-- Contains no food-contact components. Houses the ESP32 and HX711 modules.
-- api_key_hash stores a salted SHA-256 hash — never plaintext.
-- Ref: IMPLEMENTATION_DECISIONS.md Section 5.2, ARCHITECTURE.md Section 9.2
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.smart_bins (
  id                  UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  bin_code            VARCHAR(50)   NOT NULL UNIQUE,  -- Human-readable code e.g. 'BIN-DELHI-001'
  donor_id            UUID          NOT NULL REFERENCES public.donor_profiles(id) ON DELETE RESTRICT,
  -- SHA-256(raw_device_token + IOT_DEVICE_SHARED_SALT). Never store plaintext tokens.
  -- Ref: ARCHITECTURE_REVIEW.md Issue 9.1
  api_key_hash        VARCHAR(255)  NOT NULL,
  status              bin_status_enum NOT NULL DEFAULT 'OFFLINE',
  firmware_version    VARCHAR(20),
  last_heartbeat_at   TIMESTAMPTZ,
  location_note       TEXT,                           -- Optional: physical placement description
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.smart_bins IS
  'Electronics Unit of the smart bin. Records device registration, API authentication hash, and operational status.';
COMMENT ON COLUMN public.smart_bins.api_key_hash IS
  'Salted SHA-256 hash of the ESP32 device token. Computed as SHA256(token + IOT_DEVICE_SHARED_SALT). Plaintext tokens are NEVER stored.';
COMMENT ON COLUMN public.smart_bins.bin_code IS
  'Human-readable unique identifier provisioned to each physical device. Used in x-bin-id header.';

-- ---------------------------------------------------------------------------
-- TABLE 5: food_trays
-- Represents individual removable tray platforms inside the FOOD HANDLING UNIT.
-- Each tray has its own weighing platform and category assignment.
-- Composite UNIQUE (bin_id, tray_number) prevents duplicate tray slots per bin.
-- Ref: ARCHITECTURE_REVIEW.md Issue 5.1
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.food_trays (
  id                  UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  bin_id              UUID          NOT NULL REFERENCES public.smart_bins(id) ON DELETE CASCADE,
  tray_number         INT           NOT NULL CHECK (tray_number >= 1),
  assigned_category   food_category_enum NOT NULL DEFAULT 'COOKED_MEALS',
  current_weight_kg   NUMERIC(6,2)  NOT NULL DEFAULT 0.00,
  tare_weight_kg      NUMERIC(6,2)  NOT NULL DEFAULT 0.00,
  last_calibrated_at  TIMESTAMPTZ,                    -- Timestamp of last tare calibration
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  -- Composite uniqueness: each bin can have at most one tray per slot number
  CONSTRAINT uq_bin_tray UNIQUE (bin_id, tray_number)
);

COMMENT ON TABLE public.food_trays IS
  'Removable food tray platforms inside the Food Handling Unit. Each tray maps to a physical weighing slot.';
COMMENT ON COLUMN public.food_trays.tare_weight_kg IS
  'Weight of the empty tray itself. Net food weight = current_weight_kg - tare_weight_kg.';
COMMENT ON COLUMN public.food_trays.last_calibrated_at IS
  'Timestamp of the most recent tare calibration. Updated when POST /api/iot/bins/{id}/tare is called.';

-- ---------------------------------------------------------------------------
-- TABLE 6: sensor_telemetry
-- High-frequency time-series from ESP32 telemetry batches.
-- BIGSERIAL primary key (not UUID) for write throughput at scale.
-- Records ambient chamber readings (temp, humidity, VOC) and individual tray weights.
-- Ref: ARCHITECTURE.md Section 5, Table 6
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sensor_telemetry (
  id                BIGSERIAL     PRIMARY KEY,
  bin_id            UUID          NOT NULL REFERENCES public.smart_bins(id) ON DELETE CASCADE,
  tray_id           UUID          REFERENCES public.food_trays(id) ON DELETE SET NULL,
  -- Tray-level reading (nullable for chamber-wide ambient records)
  weight_kg         NUMERIC(6,2),
  -- Chamber ambient readings from Food Handling Unit sensors (DHT22 + MQ-135)
  temperature_c     NUMERIC(5,2)  NOT NULL,
  humidity_pct      NUMERIC(5,2)  NOT NULL,
  voc_gas_ppm       NUMERIC(8,2)  NOT NULL,           -- Spoilage metabolites from MQ-135/BME680
  -- Device system state from Electronics Unit
  lid_open          BOOLEAN       NOT NULL DEFAULT FALSE,
  battery_pct       INT           CHECK (battery_pct BETWEEN 0 AND 100),
  firmware_version  VARCHAR(20),
  recorded_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.sensor_telemetry IS
  'High-frequency time-series telemetry from ESP32. Records chamber ambient + per-tray weight readings per batch.';
COMMENT ON COLUMN public.sensor_telemetry.id IS
  'BIGSERIAL (not UUID) for high-throughput time-series write performance.';
COMMENT ON COLUMN public.sensor_telemetry.tray_id IS
  'NULL for chamber-level ambient records. Set for per-tray weight readings from the Food Handling Unit.';
COMMENT ON COLUMN public.sensor_telemetry.voc_gas_ppm IS
  'Volatile Organic Compound gas reading from MQ-135 or BME680. Primary spoilage indicator for freshness model.';

-- ---------------------------------------------------------------------------
-- TABLE 7: food_donations
-- Central donation record. Created manually by donors or automatically by the
-- IoT threshold trigger when tray weight exceeds the minimum donation threshold.
-- bin_id is nullable (supports manual donations without a smart bin).
-- Ref: ARCHITECTURE.md Section 5, Table 7
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.food_donations (
  id                          UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  donor_id                    UUID          NOT NULL REFERENCES public.donor_profiles(id) ON DELETE RESTRICT,
  bin_id                      UUID          REFERENCES public.smart_bins(id) ON DELETE SET NULL, -- NULLABLE: manual donations
  tray_id                     UUID          REFERENCES public.food_trays(id) ON DELETE SET NULL, -- NULLABLE: manual donations
  title                       VARCHAR(150)  NOT NULL,
  description                 TEXT,
  food_category               food_category_enum NOT NULL,
  quantity_kg                 NUMERIC(6,2)  NOT NULL CHECK (quantity_kg > 0),
  preparation_timestamp       TIMESTAMPTZ   NOT NULL,
  -- Freshness evaluation fields (decision-support heuristic, NOT certified safety)
  -- Ref: IMPLEMENTATION_DECISIONS.md Section 3.1, ARCHITECTURE_REVIEW.md Issue 11.1
  freshness_score             INT           NOT NULL DEFAULT 100 CHECK (freshness_score BETWEEN 0 AND 100),
  freshness_status            freshness_status_enum NOT NULL DEFAULT 'FRESH',
  risk_level                  risk_level_enum NOT NULL DEFAULT 'LOW',
  shelf_life_hours_remaining  NUMERIC(5,1)  NOT NULL DEFAULT 0.0,
  -- Donation lifecycle
  status                      donation_status_enum NOT NULL DEFAULT 'AVAILABLE',
  -- Pickup location (may differ from donor HQ address for event/catering donations)
  pickup_address              TEXT          NOT NULL,
  latitude                    DOUBLE PRECISION NOT NULL,
  longitude                   DOUBLE PRECISION NOT NULL,
  -- PostGIS stored generated column for spatial NGO matching
  location                    GEOGRAPHY(Point, 4326) GENERATED ALWAYS AS (
                                ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)
                              ) STORED,
  image_url                   TEXT,                     -- Optional: photo of the food item
  created_at                  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.food_donations IS
  'Core donation record. Created manually by donors or automatically by IoT weight threshold triggers.';
COMMENT ON COLUMN public.food_donations.bin_id IS
  'NULL for manual donations submitted without a smart bin device.';
COMMENT ON COLUMN public.food_donations.freshness_score IS
  'Decision-support freshness indicator (0–100). Calculated using the Arrhenius thermal decay + VOC model. NOT a certified food safety determination.';
COMMENT ON COLUMN public.food_donations.freshness_status IS
  'Decision-support status: FRESH, MODERATE, CRITICAL, or EXPIRED. NOT a certified food safety determination.';

-- ---------------------------------------------------------------------------
-- TABLE 8: donation_claims
-- NGO claim attempts on an available donation.
-- The partial unique index (migration 3) enforces that at most one APPROVED
-- or PENDING claim can exist per donation at any time.
-- Ref: IMPLEMENTATION_DECISIONS.md Section 2.4, ARCHITECTURE_REVIEW.md Issue 5.3
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.donation_claims (
  id              UUID              PRIMARY KEY DEFAULT uuid_generate_v4(),
  donation_id     UUID              NOT NULL REFERENCES public.food_donations(id) ON DELETE CASCADE,
  ngo_id          UUID              NOT NULL REFERENCES public.ngo_profiles(id) ON DELETE RESTRICT,
  status          claim_status_enum NOT NULL DEFAULT 'PENDING',
  claimed_at      TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
  responded_at    TIMESTAMPTZ,                  -- When APPROVED/REJECTED/EXPIRED status was set
  notes           TEXT                          -- Optional rejection reason or admin note
);

COMMENT ON TABLE public.donation_claims IS
  'NGO claim attempts. The partial unique index idx_single_active_claim (migration 3) prevents concurrent double-claiming.';

-- ---------------------------------------------------------------------------
-- TABLE 9: pickups
-- One pickup record per donation (enforced by UNIQUE on donation_id).
-- OTP workflow: donor receives otp_code_hash, NGO volunteer verifies on arrival.
-- otp_code_hash stores hashed 6-digit OTP — never plaintext.
-- Ref: ARCHITECTURE_REVIEW.md Issue 14.1, IMPLEMENTATION_DECISIONS.md Section 5.3
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pickups (
  id                  UUID              PRIMARY KEY DEFAULT uuid_generate_v4(),
  donation_id         UUID              NOT NULL UNIQUE REFERENCES public.food_donations(id) ON DELETE RESTRICT,
  ngo_id              UUID              NOT NULL REFERENCES public.ngo_profiles(id) ON DELETE RESTRICT,
  assigned_volunteer  VARCHAR(100),
  volunteer_phone     VARCHAR(20),
  -- 6-digit OTP hashed with SHA-256 before storage. Plaintext OTP is NEVER stored.
  -- 3 failed verification attempts triggers automatic invalidation.
  -- Ref: ARCHITECTURE_REVIEW.md Issue 14.1
  otp_code_hash       VARCHAR(255)      NOT NULL,
  otp_attempt_count   INT               NOT NULL DEFAULT 0 CHECK (otp_attempt_count <= 3),
  otp_expires_at      TIMESTAMPTZ,                  -- OTP validity window
  status              pickup_status_enum NOT NULL DEFAULT 'SCHEDULED',
  -- Delivery proof photo (Supabase Storage URL)
  -- Ref: ARCHITECTURE_REVIEW.md Issue 17.1
  proof_image_url     TEXT,
  scheduled_at        TIMESTAMPTZ,
  picked_up_at        TIMESTAMPTZ,
  delivered_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ       NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.pickups IS
  'One pickup record per donation (UNIQUE on donation_id). Manages OTP handoff verification between donor and NGO volunteer.';
COMMENT ON COLUMN public.pickups.otp_code_hash IS
  'SHA-256 hash of the 6-digit handoff OTP. Plain-text OTP is NEVER stored. Maximum 3 failed attempts before invalidation.';
COMMENT ON COLUMN public.pickups.proof_image_url IS
  'Supabase Storage URL for delivery confirmation photo. Bucket: proof-photos. Max 5MB, JPEG/PNG/WebP only.';

-- ---------------------------------------------------------------------------
-- TABLE 10: freshness_logs
-- Time-series freshness evaluation snapshots per donation.
-- BIGSERIAL primary key for high write throughput (may be written per telemetry).
-- These are decision-support evaluations, NOT certified safety records.
-- Ref: IMPLEMENTATION_DECISIONS.md Section 3.1
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.freshness_logs (
  id                    BIGSERIAL     PRIMARY KEY,
  donation_id           UUID          NOT NULL REFERENCES public.food_donations(id) ON DELETE CASCADE,
  evaluated_score       INT           NOT NULL CHECK (evaluated_score BETWEEN 0 AND 100),
  freshness_status      freshness_status_enum NOT NULL,
  risk_level            risk_level_enum NOT NULL,
  shelf_life_hours      NUMERIC(5,1)  NOT NULL,
  -- Raw sensor inputs used in this evaluation snapshot
  gas_reading_ppm       NUMERIC(8,2),
  temperature_c         NUMERIC(5,2),
  humidity_pct          NUMERIC(5,2),
  evaluated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.freshness_logs IS
  'Time-series freshness evaluation snapshots. These are decision-support records, NOT certified food safety determinations.';
COMMENT ON COLUMN public.freshness_logs.id IS
  'BIGSERIAL (not UUID) for high-throughput write performance on freshness recalculation events.';

-- ---------------------------------------------------------------------------
-- TABLE 11: notifications
-- In-app notification queue for all user roles.
-- Supabase Realtime broadcasts on this table filtered by recipient_user_id.
-- Ref: ARCHITECTURE_REVIEW.md Issue 16.1 (user-scoped private channels)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notifications (
  id                UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  recipient_user_id UUID          NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  -- Type as VARCHAR for forward compatibility. Common values:
  -- DONATION_AVAILABLE, DONATION_CLAIMED, PICKUP_ASSIGNED, PICKUP_COMPLETED,
  -- BIN_ALERT, NGO_VERIFIED, DONATION_EXPIRING
  type              VARCHAR(50)   NOT NULL,
  title             VARCHAR(150)  NOT NULL,
  message           TEXT          NOT NULL,
  -- Additional structured data for frontend rendering (e.g., donation_id, ngo_name)
  metadata          JSONB,
  is_read           BOOLEAN       NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.notifications IS
  'In-app notification records. Supabase Realtime listens on notifications:recipient_user_id=eq.{userId} for live delivery.';

-- ---------------------------------------------------------------------------
-- TABLE 12: impact_metrics
-- One record per completed donation (UNIQUE on donation_id).
-- Values are configurable ESTIMATES based on FAO/UNEP conversion factors.
-- Ref: IMPLEMENTATION_DECISIONS.md Section 3.2, ARCHITECTURE_REVIEW.md Issue 15.1
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.impact_metrics (
  id                        UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  donation_id               UUID          NOT NULL UNIQUE REFERENCES public.food_donations(id) ON DELETE CASCADE,
  weight_kg                 NUMERIC(8,2)  NOT NULL,
  -- Configurable estimates. Defaults: KG_PER_MEAL=0.4, CO2_KG_PER_FOOD_KG=2.5
  -- Ref: lib/config/constants.ts IMPACT_CONFIG
  estimated_meals_served    INT           NOT NULL,
  estimated_co2_offset_kg   NUMERIC(8,2)  NOT NULL,
  -- Methodology metadata exposed in API response for transparency
  kg_per_meal_factor        NUMERIC(4,2)  NOT NULL DEFAULT 0.40,
  co2_factor_per_kg         NUMERIC(4,2)  NOT NULL DEFAULT 2.50,
  logged_at                 TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.impact_metrics IS
  'Estimated impact per completed donation. Values are configurable estimates based on FAO/UNEP conversion factors, not official measurements.';
COMMENT ON COLUMN public.impact_metrics.estimated_meals_served IS
  'ROUND(weight_kg / kg_per_meal_factor). Default factor: 0.4 kg/meal (FAO standard portion estimate).';
COMMENT ON COLUMN public.impact_metrics.estimated_co2_offset_kg IS
  'weight_kg * co2_factor_per_kg. Default factor: 2.5 kg CO2e/kg (UNEP Food Waste Index).';

-- ---------------------------------------------------------------------------
-- TABLE 13: audit_logs
-- Immutable append-only audit trail for all significant system actions.
-- BIGSERIAL primary key. actor_id is nullable (system-generated events).
-- This is the last table — it may reference data from any other table.
-- Ref: ARCHITECTURE.md Section 5, Table 13
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id              BIGSERIAL     PRIMARY KEY,
  actor_id        UUID          REFERENCES public.users(id) ON DELETE SET NULL,
  actor_role      VARCHAR(30),                  -- Snapshot of role at time of action
  action          VARCHAR(100)  NOT NULL,       -- e.g., 'CLAIM_DONATION', 'BIN_CONFIG_UPDATE'
  target_table    VARCHAR(50)   NOT NULL,       -- e.g., 'food_donations', 'smart_bins'
  target_id       UUID,                         -- UUID of the affected record (if applicable)
  old_values      JSONB,                        -- State before change (for UPDATE/DELETE events)
  new_values      JSONB,                        -- State after change (for INSERT/UPDATE events)
  ip_address      VARCHAR(45),                  -- IPv4 or IPv6 address of the request origin
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.audit_logs IS
  'Immutable audit trail. Append-only. Never update or delete records. Captures all significant state transitions.';
COMMENT ON COLUMN public.audit_logs.id IS
  'BIGSERIAL (not UUID) for append-only high-throughput write performance.';
COMMENT ON COLUMN public.audit_logs.actor_id IS
  'NULL for automated system-generated events (e.g., IoT threshold triggers, cron workers).';

-- =============================================================================
-- END: 20261001000002_core_tables.sql
-- =============================================================================
