# 🧪 FoodTrust Freshness Assessment & Spoilage Kinetic Model

**Document Version:** 1.0.0  
**Phase:** Phase 4 — Freshness Assessment & Spoilage Kinetic Service  
**Status:** Approved Prototype Specification  
**Standard Compliance:** Decision-Support Protocol (Non-certified model)

---

## 1. Decision-Support Demarcation

> [!IMPORTANT]
> **Mandatory Regulatory & Engineering Notice:**  
> The FoodTrust freshness score, status, risk tier, and remaining shelf life estimations are **decision-support heuristics** based on ambient temperature decay and volatile organic compound (VOC) sensor readings.  
> They are **NOT** microbiological laboratory tests, do **NOT** certify food safety, and must **NEVER** be represented as a medical or regulatory guarantee that food is safe for consumption.

All API responses returning this model include the standard compliance disclaimer:
```json
"disclaimer": "Decision-support indicator based on ambient telemetry; not a certified substitute for food safety testing."
```

---

## 2. Mathematical Spoilage Model

The engine implements a multi-variable Arrhenius thermal decay and gas sensor spoilage model:

$$S = S_0 \times e^{-k(T) \cdot \Delta t} \times \left(1 - \frac{G - G_0}{G_{\max}}\right)$$

### Parameter Definitions

| Symbol | Parameter | Prototype Value | Unit | Description |
|--------|-----------|-----------------|------|-------------|
| $S_0$ | Initial Freshness Score | `100` | Points | Freshness baseline at the moment of food preparation. |
| $\Delta t$ | Elapsed Time | Calculated | Hours | Hours elapsed between `preparation_timestamp` and `evaluation_timestamp`. |
| $k(T)$ | Arrhenius Thermal Decay Coefficient | Calculated | $\text{hr}^{-1}$ | Temperature-dependent decay rate. |
| $G$ | Measured VOC Spoilage Gas | Sensor reading | ppm | Airborne volatile metabolites detected by MQ-135 / BME680. |
| $G_0$ | Clean Air Baseline Gas | `50.0` | ppm | Baseline ambient concentration in clean air. |
| $G_{\max}$ | Critical Gas Threshold | `500.0` | ppm | Upper delta at which gas penalty reaches 100% degradation. |

---

## 3. Temperature Regimes & Coefficients $k(T)$

Food spoilage kinetics accelerate non-linearly with temperature abuse. The FoodTrust model specifies three operational regimes:

$$\begin{cases} 
k(T) = 0.02 & \text{if } T \le 4^\circ\text{C} \quad \text{(Refrigerated Storage)} \\
k(T) = 0.08 & \text{if } 4^\circ\text{C} < T \le 25^\circ\text{C} \quad \text{(Room Ambient Storage)} \\
k(T) = 0.18 + 0.01 \times (T - 25) & \text{if } T > 25^\circ\text{C} \quad \text{(Warm / Thermal Abuse)}
\end{cases}$$

---

## 4. VOC Gas Penalty Factor

The gas penalty factor models bacterial metabolic emissions (ammonia, hydrogen sulfide, alcohol, organic acids):

$$\text{GasPenaltyFactor} = \max\left(0.0, \min\left(1.0, 1.0 - \frac{G - G_0}{G_{\max}}\right)\right)$$

- When $G \le 50\text{ ppm}$: Factor is `1.0` (zero degradation penalty).
- When $G = 300\text{ ppm}$: Factor is `0.5` (50% reduction due to bacterial metabolic byproducts).
- When $G \ge 550\text{ ppm}$: Factor is `0.0` (score drops to 0).

---

## 5. Freshness Status & Urgency Classification

The calculated integer score $S \in [0, 100]$ maps to the database enum `freshness_status_enum`:

| Score Range | Status (`freshness_status_enum`) | Operational Meaning | Suggested Handling |
|-------------|----------------------------------|---------------------|---------------------|
| $\mathbf{75 - 100}$ | `FRESH` | Optimal quality window | Standard donation allocation and redistribution |
| $\mathbf{50 - 74}$ | `MODERATE` | Moderate aging | Priority matching with nearby NGOs |
| $\mathbf{25 - 49}$ | `CRITICAL` | Imminent end-of-life window | Urgent immediate dispatch for same-day distribution |
| $\mathbf{< 25}$ | `EXPIRED` | Viable window elapsed | Withdrawn from donation redistribution pool |

---

## 6. Risk Level & Environmental Escalation

Base risk mapping from score:
- Score $\ge 75 \implies$ `LOW`
- Score $50 - 74 \implies$ `MODERATE`
- Score $25 - 49 \implies$ `HIGH`
- Score $< 25 \implies$ `CRITICAL`

### Environmental Escalation Rule
If the chamber environment exhibits severe heat stress ($T \ge 35^\circ\text{C}$) or an acute VOC spike ($G \ge 350\text{ ppm}$), the risk level escalates by one severity tier (`LOW` $\to$ `MODERATE`, `MODERATE` $\to$ `HIGH`, `HIGH` $\to$ `CRITICAL`).

---

## 7. Remaining Shelf-Life Estimation

The service projects the remaining time before food drops below the redistribution threshold ($S = 50$):

$$\Delta t_{\text{remaining}} = \frac{\ln(S_{\text{current}} / 50)}{k(T)}$$

If the current score is already below 50, it projects remaining time until complete expiration ($S = 25$):

$$\Delta t_{\text{remaining}} = \frac{\ln(S_{\text{current}} / 25)}{k(T)}$$

If $S < 25$, the remaining shelf life is reported as `0.0` hours.

---

## 8. Humidity & Food Category Handling

- **Humidity ($H$):** Tracked and recorded in `public.freshness_logs.humidity_pct` for future algorithmic refinement. Not currently an active multiplier in the base Arrhenius formula to avoid compounding noisy sensor drift.
- **Food Category:** Passed in all evaluation payloads (`food_category_enum`). Provides the foundation for category-specific decay constants in future model iterations.
