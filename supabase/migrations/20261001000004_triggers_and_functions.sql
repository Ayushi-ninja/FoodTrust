-- =============================================================================
-- Migration: 20261001000004_triggers_and_functions.sql
-- Project:   FoodTrust — AI + IoT Smart Food Waste Monitoring & Redistribution
-- Phase:     Phase 1 — Database Foundation
-- Step:      4 of 5 — Trigger Functions & Database Triggers
--
-- PREREQUISITES: 20261001000003_indexes_and_constraints.sql must be applied first.
--
-- Functions defined in this migration:
--   1. update_updated_at_column()   — Auto-timestamp updated_at on any table
--   2. handle_new_user()            — auth.users → public.users sync trigger
--
-- References:
--   IMPLEMENTATION_DECISIONS.md Section 2.1 (User Synchronization)
--   ARCHITECTURE_REVIEW.md      Issue 5.2  (Split-brain auth.users sync)
--   ARCHITECTURE_REVIEW.md      Issue 8.1  (RLS SECURITY DEFINER function)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. AUTO-UPDATE updated_at COLUMN
--
-- A reusable trigger function that sets updated_at = NOW() before any UPDATE
-- on any table that has this trigger attached.
-- Applied to: users, donor_profiles, ngo_profiles, smart_bins, food_trays,
--             food_donations, pickups.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.update_updated_at_column() IS
  'Generic trigger function: sets updated_at = NOW() before any UPDATE operation. Attached to all tables with an updated_at column.';

-- Apply update_updated_at_column trigger to all tables with updated_at

CREATE OR REPLACE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE TRIGGER trg_donor_profiles_updated_at
  BEFORE UPDATE ON public.donor_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE TRIGGER trg_ngo_profiles_updated_at
  BEFORE UPDATE ON public.ngo_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE TRIGGER trg_smart_bins_updated_at
  BEFORE UPDATE ON public.smart_bins
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE TRIGGER trg_food_trays_updated_at
  BEFORE UPDATE ON public.food_trays
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE TRIGGER trg_food_donations_updated_at
  BEFORE UPDATE ON public.food_donations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE TRIGGER trg_pickups_updated_at
  BEFORE UPDATE ON public.pickups
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- 2. AUTH.USERS → PUBLIC.USERS SYNCHRONIZATION TRIGGER
--
-- CRITICAL: This function is the primary defense against split-brain states
-- where a user exists in Supabase Auth (auth.users) but has no corresponding
-- row in public.users.
--
-- Trigger fires: AFTER INSERT ON auth.users
-- This covers every signup path: email/password, OAuth, magic link, etc.
--
-- The NEW.raw_user_meta_data JSONB column on auth.users is populated from the
-- Supabase Auth signUp() options.data payload. It carries:
--   - full_name (required)
--   - role     (defaults to 'DONOR' if not provided)
--   - phone    (optional)
--
-- SECURITY DEFINER: The function runs with the privileges of its OWNER
-- (typically the Supabase postgres superuser), NOT the calling user's session
-- privileges. This is required because the trigger fires in the auth schema
-- context, which application users cannot normally write to.
--
-- Ref: IMPLEMENTATION_DECISIONS.md Section 2.1
--      ARCHITECTURE_REVIEW.md Issue 5.2
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role    user_role_enum;
  v_status  user_status_enum;
BEGIN
  -- Resolve role from signup metadata, defaulting to DONOR.
  -- Cast is wrapped in a CASE to avoid a runtime error on invalid values.
  BEGIN
    v_role := COALESCE(
      (NEW.raw_user_meta_data->>'role')::user_role_enum,
      'DONOR'
    );
  EXCEPTION WHEN invalid_text_representation THEN
    v_role := 'DONOR';
  END;

  -- NGO accounts begin as PENDING until an admin verifies their registration.
  -- All other roles start as ACTIVE.
  IF v_role = 'NGO' THEN
    v_status := 'PENDING';
  ELSE
    v_status := 'ACTIVE';
  END IF;

  INSERT INTO public.users (
    id,
    email,
    phone,
    full_name,
    role,
    status,
    created_at,
    updated_at
  ) VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'phone', NULL),
    COALESCE(NEW.raw_user_meta_data->>'full_name', 'Unknown User'),
    v_role,
    v_status,
    NOW(),
    NOW()
  )
  ON CONFLICT (id) DO NOTHING; -- Idempotent: safe to re-run if somehow called twice

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.handle_new_user() IS
  'SECURITY DEFINER trigger: atomically creates a public.users row after every auth.users INSERT. Prevents split-brain between Supabase Auth and the application user table.';

-- Attach the trigger to auth.users
-- Fires AFTER INSERT so the auth.users row is fully committed before we reference it.
CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ---------------------------------------------------------------------------
-- 3. FOOD TRAY updated_at AUTO-UPDATE on weight changes
--    When sensor_telemetry is inserted with a tray_id, the matching food_trays
--    row's current_weight_kg and updated_at should be kept fresh.
--    This trigger updates food_trays after each telemetry insert.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_tray_weight_from_telemetry()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only update if tray_id and weight_kg are present in the new telemetry row
  IF NEW.tray_id IS NOT NULL AND NEW.weight_kg IS NOT NULL THEN
    UPDATE public.food_trays
    SET
      current_weight_kg = NEW.weight_kg,
      updated_at        = NOW()
    WHERE id = NEW.tray_id;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.sync_tray_weight_from_telemetry() IS
  'After each sensor_telemetry INSERT, updates food_trays.current_weight_kg to reflect the latest tray weight reading from the ESP32.';

CREATE OR REPLACE TRIGGER trg_sync_tray_weight
  AFTER INSERT ON public.sensor_telemetry
  FOR EACH ROW EXECUTE FUNCTION public.sync_tray_weight_from_telemetry();

-- ---------------------------------------------------------------------------
-- 4. SMART BIN last_heartbeat_at UPDATE
--    When a heartbeat record arrives (written as sensor_telemetry without
--    a tray_id and weight_kg), update the bin's last_heartbeat_at timestamp.
--    This keeps the bin status current without a separate heartbeat table.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_bin_heartbeat()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.smart_bins
  SET
    last_heartbeat_at = NEW.recorded_at,
    status            = 'ONLINE',
    updated_at        = NOW()
  WHERE id = NEW.bin_id;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.sync_bin_heartbeat() IS
  'After each sensor_telemetry INSERT, updates smart_bins.last_heartbeat_at and sets status to ONLINE.';

CREATE OR REPLACE TRIGGER trg_sync_bin_heartbeat
  AFTER INSERT ON public.sensor_telemetry
  FOR EACH ROW EXECUTE FUNCTION public.sync_bin_heartbeat();

-- =============================================================================
-- END: 20261001000004_triggers_and_functions.sql
-- =============================================================================
