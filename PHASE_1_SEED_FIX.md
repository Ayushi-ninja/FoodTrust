# 🔧 Phase 1 Seed Fix Report
## AI + IoT Smart Food Waste Monitoring & Redistribution System (**FoodTrust**)

**Document:** `PHASE_1_SEED_FIX.md`
**Date:** October 3, 2026
**Scope:** `supabase/seed.sql` fix only — no migration files modified

---

## 1. Root Cause

The original `supabase/seed.sql` used human-readable placeholder strings cast to `UUID`:

```sql
'dp-demo-0001-0001-0001-000000000001'::UUID
'np-demo-0002-0002-0002-000000000002'::UUID
'sb-demo-0001-0001-0001-000000000001'::UUID
```

These strings are **not valid UUID literals**. PostgreSQL requires UUID format:
```
xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```
…where every character is a **hexadecimal digit** (0–9, a–f) and each segment has the correct character count (8-4-4-4-12).

The strings above fail on two counts:
1. **Non-hex characters** — `'p'`, `'s'`, `'f'`, `'t'` are not hex digits
2. **Wrong segment lengths** — `'dp-demo'` is 7 characters, not 8

PostgreSQL error thrown:
```
ERROR: 22P02: invalid input syntax for type uuid: "dp-demo-0001-0001-0001-000000000001"
```

---

## 2. Files Changed

| File | Action | Migrations Modified? |
|------|--------|----------------------|
| [`supabase/seed.sql`](file:///C:/Users/DELL/final_year_project/FoodTrust/supabase/seed.sql) | **Overwritten** with corrected version | ❌ No |

No migration files were modified. All 5 migration files remain byte-for-byte identical.

---

## 3. UUID Strategy

### Problem with original approach
Plain `'string'::UUID` casts fail unless the string is exactly a valid UUID. Separate hardcoded IDs for parent and child records also risk FK mismatches if a conflict occurs.

### Solution: PL/pgSQL DO block with fixed UUID variables + post-conflict ID re-fetch

The fixed seed wraps all inserts in a single `DO $$ ... $$` block:

```sql
DO $$
DECLARE
  -- Runtime-resolved (cannot be hardcoded — set by Supabase Auth)
  v_donor_user_id    UUID;
  v_ngo_user_id      UUID;

  -- Fixed valid UUID literals (stable across reruns)
  v_donor_profile_id UUID := 'a0000001-0000-4000-8000-000000000001';
  v_ngo_profile_id   UUID := 'a0000002-0000-4000-8000-000000000002';
  v_bin_id           UUID := 'a0000003-0000-4000-8000-000000000003';
  v_tray1_id         UUID := 'a0000004-0000-4000-8000-000000000004';
  v_tray2_id         UUID := 'a0000005-0000-4000-8000-000000000005';
  v_donation_id      UUID := 'a0000006-0000-4000-8000-000000000006';
BEGIN
  ...
END;
$$;
```

**Why these specific UUIDs are valid:**

| UUID | Seg 1 (8) | Seg 2 (4) | Seg 3 (4) | Seg 4 (4) | Seg 5 (12) |
|------|-----------|-----------|-----------|-----------|-----------|
| `a0000001-0000-4000-8000-000000000001` | `a0000001` ✅ | `0000` ✅ | `4000` ✅ | `8000` ✅ | `000000000001` ✅ |
| `a0000002-0000-4000-8000-000000000002` | `a0000002` ✅ | `0000` ✅ | `4000` ✅ | `8000` ✅ | `000000000002` ✅ |
| … | … | … | … | … | … |

All characters are hexadecimal (0–9, a–f). All segment lengths are correct.

### User IDs are resolved at runtime

`donor_profiles.user_id` and `ngo_profiles.user_id` must reference actual `auth.users` UUIDs assigned by Supabase. These cannot be hardcoded. They are fetched by email:

```sql
SELECT id INTO v_donor_user_id FROM public.users WHERE email = 'donor@foodtrust.dev';
SELECT id INTO v_ngo_user_id   FROM public.users WHERE email = 'ngo@foodtrust.dev';
```

If either user does not exist, execution halts with a clear error:
```
Seed failed: donor@foodtrust.dev not found. Create via Supabase Auth first.
```

---

## 4. Foreign Key Verification

The fixed seed guarantees FK correctness through **post-conflict ID re-fetch**:

After each `INSERT ... ON CONFLICT DO NOTHING`, the actual stored ID is re-fetched into the variable before it is used as a FK in any subsequent INSERT. This handles the case where a record already exists with a different ID from a previous run.

```sql
-- Insert donor_profile (conflict on natural key: user_id)
INSERT INTO public.donor_profiles (...) VALUES (v_donor_profile_id, v_donor_user_id, ...)
ON CONFLICT (user_id) DO NOTHING;

-- Re-fetch actual id — may differ from v_donor_profile_id if conflict was triggered
SELECT id INTO v_donor_profile_id FROM public.donor_profiles WHERE user_id = v_donor_user_id;
-- All downstream FKs (smart_bins.donor_id, food_donations.donor_id) now use the correct id
```

| Table | ON CONFLICT Target | Post-conflict Re-fetch? | Downstream FK Users |
|-------|-------------------|------------------------|---------------------|
| `donor_profiles` | `(user_id)` — UNIQUE | ✅ Yes | `smart_bins.donor_id`, `food_donations.donor_id` |
| `ngo_profiles` | `(user_id)` — UNIQUE | ✅ Yes | (notification recipient) |
| `smart_bins` | `(bin_code)` — UNIQUE | ✅ Yes | `food_trays.bin_id`, `sensor_telemetry.bin_id`, `food_donations.bin_id` |
| `food_trays` (tray 1) | `CONSTRAINT uq_bin_tray` | ✅ Yes | `sensor_telemetry.tray_id`, `food_donations.tray_id` |
| `food_trays` (tray 2) | `CONSTRAINT uq_bin_tray` | ✅ Yes | `sensor_telemetry.tray_id` |
| `food_donations` | `(id)` — PK | ❌ N/A (no natural unique) | `freshness_logs.donation_id` |
| `sensor_telemetry` | `IF NOT EXISTS` guard | N/A | — |
| `freshness_logs` | `IF NOT EXISTS` guard | N/A | — |
| `notifications` | `IF NOT EXISTS` guard | N/A | — |

---

## 5. Enum Value Verification

All enum values used in the seed were verified directly against `20261001000001_extensions_and_enums.sql`:

| Seed Value | Enum Type | Defined in Migration 1 | Result |
|------------|-----------|------------------------|--------|
| `'COOKED_MEALS'` | `food_category_enum` | ✅ | PASS |
| `'VEGETABLES'` | `food_category_enum` | ✅ | PASS |
| `'FRESH'` | `freshness_status_enum` | ✅ | PASS |
| `'LOW'` | `risk_level_enum` | ✅ | PASS |
| `'AVAILABLE'` | `donation_status_enum` | ✅ | PASS |
| `'ONLINE'` | `bin_status_enum` | ✅ | PASS |
| `'VERIFIED'` | `verification_status_enum` | ✅ | PASS |
| `'DONOR'` | `user_role_enum` | ✅ | PASS |
| `'NGO'` | `user_role_enum` | ✅ | PASS |
| `'ADMIN'` | `user_role_enum` | ✅ | PASS |
| `'ACTIVE'` | `user_status_enum` | ✅ | PASS |
| `'DONATION_AVAILABLE'` | `VARCHAR(50)` (not enum) | ✅ | PASS |

**All 12 enum/type values verified. Zero mismatches.**

---

## 6. Column Name Verification

All 31 column names used in the seed were verified against `20261001000002_core_tables.sql` via static script. All passed:

`business_name`, `establishment_type`, `fssai_license`, `contact_person`, `organization_name`, `registration_number`, `operational_radius_km`, `has_cold_storage`, `daily_capacity_kg`, `verification_status`, `bin_code`, `api_key_hash`, `location_note`, `firmware_version`, `tray_number`, `assigned_category`, `tare_weight_kg`, `current_weight_kg`, `food_category`, `quantity_kg`, `preparation_timestamp`, `freshness_score`, `freshness_status`, `risk_level`, `shelf_life_hours_remaining`, `pickup_address`, `evaluated_score`, `shelf_life_hours`, `gas_reading_ppm`, `recipient_user_id`, `is_read`

**`location` (PostGIS GEOGRAPHY generated column) is correctly excluded from all INSERT column lists** — it is auto-derived from `latitude` and `longitude`. Verified: PASS.

---

## 7. Rerun Behavior

| Table | Guard Mechanism | Behavior on 2nd Run |
|-------|----------------|---------------------|
| `users` | `UPDATE ... WHERE email = ...` | Idempotent — sets same values |
| `donor_profiles` | `ON CONFLICT (user_id) DO NOTHING` | Skip if profile exists for this user |
| `ngo_profiles` | `ON CONFLICT (user_id) DO NOTHING` | Skip if profile exists for this user |
| `smart_bins` | `ON CONFLICT (bin_code) DO NOTHING` | Skip if bin with same code exists |
| `food_trays` | `ON CONFLICT ON CONSTRAINT uq_bin_tray DO NOTHING` | Skip if (bin_id, tray_number) exists |
| `food_donations` | `ON CONFLICT (id) DO NOTHING` | Skip if donation with same id exists |
| `sensor_telemetry` | `IF NOT EXISTS ... WHERE bin_id = v_bin_id` | Skip all 3 telemetry rows if any exist for bin |
| `freshness_logs` | `IF NOT EXISTS ... WHERE donation_id = v_donation_id` | Skip if any log exists for donation |
| `notifications` | `IF NOT EXISTS ... WHERE recipient_user_id AND type` | Skip if DONATION_AVAILABLE already sent to NGO |

> [!NOTE]
> `sensor_telemetry` and `freshness_logs` use `BIGSERIAL` primary keys with no natural unique index,
> so `ON CONFLICT` is not available. The `IF NOT EXISTS` guard prevents duplicate rows on re-run.

---

## 8. Security Properties (Unchanged)

| Property | Status |
|----------|--------|
| `api_key_hash` stores a placeholder hash label, not a plaintext token | ✅ |
| No `otp_code`, `password`, `secret`, or raw token columns in seed | ✅ |
| Freshness fields (`freshness_score`, `freshness_status`, `risk_level`) are labeled as decision-support values in comments | ✅ |
| No certified food safety claims anywhere in the seed | ✅ |

---

## 9. Static Review Results

Run against the fixed seed.sql:

| Check | Result |
|-------|--------|
| Invalid UUID string `dp-demo-*` in executable SQL | ✅ PASS (found only in a comment — not in executable code) |
| Valid UUID format for all 6 demo record IDs | ✅ PASS (7 UUID literals detected, all correctly formatted) |
| All enum values match migration 1 definitions | ✅ PASS (7/7) |
| All column names match migration 2 definitions | ✅ PASS (31/31) |
| `location` GEOGRAPHY column absent from INSERT lists | ✅ PASS |
| No plaintext secret patterns | ✅ PASS |
| Prerequisite guard (`RAISE EXCEPTION`) present | ✅ PASS (lines 83, 90 — multi-line statement) |
| `ON CONFLICT` clauses | ✅ PASS (13 found) |
| `IF NOT EXISTS` guards | ✅ PASS (7 found — 3 for append-only tables + 4 in extension/check blocks) |

---

## 10. Remaining Manual Supabase Steps

> [!IMPORTANT]
> The following steps must still be completed manually before running the seed.

### Step 1 — Apply migrations (if not already done)
Run in order in the Supabase SQL Editor:
1. `20261001000001_extensions_and_enums.sql`
2. `20261001000002_core_tables.sql`
3. `20261001000003_indexes_and_constraints.sql`
4. `20261001000004_triggers_and_functions.sql`
5. `20261001000005_rls_policies.sql`

### Step 2 — Create auth users
Go to **Supabase Dashboard → Authentication → Users → Add User**:
- `donor@foodtrust.dev`
- `ngo@foodtrust.dev`
- `admin@foodtrust.dev`

The `handle_new_user()` trigger will create `public.users` rows automatically.

### Step 3 — Replace the api_key_hash placeholder
In `supabase/seed.sql`, line with `PLACEHOLDER_SHA256_HASH_REPLACE_WITH_REAL_VALUE`:

Generate the real hash:
```bash
node -e "const c=require('crypto'); \
  console.log(c.createHash('sha256') \
    .update('dt_demo_bin_delhi_001_seed_key' + process.env.IOT_DEVICE_SHARED_SALT) \
    .digest('hex'))"
```
Replace the placeholder string with the output of that command.

### Step 4 — Run the fixed seed
Copy the full contents of `supabase/seed.sql` into the Supabase SQL Editor and click **Run**.

Expected output in the SQL Editor notice panel:
```
NOTICE: FoodTrust seed complete. donor_profile_id=a0000001-... | ngo_profile_id=a0000002-... | ...
```

### Step 5 — Verify in Table Editor
Confirm rows exist in:
- `public.donor_profiles` (1 row — Green Leaf Restaurant)
- `public.ngo_profiles` (1 row — Asha Foundation, VERIFIED)
- `public.smart_bins` (1 row — BIN-DELHI-001)
- `public.food_trays` (2 rows — tray 1 COOKED_MEALS, tray 2 VEGETABLES)
- `public.food_donations` (1 row — AVAILABLE)
- `public.sensor_telemetry` (3 rows)
- `public.freshness_logs` (1 row)
- `public.notifications` (1 row)
