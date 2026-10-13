# 🎯 FoodTrust Smart NGO Matching Engine Model

**Document Version:** 1.0.0  
**Phase:** Phase 5 — Smart NGO Matching Engine  
**Status:** Approved Deterministic Recommendation Specification  
**Architecture Reference:** `ARCHITECTURE.md` Section 8, `IMPLEMENTATION_DECISIONS.md` Section 2.3

---

## 1. Matching Engine Objective & Boundaries

The Smart NGO Matching Engine matches available food donations with eligible, nearby non-governmental organizations (NGOs) to maximize redistribution efficiency and minimize waste.

> [!IMPORTANT]
> **Strict Read-Only Recommendation Contract:**  
> The matching service is strictly a recommendation engine. Calling matching endpoints produces **ZERO write side-effects**:
> - It does **NOT** claim or reserve the donation.
> - It does **NOT** create rows in `donation_claims` or `pickups`.
> - It does **NOT** alter the donation status (`AVAILABLE`).
> - It does **NOT** decrement NGO daily capacity.

---

## 2. Multi-Stage Pipeline Architecture

```
Food Donation (Available)
         ↓
1. Candidate Pool Filtering (verification_status = 'VERIFIED')
         ↓
2. PostGIS Geodesic Distance Calculation (WGS84 Ellipsoid)
         ↓
3. Operational Radius Boundary Check (distanceKm <= operational_radius_km)
         ↓
4. Daily Capacity Verification (quantity_kg <= daily_capacity_kg)
         ↓
5. Weighted Multi-Factor Ranking Score (0 to 100)
   - Proximity Score (Weight: 0.40)
   - Capacity Score (Weight: 0.25)
   - Storage Compatibility Score (Weight: 0.15)
   - Freshness Urgency Boost Score (Weight: 0.20)
         ↓
6. Deterministic Tie-Breaking & Truncation (limit)
         ↓
Ranked Recommendations JSON Envelope
```

---

## 3. Eligibility & Hard Boundary Filters

An NGO candidate must satisfy all three criteria to be included in the candidate pool:

1. **Verification Status:** Must have `verification_status = 'VERIFIED'`. Unverified (`PENDING`) or `REJECTED` NGOs are excluded.
2. **Operational Radius:** Distance between the donation pickup coordinates and the NGO headquarters must not exceed `operational_radius_km`.
3. **Daily Capacity:** The donation `quantity_kg` must not exceed the NGO's `daily_capacity_kg`.

---

## 4. Multi-Factor Scoring Formula

The matching engine computes a transparent, explainable match score ($0 - 100$):

$$\text{MatchScore} = (w_{\text{prox}} \cdot S_{\text{prox}}) + (w_{\text{cap}} \cdot S_{\text{cap}}) + (w_{\text{stor}} \cdot S_{\text{stor}}) + (w_{\text{urg}} \cdot S_{\text{urg}})$$

### Configured Weights

| Weight | Parameter | Value | Rationale |
|--------|-----------|-------|-----------|
| $w_{\text{prox}}$ | Proximity Weight | `0.40` | Geographic distance is the single most critical factor for rapid food salvage. |
| $w_{\text{cap}}$ | Capacity Weight | `0.25` | Optimal alignment with handling capacity avoids logjams or under-utilization. |
| $w_{\text{stor}}$ | Storage Compatibility | `0.15` | Prioritizes cold storage for perishable/longer-shelf-life goods. |
| $w_{\text{urg}}$ | Urgency Boost | `0.20` | Increases priority for critical and fast-expiring donations. |

### Factor Breakdown ($0 - 100$)

1. **Proximity Score ($S_{\text{prox}}$):**
   $$S_{\text{prox}} = \max\left(0, \min\left(100, \text{round}\left(\left(1 - \frac{\text{distanceKm}}{\text{operationalRadiusKm}}\right) \times 100\right)\right)\right)$$
2. **Capacity Fit Score ($S_{\text{cap}}$):**
   - Ratio $r = \frac{\text{quantity\_kg}}{\text{daily\_capacity\_kg}}$
   - $r \in [0.05, 0.90] \implies 100$ (Optimal utilization)
   - $r > 0.90 \implies 60$ (Near max capacity)
   - $r < 0.05 \implies 70$ (Under-utilized)
3. **Storage Compatibility Score ($S_{\text{stor}}$):**
   - NGO has cold storage (`has_cold_storage = true`) $\implies 100$.
   - Ambient item or short shelf-life $\implies 70$.
   - Highly perishable category (`DAIRY`, `COOKED_MEALS`) with $\text{shelf\_life} > 12\text{h}$ without cold storage $\implies 40$.
4. **Urgency Boost Score ($S_{\text{urg}}$):**
   - `CRITICAL` freshness status $\implies 100$.
   - `MODERATE` freshness status $\implies 75$.
   - `FRESH` status $\implies 50$.
   - `EXPIRED` status $\implies 10$.

---

## 5. Deterministic Tie-Breaking

To ensure stable recommendations across repeated calls:
1. Primary sort: Descending `matchScore`.
2. First tie-breaker: Ascending `distanceKm` (closer candidate wins).
3. Second tie-breaker: Ascending lexicographical comparison on `ngoId`.
