# FoodTrust — Frontend Integration & Architecture Guide

This guide documents the integration between the static web frontend (`public/`) and the Next.js API backend (`app/api/`) implemented in **Phase 11**.

---

## 1. Overview & Architecture

The FoodTrust user interface consists of semantic HTML5, custom CSS (`public/CSS/style.css`), and modular JavaScript (`public/js/script.js` and `public/js/api-client.js`).

### Design Principles:
1. **Zero UI Redesign / Layout Preservation:** All existing layouts, colors, iconography (FontAwesome), maps (Leaflet), and charts (Chart.js) remain completely intact.
2. **Resilient Dual-Mode Operation:** 
   - When communicating with the live backend, views dynamically query and render authentic database records via `FoodTrustAPI`.
   - If an unauthenticated user explores the UI or backend services are unreachable, client-side fallback mechanisms preserve demonstration interactions without crashing or blocking navigation.
3. **Strict Server-Side Authority:**
   - The frontend never makes authoritative decisions on permissions, donation lifecycle states, claim reservations, or impact calculations.
   - All state transitions and role checks are validated by the server and enforced via Row-Level Security (RLS) and database constraints.
4. **Credential Isolation:**
   - Client scripts never store passwords, OTPs, or service-role keys in `localStorage`.
   - Authentication relies entirely on secure HTTP-only session cookies transmitted via `credentials: 'include'`.

---

## 2. Shared API Client (`public/js/api-client.js`)

A lightweight, dependency-free API client is exposed to the browser environment as `window.FoodTrustAPI`.

### Key Features:
- **Cookie-Based Session Transmission:** Automatically attaches `credentials: 'include'` to every request.
- **In-Flight Mutation Deduplication:** Prevents accidental double-submissions by tracking concurrent non-GET requests in an active request set.
- **Normalized Error Handling:** Throws an `ApiError` with HTTP status codes and detailed backend validation error objects.
- **Clean Service Modules:**
  - `FoodTrustAPI.auth`: `login()`, `register()`, `me()`, `logout()`
  - `FoodTrustAPI.donations`: `list()`, `getById()`, `create()`, `cancel()`, `evaluateFreshness()`
  - `FoodTrustAPI.claims`: `claim()`, `list()`, `matchNgos()`
  - `FoodTrustAPI.pickups`: `create()`, `getOtp()`, `verifyOtp()`, `completeDelivery()`
  - `FoodTrustAPI.analytics`: `overview()`, `donor()`, `ngo()`, `admin()`
  - `FoodTrustAPI.notifications`: `list()`, `markRead()`
  - `FoodTrustAPI.admin`: `listUsers()`, `updateUser()`, `listLogs()`, `getConfig()`, `updateConfig()`

---

## 3. Connected Views & Behavioral Contracts

### A. Authentication Portal (`public/login.html`)
- **Connected Handlers:** `POST /api/auth/login` and `POST /api/auth/register`
- **Behavior:**
  - Authenticates existing credentials and redirects to the designated role portal (`donor-dashboard.html`, `nearby-donations.html`, or `admin-dashboard.html`).
  - Automatically handles user registration when non-admin credentials are submitted for the first time.
  - Buttons display real-time loading feedback ("Authenticating...", "Registering new account...").

### B. Donor Dashboard (`public/donor-dashboard.html`)
- **Connected Handlers:**
  - `POST /api/donations`: Submits real surplus food records with automated freshness scoring and geocoding.
  - `GET /api/donations`: Populates the Donation History table with live database records.
- **Behavior:**
  - Form submission posts directly to the backend.
  - If the user is unauthenticated, prompts the user to log in and falls back gracefully to interactive demonstration mode.
  - Category breakdown chart dynamically reflects active donation quantities.

### C. Nearby Food Map & NGO Portal (`public/nearby-donations.html`)
- **Connected Handlers:**
  - `GET /api/donations?status=AVAILABLE`: Fetches all live available food donations in the public distribution pool.
  - `POST /api/donations/[id]/claim`: Verified NGOs can claim donations directly from map popups or listing cards.
- **Behavior:**
  - Map markers and donation cards reflect real database status and coordinates.
  - One-click claiming invokes OCC-guarded claim reservation.
  - If unauthenticated or non-NGO, notifies the user and redirects to the authentication portal.

### D. Admin Dashboard (`public/admin-dashboard.html`)
- **Connected Handlers:**
  - `GET /api/analytics/overview`: Populates KPI cards with live totals (Donations, Claimed, Registered NGOs, Active Donors).
  - `GET /api/admin/users`: Renders the user management table with real user records from `public.users`.
  - `PATCH /api/admin/users/[id]`: Interactive buttons trigger account status toggles (`ACTIVE` <-> `SUSPENDED`).
- **Behavior:**
  - Enforces administrative permissions.
  - Blocks self-suspension attempts with an alert.

### E. Navigation Bar & Session State (All Pages)
- **Connected Handler:** `GET /api/auth/me` and `POST /api/auth/logout`
- **Behavior:**
  - If an active session is detected, replaces the static "Login" link with "Logout (ROLE)".
  - Clicking logout terminates the session on the server and redirects to the home page.

---

## 4. Unsupported & Demonstration-Only Boundaries

To ensure security and architectural integrity, the following operations remain bounded:
1. **Physical IoT Device Ingestion:**
   - IoT endpoints (`/api/iot/telemetry`, `/api/iot/heartbeat`) require salted SHA-256 device credentials (`x-device-key`) and must never be invoked by browser scripts.
2. **Volunteer GPS Vehicle Routing:**
   - Turn-by-turn navigation is planned for mobile volunteer applications and is not simulated in the web dashboard.
3. **Direct File Upload to Supabase Storage:**
   - Proof-of-delivery photos currently accept structured URLs; client-side file picker uploads to Supabase Storage buckets require signed upload tokens (Phase 12+).

---

## 5. Verification & Test Evidence

The integration was validated with the automated test suite `scratch/test-phase11-frontend.ts`:
- **File & Module Verification:** Verified `api-client.js` exports, script tag inclusions, and deduplication logic.
- **Server Authority & Anti-Spoofing:** Verified that client-side role tampering cannot bypass server-side RBAC guards (403 Forbidden).
- **End-to-End Screen Simulation:** Verified donation creation, claiming, user status modification, and overview metrics against live database entities.
- **Deduplication:** Confirmed concurrent identical mutations are safely throttled.

**Suite Result:** **36 / 36 PASSED**
