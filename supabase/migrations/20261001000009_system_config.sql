-- =============================================================================
-- Migration: 20261001000009_system_config.sql
-- FoodTrust — Phase 9: Analytics, Notifications & Admin Oversight
--
-- Creates the system_config table for persistent runtime configuration.
-- Only ADMIN/SUPER_ADMIN can read; only service-role (SUPER_ADMIN API) can write.
-- Allowlisted keys: kg_per_meal_factor, co2_factor_per_kg
-- Ref: IMPLEMENTATION_DECISIONS.md — config must be read from DB for changes to take effect.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- TABLE: system_config
-- Key-value store for allowlisted runtime configuration parameters.
-- Rows are pre-seeded; no client INSERT is allowed.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.system_config (
  key          VARCHAR(100) PRIMARY KEY,
  value        TEXT         NOT NULL,
  description  TEXT,
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_by   UUID         REFERENCES public.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.system_config IS
  'Runtime configuration key-value store. Pre-seeded rows only. '
  'All writes go through the service-role API. '
  'Allowlisted keys: kg_per_meal_factor, co2_factor_per_kg.';

-- ---------------------------------------------------------------------------
-- Seed default values
-- ---------------------------------------------------------------------------
INSERT INTO public.system_config (key, value, description) VALUES
  (
    'kg_per_meal_factor',
    '0.40',
    'FAO standard portion estimate: kg of food per meal served (default 0.40 kg).'
  ),
  (
    'co2_factor_per_kg',
    '2.50',
    'UNEP Food Waste Index CO2e factor: kg CO2 offset per kg of food redistributed (default 2.50).'
  )
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Trigger: keep updated_at current on every UPDATE
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_system_config_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_system_config_updated_at
  BEFORE UPDATE ON public.system_config
  FOR EACH ROW
  EXECUTE FUNCTION public.update_system_config_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.system_config ENABLE ROW LEVEL SECURITY;

-- Admins can read all config rows
CREATE POLICY "system_config: admin select"
  ON public.system_config FOR SELECT
  USING (is_admin());

-- Only service-role can INSERT or UPDATE (bypasses RLS)
-- No client-side INSERT/UPDATE/DELETE policies defined.

-- =============================================================================
-- END: 20261001000009_system_config.sql
-- =============================================================================
