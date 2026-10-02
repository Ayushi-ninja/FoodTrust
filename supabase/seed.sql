-- =============================================================================
-- Seed Data: supabase/seed.sql
-- Project:   FoodTrust — AI + IoT Smart Food Waste Monitoring & Redistribution
-- Phase:     Phase 1 — Database Foundation
--
-- PURPOSE:
--   Provides reproducible demo/development data for local testing.
--   All records are clearly marked as demo data.
--
-- IMPORTANT CONSTRAINTS:
--   1. auth.users rows CANNOT be created via SQL — they MUST be created through
--      the Supabase Auth Admin API or the Supabase Dashboard > Authentication.
--      The handle_new_user() trigger will then create the public.users rows.
--      The UUIDs used here MUST match what Supabase Auth assigns.
--
--   2. api_key_hash values are SHA-256 hashes, NOT plaintext tokens.
--      Plaintext: "dt_demo_bin_delhi_001_seed_key"
--      Hashed:    SHA256("dt_demo_bin_delhi_001_seed_key" + YOUR_IOT_DEVICE_SHARED_SALT)
--      The hash below is a PLACEHOLDER. Generate a real hash using:
--        node -e "const c=require('crypto'); console.log(c.createHash('sha256').update('dt_demo_bin_delhi_001_seed_key' + process.env.IOT_DEVICE_SHARED_SALT).digest('hex'))"
--
--   3. otp_code_hash values in the pickups demo row are similarly hashed.
--      Plaintext demo OTP: "482719"
--
--   4. These UUIDs are hardcoded placeholders. They MUST be replaced with the
--      actual UUIDs generated when you create the auth.users via Supabase Auth.
--
-- HOW TO USE:
--   Step 1: Create demo users via Supabase Dashboard > Authentication > Users
--           - donor@foodtrust.dev    (role: DONOR, full_name: "Green Leaf Restaurant")
--           - ngo@foodtrust.dev      (role: NGO,   full_name: "Asha Foundation")
--           - admin@foodtrust.dev    (role: ADMIN,  full_name: "FoodTrust Admin")
--           Copy the UUIDs Supabase assigns to those users.
--   Step 2: Replace the placeholder UUIDs in this file with the real ones.
--   Step 3: Execute this file in the Supabase SQL Editor.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- PLACEHOLDER UUIDs — REPLACE BEFORE RUNNING
-- ---------------------------------------------------------------------------
-- Supabase Auth UUID for donor@foodtrust.dev
-- Replace: 'a1b2c3d4-0001-0001-0001-000000000001'
-- Supabase Auth UUID for ngo@foodtrust.dev
-- Replace: 'a1b2c3d4-0002-0002-0002-000000000002'
-- Supabase Auth UUID for admin@foodtrust.dev
-- Replace: 'a1b2c3d4-0003-0003-0003-000000000003'
-- ---------------------------------------------------------------------------

-- NOTE: public.users rows are auto-created by handle_new_user() trigger
-- when you create the auth.users records above. The below UPDATE statements
-- ensure the demo role assignments are correct in case the trigger defaults differ.

UPDATE public.users
SET role = 'DONOR', status = 'ACTIVE', full_name = 'Green Leaf Restaurant', phone = '+91-9876543210'
WHERE email = 'donor@foodtrust.dev';

UPDATE public.users
SET role = 'NGO', status = 'ACTIVE', full_name = 'Asha Foundation', phone = '+91-9876543211'
WHERE email = 'ngo@foodtrust.dev';

UPDATE public.users
SET role = 'ADMIN', status = 'ACTIVE', full_name = 'FoodTrust Admin', phone = '+91-9876543212'
WHERE email = 'admin@foodtrust.dev';

-- ---------------------------------------------------------------------------
-- DEMO DONOR PROFILE
-- user_id must match the UUID Supabase Auth assigned to donor@foodtrust.dev
-- ---------------------------------------------------------------------------
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
SELECT
  'dp-demo-0001-0001-0001-000000000001'::UUID,
  id,
  'Green Leaf Restaurant',
  'Restaurant',
  'FSSAI-DL-2024-123456',
  'Plot 12, Connaught Place, New Delhi - 110001',
  28.6315,
  77.2167,
  'Raj Sharma'
FROM public.users
WHERE email = 'donor@foodtrust.dev'
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- DEMO NGO PROFILE
-- user_id must match the UUID Supabase Auth assigned to ngo@foodtrust.dev
-- ---------------------------------------------------------------------------
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
SELECT
  'np-demo-0002-0002-0002-000000000002'::UUID,
  id,
  'Asha Foundation',
  'DARPAN-DL-NGO-2024-0042',
  20.0,
  TRUE,
  250.0,
  28.6448,
  77.2167,
  'VERIFIED',
  'Block C, Karol Bagh, New Delhi - 110005',
  'Priya Nair',
  '+91-9876543211'
FROM public.users
WHERE email = 'ngo@foodtrust.dev'
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- DEMO SMART BIN (Electronics Unit record)
-- api_key_hash: PLACEHOLDER — replace with real SHA-256 hash
-- See instructions at top of this file for hash generation command.
-- ---------------------------------------------------------------------------
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
  'sb-demo-0001-0001-0001-000000000001'::UUID,
  'BIN-DELHI-001',
  'dp-demo-0001-0001-0001-000000000001'::UUID,
  -- PLACEHOLDER HASH — compute real hash before using in production
  'PLACEHOLDER_SHA256_HASH_REPLACE_WITH_REAL_VALUE',
  'ONLINE',
  '1.0.4',
  'Kitchen area, near exit — rear wall mounting'
)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- DEMO FOOD TRAYS (Food Handling Unit records — 2 trays for BIN-DELHI-001)
-- ---------------------------------------------------------------------------
INSERT INTO public.food_trays (id, bin_id, tray_number, assigned_category, tare_weight_kg)
VALUES
  (
    'ft-demo-0001-0001-0001-000000000001'::UUID,
    'sb-demo-0001-0001-0001-000000000001'::UUID,
    1,
    'COOKED_MEALS',
    2.50
  ),
  (
    'ft-demo-0001-0001-0001-000000000002'::UUID,
    'sb-demo-0001-0001-0001-000000000001'::UUID,
    2,
    'VEGETABLES',
    2.50
  )
ON CONFLICT (bin_id, tray_number) DO NOTHING;

-- ---------------------------------------------------------------------------
-- DEMO FOOD DONATION (Available — suitable for NGO matching test)
-- freshness_score and risk_level are decision-support values, NOT certified safety.
-- ---------------------------------------------------------------------------
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
  freshness_score,
  freshness_status,
  risk_level,
  shelf_life_hours_remaining,
  status,
  pickup_address,
  latitude,
  longitude
)
VALUES (
  'fd-demo-0001-0001-0001-000000000001'::UUID,
  'dp-demo-0001-0001-0001-000000000001'::UUID,
  'sb-demo-0001-0001-0001-000000000001'::UUID,
  'ft-demo-0001-0001-0001-000000000001'::UUID,
  'Dal Makhani & Rice — Lunch Surplus',
  'Freshly prepared lunch surplus from restaurant kitchen. Contains: Dal Makhani, Steamed Rice, Roti.',
  'COOKED_MEALS',
  12.70,
  NOW() - INTERVAL '2 hours',
  88,          -- Decision-support freshness score (not certified safety)
  'FRESH',     -- Decision-support status (not certified safety)
  'LOW',       -- Decision-support risk level (not certified safety)
  14.5,
  'AVAILABLE',
  'Plot 12, Connaught Place, New Delhi - 110001',
  28.6315,
  77.2167
)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- DEMO SENSOR TELEMETRY (one sample batch for BIN-DELHI-001)
-- Simulates an ESP32 telemetry packet received from the Electronics Unit.
-- ---------------------------------------------------------------------------
INSERT INTO public.sensor_telemetry (
  bin_id, tray_id, weight_kg, temperature_c, humidity_pct, voc_gas_ppm,
  lid_open, battery_pct, firmware_version, recorded_at
)
VALUES
  -- Chamber ambient reading (no tray_id)
  (
    'sb-demo-0001-0001-0001-000000000001'::UUID,
    NULL,
    NULL,
    22.4,
    55.8,
    118.2,
    FALSE,
    94,
    '1.0.4',
    NOW() - INTERVAL '30 minutes'
  ),
  -- Tray 1 weight reading (COOKED_MEALS)
  (
    'sb-demo-0001-0001-0001-000000000001'::UUID,
    'ft-demo-0001-0001-0001-000000000001'::UUID,
    15.20,
    22.4,
    55.8,
    118.2,
    FALSE,
    94,
    '1.0.4',
    NOW() - INTERVAL '30 minutes'
  ),
  -- Tray 2 weight reading (VEGETABLES)
  (
    'sb-demo-0001-0001-0001-000000000001'::UUID,
    'ft-demo-0001-0001-0001-000000000002'::UUID,
    6.80,
    22.4,
    55.8,
    118.2,
    FALSE,
    94,
    '1.0.4',
    NOW() - INTERVAL '30 minutes'
  );

-- ---------------------------------------------------------------------------
-- DEMO FRESHNESS LOG (matches the demo donation above)
-- Decision-support evaluation — NOT a certified food safety record.
-- ---------------------------------------------------------------------------
INSERT INTO public.freshness_logs (
  donation_id, evaluated_score, freshness_status, risk_level,
  shelf_life_hours, gas_reading_ppm, temperature_c, humidity_pct
)
VALUES (
  'fd-demo-0001-0001-0001-000000000001'::UUID,
  88,
  'FRESH',
  'LOW',
  14.5,
  118.2,
  22.4,
  55.8
);

-- ---------------------------------------------------------------------------
-- DEMO NOTIFICATION (to the NGO user about the available donation)
-- ---------------------------------------------------------------------------
INSERT INTO public.notifications (
  recipient_user_id,
  type,
  title,
  message,
  metadata
)
SELECT
  id,
  'DONATION_AVAILABLE',
  'New Donation Available Near You',
  'A fresh donation of 12.7 kg Cooked Meals is available at Connaught Place. Estimated shelf life: 14.5 hours.',
  jsonb_build_object(
    'donation_id', 'fd-demo-0001-0001-0001-000000000001',
    'distance_km', 1.5,
    'food_category', 'COOKED_MEALS'
  )
FROM public.users
WHERE email = 'ngo@foodtrust.dev';

-- =============================================================================
-- END: supabase/seed.sql
-- =============================================================================
