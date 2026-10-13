# FoodTrust — Analytics, Notifications & Admin Oversight
## Phase 9 API Documentation

---

## Overview

Phase 9 adds three capability groups to the FoodTrust backend:

1. **Analytics** — Role-scoped aggregated metrics (DB-side; no in-memory iteration over full datasets)
2. **Notifications** — In-app notification management (Supabase Realtime-compatible; no external delivery)
3. **Admin Oversight** — User management, sanitized audit log access, and persistent runtime config

All endpoints follow the existing conventions:
- Success: `{ success: true, data: ..., message: ..., timestamp: "..." }`
- Error: `{ success: false, message: ..., error: ..., timestamp: "..." }`

---

## Analytics Endpoints

### GET `/api/analytics/overview`

**Auth:** Any authenticated user (excluding `DEVICE` role)

Returns system-wide aggregate metrics.

**Response `data`:**
```json
{
  "donations": { "total": 42, "available": 10, "delivered": 18, "cancelled": 3, "expired": 2 },
  "impact": { "total_weight_kg": 820.50, "total_meals_served": 2051, "total_co2_offset_kg": 2051.25 },
  "users": { "total": 35, "donors": 20, "ngos": 10 },
  "claims": { "total": 25, "approved": 18, "rejected": 4, "pending": 3 }
}
```

**Errors:** `401` unauthenticated, `403` DEVICE role

---

### GET `/api/analytics/donor`

**Auth:** `DONOR` role only

Returns analytics scoped to the authenticated donor's donations. Resolves donor profile from `donor_profiles` by `user_id`.

**Response `data`:**
```json
{
  "donations": { "total": 8, "available": 2, "delivered": 4, "cancelled": 1 },
  "impact": { "total_weight_kg": 180.00, "total_meals_served": 450, "total_co2_offset_kg": 450.00 },
  "top_categories": [
    { "category": "COOKED_MEALS", "count": 4 },
    { "category": "BAKERY", "count": 2 }
  ]
}
```

**Errors:** `401` unauthenticated, `403` wrong role, `404` donor profile not found

---

### GET `/api/analytics/ngo`

**Auth:** `NGO` role only

Returns analytics scoped to the authenticated NGO's claims and pickups. Resolves NGO profile from `ngo_profiles` by `user_id`.

**Response `data`:**
```json
{
  "claims": { "total": 10, "approved": 8, "rejected": 1 },
  "pickups": { "total": 8, "delivered": 6, "failed": 1 },
  "impact": { "total_weight_kg": 320.00, "total_meals_served": 800, "total_co2_offset_kg": 800.00 }
}
```

**Errors:** `401` unauthenticated, `403` wrong role, `404` NGO profile not found

---

### GET `/api/analytics/admin`

**Auth:** `ADMIN` or `SUPER_ADMIN`

Returns system-wide admin-level analytics including per-status breakdown and last-7-day activity.

**Response `data`:**
```json
{
  "system_overview": { "total_donations": 42, "active_donors": 18, "active_ngos": 9, "total_impact_kg": 820.50 },
  "donation_status_breakdown": [
    { "status": "DELIVERED", "count": 18 },
    { "status": "AVAILABLE", "count": 10 }
  ],
  "recent_activity": [
    { "date": "2026-10-06", "donations_created": 2, "deliveries_completed": 1 },
    { "date": "2026-10-07", "donations_created": 3, "deliveries_completed": 2 }
  ]
}
```

**Errors:** `401` unauthenticated, `403` insufficient role

---

## Notification Endpoints

### GET `/api/notifications`

**Auth:** Any authenticated user

**Query Params:**
| Param | Type | Default | Description |
|---|---|---|---|
| `limit` | integer | `20` | Max results (1–100) |
| `offset` | integer | `0` | Pagination offset |
| `unread_only` | boolean | `false` | Return only unread notifications |

**Response `data`:**
```json
{
  "notifications": [
    {
      "id": "uuid",
      "recipient_user_id": "uuid",
      "type": "CLAIM_APPROVED",
      "title": "Claim Approved",
      "message": "Your claim has been approved.",
      "metadata": null,
      "is_read": false,
      "created_at": "2026-10-11T10:00:00Z"
    }
  ],
  "total": 5,
  "unread_count": 2
}
```

**Errors:** `401` unauthenticated, `400` invalid params

---

### PATCH `/api/notifications/{id}/read`

**Auth:** Any authenticated user (IDOR-protected — can only mark own notifications)

**Response `data`:** Updated notification object with `is_read: true`

**Errors:**
- `401` unauthenticated
- `404` notification not found or does not belong to the authenticated user

---

## Admin Endpoints

### GET `/api/admin/users`

**Auth:** `ADMIN` or `SUPER_ADMIN`

**Query Params:**
| Param | Type | Description |
|---|---|---|
| `limit` | integer | Results per page (default 50, max 200) |
| `offset` | integer | Pagination offset |
| `role` | enum | Filter by `DONOR`, `NGO`, `ADMIN`, `SUPER_ADMIN`, `DEVICE` |
| `status` | enum | Filter by `ACTIVE`, `PENDING`, `SUSPENDED` |
| `search` | string | Case-insensitive search on `email` or `full_name` |

**Response `data`:** `{ "users": [...], "total": 35 }`

**Errors:** `401` unauthenticated, `403` insufficient role, `400` invalid params

---

### PATCH `/api/admin/users/{id}`

**Auth:** `ADMIN` or `SUPER_ADMIN`

**Request Body** (at least one field required):
```json
{ "status": "SUSPENDED" }
```
or
```json
{ "role": "NGO" }
```

**Business Rules Enforced:**
- `403` Cannot suspend your own account
- `403` Cannot assign `SUPER_ADMIN` role via this API
- `403` Only `SUPER_ADMIN` can change another `SUPER_ADMIN`'s role
- `409` Cannot suspend the last active `SUPER_ADMIN`
- `404` Target user not found

**Response `data`:** Updated `User` object

---

### GET `/api/admin/logs`

**Auth:** `ADMIN` or `SUPER_ADMIN`

Returns paginated, sanitized audit log entries. Sensitive JSONB fields (`otp_code_hash`, `password`, `token`, `hash`, etc.) are stripped from `old_values` and `new_values`.

**Query Params:**
| Param | Type | Description |
|---|---|---|
| `limit` | integer | Results per page (default 50, max 200) |
| `offset` | integer | Pagination offset |
| `actor_id` | UUID | Filter by actor user ID |
| `action` | string | Partial match on action name |
| `target_table` | string | Exact match on target table |
| `from_date` | ISO date | Filter logs from this timestamp |
| `to_date` | ISO date | Filter logs to this timestamp |

**Response `data`:** `{ "logs": [...], "total": 412 }`

---

### GET `/api/admin/config`

**Auth:** `ADMIN` or `SUPER_ADMIN`

Returns current system configuration rows from `public.system_config`.

**Response `data`:**
```json
[
  { "key": "kg_per_meal_factor", "value": "0.40", "description": "...", "updated_at": "...", "updated_by": null },
  { "key": "co2_factor_per_kg", "value": "2.50", "description": "...", "updated_at": "...", "updated_by": null }
]
```

---

### PATCH `/api/admin/config`

**Auth:** `SUPER_ADMIN` only

Updates a system configuration value. **Changes are persisted to the database and take effect on the next analytics request** — the analytics service reads conversion factors from `system_config` at query time.

**Allowlisted Keys:** `kg_per_meal_factor`, `co2_factor_per_kg`

**Request Body:**
```json
{ "key": "kg_per_meal_factor", "value": "0.45" }
```

**Validation:**
- `key` must be one of the allowlisted values
- `value` must be a positive finite number (as a string)

**Errors:**
- `401` unauthenticated
- `403` not `SUPER_ADMIN`
- `400` invalid key or value
- `404` config key not found in DB (schema-layer prevents invalid keys)

**Response `data`:** Updated config row

---

## System Configuration Notes

> [!IMPORTANT]
> `PATCH /api/admin/config` writes to `public.system_config` **and** the analytics service reads conversion factors from that table on every request. There is no in-memory cache — changes propagate immediately.

> [!NOTE]
> Impact metrics already stored in `public.impact_metrics` are NOT recalculated when config changes. Only future calculations will use the updated factors.

---

## Notifications Design Notes

- **In-app only** — no email, SMS, or push delivery.
- **Supabase Realtime** can be used by clients to subscribe to live notifications:
  ```
  channel: notifications
  filter: recipient_user_id=eq.{userId}
  ```
- **INSERT is service-role only** — clients cannot create notifications directly. Other services (claim, pickup, etc.) can call `createNotification()` from `lib/services/notification.service.ts`.

---

## Security

- All admin endpoints require `ADMIN` or `SUPER_ADMIN` role.
- `PATCH /api/admin/config` is restricted to `SUPER_ADMIN` only.
- Notifications are IDOR-protected: `markNotificationRead` verifies `recipient_user_id = userId`.
- Audit logs have sensitive JSONB keys stripped before API responses.
- No analytics endpoint exposes raw user data — only aggregated counts and sums.
