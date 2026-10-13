-- =============================================================================
-- Seed Data: supabase/seed.sql
-- Project:   FoodTrust — AI + IoT Smart Food Waste Monitoring & Redistribution
-- Phase:     Phase 1 — Database Foundation (FIXED — v2)
--
-- ROOT CAUSE OF PREVIOUS FAILURE (22P02):
--   Placeholder strings such as 'dp-demo-0001-0001-0001-000000000001' were cast
--   to UUID. These strings contain non-hex characters ('p', 's', 'f', 't') and
--   malformed segments, making them invalid UUID literals. PostgreSQL rejected
--   them with ERROR 22P02: invalid input syntax for type uuid.
--
-- FIX STRATEGY:
--   1. All demo record IDs are declared as fixed, properly-formatted UUID
--      literals inside a PL/pgSQL DO block (e.g. 'a0000001-0000-4000-8000-000000000001').
--   2. User IDs for donor/NGO/admin are resolved at runtime via:
--        SELECT id FROM public.users WHERE email = '...';
--   3. Each INSERT uses the most specific natural unique constraint for
--      ON CONFLICT so that re-runs are safe and foreign keys remain consistent.
--   4. After each INSERT with ON CONFLICT DO NOTHING, the actual stored ID is
--      re-fetched into the variable so downstream FK references are always
--      pointing to the true stored id, even if the initial INSERT was skipped.
--   5. Append-only tables (sensor_telemetry, freshness_logs) are guarded by
--      IF NOT EXISTS checks to prevent duplicate rows on re-run.
--
-- PREREQUISITES (manual steps — must be done before running this file):
--   Step 1: Apply all 5 migration files (000001 → 000005) in order.
--   Step 2: Create three demo users in Supabase Dashboard > Authentication > Users:
--             donor@foodtrust.dev
--             ngo@foodtrust.dev
--             admin@foodtrust.dev
--           The handle_new_user() trigger will populate public.users automatically.
--   Step 3: Generate a real api_key_hash using:
--             node -e "const c=require('crypto'); \
--               console.log(c.createHash('sha256') \
--               .update('dt_demo_bin_delhi_001_seed_key' + process.env.IOT_DEVICE_SHARED_SALT) \
--               .digest('hex'))"
--           Then replace the PLACEHOLDER_SHA256_HASH value below.
--   Step 4: Run this file in the Supabase Dashboard SQL Editor.
--
-- RERUN SAFETY:
--   This script is safely rerunnable. Each INSERT uses ON CONFLICT DO NOTHING
--   or IF NOT EXISTS guards. Existing data is not overwritten.
-- =============================================================================

DO $$
DECLARE
  -- -------------------------------------------------------------------------
  -- Runtime-resolved user IDs (fetched from public.users by email).
  -- These are set by Supabase Auth and cannot be hardcoded.
  -- -------------------------------------------------------------------------
  v_donor_user_id    UUID;
  v_ngo_user_id      UUID;

  -- -------------------------------------------------------------------------
  -- Fixed demo record UUIDs.
  -- Format: 8-4-4-4-12 hex characters — all valid UUID literals.
  -- These are stable across reruns. Do not change them after initial seed.
  -- -------------------------------------------------------------------------
  v_donor_profile_id UUID := 'a0000001-0000-4000-8000-000000000001';
  v_ngo_profile_id   UUID := 'a0000002-0000-4000-8000-000000000002';
  v_bin_id           UUID := 'a0000003-0000-4000-8000-000000000003';
  v_tray1_id         UUID := 'a0000004-0000-4000-8000-000000000004';
  v_tray2_id         UUID := 'a0000005-0000-4000-8000-000000000005';
  v_donation_id      UUID := 'a0000006-0000-4000-8000-000000000006';

BEGIN

  -- ==========================================================================
  -- STEP 1: Resolve user IDs from public.users.
  --         These rows are created by the handle_new_user() trigger when
  --         auth users are created. If these SELECTs return NULL, the auth
  --         users do not exist yet — seed cannot proceed.
  -- ==========================================================================
  SELECT id INTO v_donor_user_id
  FROM public.users
  WHERE email = 'donor@foodtrust.dev';

  SELECT id INTO v_ngo_user_id
  FROM public.users
  WHERE email = 'ngo@foodtrust.dev';

  IF v_donor_user_id IS NULL THEN
    RAISE EXCEPTION
      'Seed prerequisite not met: no public.users row for donor@foodtrust.dev. '
      'Create this user via Supabase Dashboard > Authentication > Users first. '
      'The handle_new_user() trigger will create the public.users row automatically.';
  END IF;

  IF v_ngo_user_id IS NULL THEN
    RAISE EXCEPTION
      'Seed prerequisite not met: no public.users row for ngo@foodtrust.dev. '
      'Create this user via Supabase Dashboard > Authentication > Users first.';
  END IF;

  -- ==========================================================================
  -- STEP 2: Ensure correct role and status on demo user accounts.
  --         The handle_new_user() trigger defaults all new users to DONOR.
  --         These UPDATEs correct the roles for NGO and ADMIN accounts.
  --         Safe to re-run (idempotent UPDATE).
  -- ==========================================================================
  UPDATE public.users
  SET
    role       = 'DONOR',
    status     = 'ACTIVE',
    full_name  = 'Green Leaf Restaurant',
    phone      = '+91-9876543210',
    updated_at = NOW()
  WHERE email = 'donor@foodtrust.dev';

  UPDATE public.users
  SET
    role       = 'NGO',
    status     = 'ACTIVE',
    full_name  = 'Asha Foundation',
    phone      = '+91-9876543211',
    updated_at = NOW()
  WHERE email = 'ngo@foodtrust.dev';

  -- Admin role: status ACTIVE, no profile table needed
  UPDATE public.users
  SET
    role       = 'ADMIN',
    status     = 'ACTIVE',
    full_name  = 'FoodTrust Admin',
    phone      = '+91-9876543212',
    updated_at = NOW()
  WHERE email = 'admin@foodtrust.dev';

  -- ==========================================================================
  -- STEP 3: donor_profiles
  --
  -- Columns (from migration 20261001000002_core_tables.sql):
  --   id UUID PK, user_id UUID NOT NULL UNIQUE, business_name VARCHAR(150) NOT NULL,
  --   establishment_type VARCHAR(50), fssai_license VARCHAR(50),
  --   address TEXT NOT NULL, latitude DOUBLE PRECISION NOT NULL,
  --   longitude DOUBLE PRECISION NOT NULL,
  --   location GEOGRAPHY GENERATED (do NOT insert — auto-derived),
  --   contact_person VARCHAR(100), created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
  --
  -- Conflict: ON CONFLICT (user_id) — the natural unique key for "one profile
  -- per user". Using user_id rather than id catches the case where the profile
  -- already exists with a different id.
  -- ==========================================================================
  INSERT INTO public.donor_profiles (
    id,
    user_id,
    business_name,
    establishment_type,
    fssai_license,
    address,
    latitude,
    longitude,
    contact_person
  )
  VALUES (
    v_donor_profile_id,
    v_donor_user_id,
    'Green Leaf Restaurant',
    'Restaurant',
    'FSSAI-DL-2024-123456',
    'Plot 12, Connaught Place, New Delhi - 110001',
    28.6315,
    77.2167,
    'Raj Sharma'
  )
  ON CONFLICT (user_id) DO NOTHING;

  -- Re-fetch actual stored id in case the INSERT was skipped due to conflict.
  -- All downstream FK references use this re-fetched value.
  SELECT id INTO v_donor_profile_id
  FROM public.donor_profiles
  WHERE user_id = v_donor_user_id;

  -- ==========================================================================
  -- STEP 4: ngo_profiles
  --
  -- Columns (from migration 20261001000002_core_tables.sql):
  --   id UUID PK, user_id UUID NOT NULL UNIQUE, organization_name VARCHAR(150) NOT NULL,
  --   registration_number VARCHAR(100) NOT NULL,
  --   operational_radius_km NUMERIC(5,2) NOT NULL DEFAULT 15.0,
  --   has_cold_storage BOOLEAN NOT NULL DEFAULT FALSE,
  --   daily_capacity_kg NUMERIC(8,2) NOT NULL DEFAULT 100.0,
  --   latitude DOUBLE PRECISION NOT NULL, longitude DOUBLE PRECISION NOT NULL,
  --   location GEOGRAPHY GENERATED (do NOT insert),
  --   verification_status verification_status_enum NOT NULL DEFAULT 'PENDING',
  --   address TEXT, contact_person VARCHAR(100), contact_phone VARCHAR(20),
  --   created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
  --
  -- Enum values for verification_status_enum (migration 1):
  --   'PENDING' | 'VERIFIED' | 'REJECTED'
  -- ==========================================================================
  INSERT INTO public.ngo_profiles (
    id,
    user_id,
    organization_name,
    registration_number,
    operational_radius_km,
    has_cold_storage,
    daily_capacity_kg,
    latitude,
    longitude,
    verification_status,
    address,
    contact_person,
    contact_phone
  )
  VALUES (
    v_ngo_profile_id,
    v_ngo_user_id,
    'Asha Foundation',
    'DARPAN-DL-NGO-2024-0042',
    20.0,
    TRUE,
    250.0,
    28.6448,
    77.2167,
    'VERIFIED',                              -- verification_status_enum: VERIFIED
    'Block C, Karol Bagh, New Delhi - 110005',
    'Priya Nair',
    '+91-9876543211'
  )
  ON CONFLICT (user_id) DO NOTHING;

  SELECT id INTO v_ngo_profile_id
  FROM public.ngo_profiles
  WHERE user_id = v_ngo_user_id;

  -- ==========================================================================
  -- STEP 5: smart_bins (Electronics Unit record)
  --
  -- Columns (from migration 20261001000002_core_tables.sql):
  --   id UUID PK, bin_code VARCHAR(50) NOT NULL UNIQUE,
  --   donor_id UUID NOT NULL REFERENCES donor_profiles(id),
  --   api_key_hash VARCHAR(255) NOT NULL,
  --   status bin_status_enum NOT NULL DEFAULT 'OFFLINE',
  --   firmware_version VARCHAR(20), last_heartbeat_at TIMESTAMPTZ,
  --   location_note TEXT, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
  --
  -- Enum values for bin_status_enum (migration 1):
  --   'ONLINE' | 'OFFLINE' | 'MAINTENANCE' | 'ALERT'
  --
  -- SECURITY: api_key_hash MUST be a SHA-256 hash, NOT a plaintext token.
  -- Replace PLACEHOLDER_SHA256_HASH_REPLACE_WITH_REAL_VALUE with:
  --   node -e "const c=require('crypto');
  --     console.log(c.createHash('sha256')
  --       .update('dt_demo_bin_delhi_001_seed_key'+process.env.IOT_DEVICE_SHARED_SALT)
  --       .digest('hex'))"
  --
  -- Conflict: ON CONFLICT (bin_code) — the natural unique key for bins.
  -- ==========================================================================
  INSERT INTO public.smart_bins (
    id,
    bin_code,
    donor_id,
    api_key_hash,
    status,
    firmware_version,
    location_note
  )
  VALUES (
    v_bin_id,
    'BIN-DELHI-001',
    v_donor_profile_id,
    -- REPLACE THIS VALUE with a real SHA-256 hash before production use.
    -- See generation command in the file header above.
    'PLACEHOLDER_SHA256_HASH_REPLACE_WITH_REAL_VALUE',
    'ONLINE',                                -- bin_status_enum: ONLINE
    '1.0.4',
    'Kitchen area, near exit — rear wall mounting'
  )
  ON CONFLICT (bin_code) DO NOTHING;

  -- Re-fetch actual bin id in case a bin with this code already existed.
  SELECT id INTO v_bin_id
  FROM public.smart_bins
  WHERE bin_code = 'BIN-DELHI-001';

  -- ==========================================================================
  -- STEP 6: food_trays (Food Handling Unit — 2 trays for BIN-DELHI-001)
  --
  -- Columns (from migration 20261001000002_core_tables.sql):
  --   id UUID PK, bin_id UUID NOT NULL REFERENCES smart_bins(id),
  --   tray_number INT NOT NULL CHECK (tray_number >= 1),
  --   assigned_category food_category_enum NOT NULL DEFAULT 'COOKED_MEALS',
  --   current_weight_kg NUMERIC(6,2) NOT NULL DEFAULT 0.00,
  --   tare_weight_kg NUMERIC(6,2) NOT NULL DEFAULT 0.00,
  --   last_calibrated_at TIMESTAMPTZ,
  --   updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  --   CONSTRAINT uq_bin_tray UNIQUE (bin_id, tray_number)
  --
  -- Enum values for food_category_enum (migration 1):
  --   'COOKED_MEALS' | 'VEGETABLES' | 'FRUITS' | 'BAKERY' | 'DAIRY'
  --
  -- Conflict: ON CONSTRAINT uq_bin_tray — the natural unique key for trays.
  -- After ON CONFLICT DO NOTHING, re-fetch actual ids for FK use downstream.
  -- ==========================================================================

  -- Tray 1: COOKED_MEALS
  INSERT INTO public.food_trays (
    id,
    bin_id,
    tray_number,
    assigned_category,
    tare_weight_kg
  )
  VALUES (
    v_tray1_id,
    v_bin_id,
    1,
    'COOKED_MEALS',                          -- food_category_enum: COOKED_MEALS
    2.50
  )
  ON CONFLICT ON CONSTRAINT uq_bin_tray DO NOTHING;

  -- Re-fetch tray 1 id in case it was previously inserted with a different UUID.
  SELECT id INTO v_tray1_id
  FROM public.food_trays
  WHERE bin_id = v_bin_id AND tray_number = 1;

  -- Tray 2: VEGETABLES
  INSERT INTO public.food_trays (
    id,
    bin_id,
    tray_number,
    assigned_category,
    tare_weight_kg
  )
  VALUES (
    v_tray2_id,
    v_bin_id,
    2,
    'VEGETABLES',                            -- food_category_enum: VEGETABLES
    2.50
  )
  ON CONFLICT ON CONSTRAINT uq_bin_tray DO NOTHING;

  SELECT id INTO v_tray2_id
  FROM public.food_trays
  WHERE bin_id = v_bin_id AND tray_number = 2;

  -- ==========================================================================
  -- STEP 7: food_donations (demo donation — status AVAILABLE)
  --
  -- Columns (from migration 20261001000002_core_tables.sql):
  --   id UUID PK, donor_id UUID NOT NULL REFERENCES donor_profiles(id),
  --   bin_id UUID REFERENCES smart_bins(id) ON DELETE SET NULL,  -- NULLABLE
  --   tray_id UUID REFERENCES food_trays(id) ON DELETE SET NULL, -- NULLABLE
  --   title VARCHAR(150) NOT NULL, description TEXT,
  --   food_category food_category_enum NOT NULL,
  --   quantity_kg NUMERIC(6,2) NOT NULL CHECK (quantity_kg > 0),
  --   preparation_timestamp TIMESTAMPTZ NOT NULL,
  --   freshness_score INT NOT NULL DEFAULT 100 CHECK (BETWEEN 0 AND 100),
  --   freshness_status freshness_status_enum NOT NULL DEFAULT 'FRESH',
  --   risk_level risk_level_enum NOT NULL DEFAULT 'LOW',
  --   shelf_life_hours_remaining NUMERIC(5,1) NOT NULL DEFAULT 0.0,
  --   status donation_status_enum NOT NULL DEFAULT 'AVAILABLE',
  --   pickup_address TEXT NOT NULL,
  --   latitude DOUBLE PRECISION NOT NULL, longitude DOUBLE PRECISION NOT NULL,
  --   location GEOGRAPHY GENERATED (do NOT insert),
  --   image_url TEXT, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
  --
  -- Enum values used (all from migration 1):
  --   food_category_enum:      'COOKED_MEALS'
  --   freshness_status_enum:   'FRESH'     (decision-support — NOT certified safety)
  --   risk_level_enum:         'LOW'       (decision-support — NOT certified safety)
  --   donation_status_enum:    'AVAILABLE'
  --
  -- Conflict: ON CONFLICT (id) — no other natural unique key on food_donations.
  -- ==========================================================================
  INSERT INTO public.food_donations (
    id,
    donor_id,
    bin_id,
    tray_id,
    title,
    description,
    food_category,
    quantity_kg,
    preparation_timestamp,
    freshness_score,           -- Decision-support score (0–100). NOT certified safety.
    freshness_status,          -- Decision-support status. NOT certified safety.
    risk_level,                -- Decision-support risk level. NOT certified safety.
    shelf_life_hours_remaining,
    status,
    pickup_address,
    latitude,
    longitude
  )
  VALUES (
    v_donation_id,
    v_donor_profile_id,
    v_bin_id,
    v_tray1_id,
    'Dal Makhani & Rice — Lunch Surplus',
    'Freshly prepared lunch surplus from restaurant kitchen. '
      'Contains: Dal Makhani, Steamed Rice, Roti.',
    'COOKED_MEALS',                          -- food_category_enum
    12.70,
    NOW() - INTERVAL '2 hours',
    88,                                      -- decision-support freshness score
    'FRESH',                                 -- freshness_status_enum: FRESH
    'LOW',                                   -- risk_level_enum: LOW
    14.5,
    'AVAILABLE',                             -- donation_status_enum: AVAILABLE
    'Plot 12, Connaught Place, New Delhi - 110001',
    28.6315,
    77.2167
  )
  ON CONFLICT (id) DO NOTHING;

  -- ==========================================================================
  -- STEP 8: sensor_telemetry (3 records: 1 ambient + 2 tray readings)
  --
  -- Columns (from migration 20261001000002_core_tables.sql):
  --   id BIGSERIAL PK (auto — do NOT insert),
  --   bin_id UUID NOT NULL REFERENCES smart_bins(id),
  --   tray_id UUID REFERENCES food_trays(id) ON DELETE SET NULL, -- NULLABLE
  --   weight_kg NUMERIC(6,2),                                     -- NULLABLE
  --   temperature_c NUMERIC(5,2) NOT NULL,
  --   humidity_pct NUMERIC(5,2) NOT NULL,
  --   voc_gas_ppm NUMERIC(8,2) NOT NULL,
  --   lid_open BOOLEAN NOT NULL DEFAULT FALSE,
  --   battery_pct INT CHECK (battery_pct BETWEEN 0 AND 100),
  --   firmware_version VARCHAR(20),
  --   recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  --
  -- BIGSERIAL PK has no natural unique key — guarded by IF NOT EXISTS to
  -- avoid duplicate telemetry records on re-run.
  -- ==========================================================================
  IF NOT EXISTS (
    SELECT 1 FROM public.sensor_telemetry WHERE bin_id = v_bin_id LIMIT 1
  ) THEN
    INSERT INTO public.sensor_telemetry (
      bin_id, tray_id, weight_kg,
      temperature_c, humidity_pct, voc_gas_ppm,
      lid_open, battery_pct, firmware_version, recorded_at
    )
    VALUES
      -- Record 1: Chamber ambient reading (no tray_id, no weight_kg — both NULL)
      (
        v_bin_id,
        NULL,    -- tray_id: NULL for chamber-level ambient records
        NULL,    -- weight_kg: NULL for chamber-level ambient records
        22.4, 55.8, 118.2, FALSE, 94, '1.0.4',
        NOW() - INTERVAL '30 minutes'
      ),
      -- Record 2: Tray 1 weight reading (COOKED_MEALS tray)
      (
        v_bin_id,
        v_tray1_id,
        15.20,   -- gross weight (tare 2.5 kg → net food = 12.7 kg)
        22.4, 55.8, 118.2, FALSE, 94, '1.0.4',
        NOW() - INTERVAL '30 minutes'
      ),
      -- Record 3: Tray 2 weight reading (VEGETABLES tray)
      (
        v_bin_id,
        v_tray2_id,
        6.80,
        22.4, 55.8, 118.2, FALSE, 94, '1.0.4',
        NOW() - INTERVAL '30 minutes'
      );
  END IF;

  -- ==========================================================================
  -- STEP 9: freshness_logs (1 decision-support evaluation snapshot)
  --
  -- Columns (from migration 20261001000002_core_tables.sql):
  --   id BIGSERIAL PK (auto — do NOT insert),
  --   donation_id UUID NOT NULL REFERENCES food_donations(id),
  --   evaluated_score INT NOT NULL CHECK (BETWEEN 0 AND 100),
  --   freshness_status freshness_status_enum NOT NULL,
  --   risk_level risk_level_enum NOT NULL,
  --   shelf_life_hours NUMERIC(5,1) NOT NULL,
  --   gas_reading_ppm NUMERIC(8,2),   -- NULLABLE
  --   temperature_c NUMERIC(5,2),     -- NULLABLE
  --   humidity_pct NUMERIC(5,2),      -- NULLABLE
  --   evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  --
  -- IMPORTANT: All values here are DECISION-SUPPORT HEURISTICS.
  -- They are NOT certified food safety determinations.
  -- Ref: IMPLEMENTATION_DECISIONS.md Section 3.1
  -- ==========================================================================
  IF NOT EXISTS (
    SELECT 1 FROM public.freshness_logs WHERE donation_id = v_donation_id LIMIT 1
  ) THEN
    INSERT INTO public.freshness_logs (
      donation_id,
      evaluated_score,     -- decision-support, NOT certified safety
      freshness_status,    -- freshness_status_enum: FRESH
      risk_level,          -- risk_level_enum: LOW
      shelf_life_hours,
      gas_reading_ppm,
      temperature_c,
      humidity_pct
    )
    VALUES (
      v_donation_id,
      88,
      'FRESH',             -- freshness_status_enum: FRESH
      'LOW',               -- risk_level_enum: LOW
      14.5,
      118.2,
      22.4,
      55.8
    );
  END IF;

  -- ==========================================================================
  -- STEP 10: notifications (1 demo notification to the NGO user)
  --
  -- Columns (from migration 20261001000002_core_tables.sql):
  --   id UUID PK DEFAULT uuid_generate_v4(),
  --   recipient_user_id UUID NOT NULL REFERENCES users(id),
  --   type VARCHAR(50) NOT NULL,
  --   title VARCHAR(150) NOT NULL,
  --   message TEXT NOT NULL,
  --   metadata JSONB,
  --   is_read BOOLEAN NOT NULL DEFAULT FALSE,
  --   created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  --
  -- Guarded by IF NOT EXISTS on (recipient_user_id, type) so re-runs do not
  -- insert duplicate notifications.
  -- ==========================================================================
  IF NOT EXISTS (
    SELECT 1
    FROM public.notifications
    WHERE recipient_user_id = v_ngo_user_id
      AND type = 'DONATION_AVAILABLE'
    LIMIT 1
  ) THEN
    INSERT INTO public.notifications (
      recipient_user_id,
      type,
      title,
      message,
      metadata
    )
    VALUES (
      v_ngo_user_id,
      'DONATION_AVAILABLE',
      'New Donation Available Near You',
      'A fresh donation of 12.7 kg Cooked Meals is available at Connaught Place. '
        'Estimated shelf life: 14.5 hours.',
      jsonb_build_object(
        'donation_id',   v_donation_id::TEXT,
        'distance_km',   1.5,
        'food_category', 'COOKED_MEALS'
      )
    );
  END IF;

  -- ==========================================================================
  -- COMPLETION NOTICE
  -- Printed in the Supabase SQL Editor output panel.
  -- ==========================================================================
  RAISE NOTICE
    'FoodTrust seed complete.'
    ' donor_profile_id=% | ngo_profile_id=% | bin_id=% | tray1_id=% | tray2_id=% | donation_id=%',
    v_donor_profile_id,
    v_ngo_profile_id,
    v_bin_id,
    v_tray1_id,
    v_tray2_id,
    v_donation_id;

END;
$$;
-- =============================================================================
-- END: supabase/seed.sql
-- =============================================================================
