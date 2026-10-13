/**
 * lib/services/freshness.service.ts
 * FoodTrust — Phase 4: Freshness Assessment & Spoilage Kinetic Service
 *
 * Deterministic spoilage kinetic engine providing decision-support indicators.
 *
 * MATHEMATICAL MODEL (ARCHITECTURE.md Section 7):
 *   Freshness Score S = S0 * exp(-k(T) * delta_t) * (1 - (G - G0) / G_max)
 *
 * PARAMETERS & CONSTANTS (FoodTrust Prototype Heuristic Parameters):
 * - S0: Initial freshness score = 100
 * - delta_t: Hours elapsed since food preparation (delta_t = (t_eval - t_prep) in hours)
 * - k(T): Temperature-dependent Arrhenius thermal abuse decay coefficient:
 *     T <= 4°C (Refrigerated)           -> k = 0.02
 *     4°C < T <= 25°C (Ambient Room)   -> k = 0.08
 *     T > 25°C (Warm / Thermal Abuse)   -> k = 0.18 + 0.01 * (T - 25)
 * - G: Measured VOC / gas reading (ppm from MQ-135 / BME680)
 * - G0: Clean air baseline gas concentration = 50.0 ppm
 * - G_max: Critical spoilage gas threshold = 500.0 ppm
 *
 * VOC GAS PENALTY FACTOR:
 *   If G <= G0: factor = 1.0 (no gas penalty)
 *   If G >= G0 + G_max: factor = 0.0 (penalty caps at 100% degradation)
 *   Else: factor = 1.0 - (G - G0) / G_max
 *
 * FRESHNESS STATUS THRESHOLDS (IMPLEMENTATION_DECISIONS.md & ARCHITECTURE_REVIEW.md):
 * - Score >= 75        -> FRESH
 * - 50 <= Score <= 74  -> MODERATE
 * - 25 <= Score <= 49  -> CRITICAL
 * - Score < 25         -> EXPIRED
 *
 * RISK LEVEL MAPPING (Deterministic Decision-Support Heuristic):
 * - FRESH (>= 75)       -> LOW
 * - MODERATE (50–74)    -> MODERATE
 * - CRITICAL (25–49)    -> HIGH
 * - EXPIRED (< 25)      -> CRITICAL
 * - Escalation Rule: If current ambient temperature T > 35°C (severe thermal abuse)
 *   or VOC G >= 350 ppm, the risk level escalates by one severity tier.
 *
 * SHELF LIFE HOURS REMAINING:
 *   Hours of remaining decision-support window before the score decays below 50 (or 25),
 *   calculated by solving the decay equation forward at current temperature and gas baseline:
 *     delta_t_critical = ln(S_current / S_threshold) / k(T)
 *
 * STATUTORY DECISION-SUPPORT NOTICE:
 * All outputs from this service are decision-support estimates from the FoodTrust
 * prototype kinetic model and are NOT certified food safety or microbiological determinations.
 */

import type {
  FoodCategory,
  FreshnessStatus,
  RiskLevel,
} from '@/types/database.types';

export const FRESHNESS_CONSTANTS = {
  S0: 100,
  G0: 50.0, // baseline clean air VOC (ppm)
  G_MAX: 500.0, // critical spoilage gas delta (ppm)
  K_REFRIGERATED: 0.02,
  K_AMBIENT: 0.08,
  K_WARM_BASE: 0.18,
  K_WARM_SLOPE: 0.01,
  WARM_THRESHOLD_C: 25.0,
  COLD_THRESHOLD_C: 4.0,
  SCORE_FRESH_MIN: 75,
  SCORE_MODERATE_MIN: 50,
  SCORE_CRITICAL_MIN: 25,
  SCORE_DISCARD_THRESHOLD: 50, // threshold representing end of safe standard distribution window
  COMPLIANCE_DISCLAIMER:
    'Decision-support indicator based on ambient telemetry; not a certified substitute for food safety testing.',
} as const;

export interface FreshnessCalculationInput {
  foodCategory: FoodCategory;
  preparationTimestamp: string | Date;
  evaluationTimestamp?: string | Date;
  temperatureC: number;
  humidityPct?: number | null;
  vocGasPpm?: number | null;
}

export interface FreshnessEvaluationResult {
  freshnessScore: number; // 0 to 100
  freshnessStatus: FreshnessStatus; // 'FRESH' | 'MODERATE' | 'CRITICAL' | 'EXPIRED'
  riskLevel: RiskLevel; // 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL'
  estimatedShelfLifeHours: number; // >= 0, rounded to 1 decimal place
  elapsedHours: number;
  decayRateK: number;
  gasPenaltyFactor: number;
  temperatureC: number;
  humidityPct: number | null;
  vocGasPpm: number | null;
  disclaimer: string;
}

/**
 * Calculates the temperature-dependent decay coefficient k(T).
 * Formula:
 *   T <= 4°C: 0.02
 *   4°C < T <= 25°C: 0.08
 *   T > 25°C: 0.18 + 0.01 * (T - 25)
 */
export function calculateTemperatureCoefficient(temperatureC: number): number {
  if (temperatureC <= FRESHNESS_CONSTANTS.COLD_THRESHOLD_C) {
    return FRESHNESS_CONSTANTS.K_REFRIGERATED;
  }
  if (temperatureC <= FRESHNESS_CONSTANTS.WARM_THRESHOLD_C) {
    return FRESHNESS_CONSTANTS.K_AMBIENT;
  }
  return (
    FRESHNESS_CONSTANTS.K_WARM_BASE +
    FRESHNESS_CONSTANTS.K_WARM_SLOPE * (temperatureC - FRESHNESS_CONSTANTS.WARM_THRESHOLD_C)
  );
}

/**
 * Calculates the VOC gas penalty factor: (1 - (G - G0) / G_max)
 * Clamped between 0.0 (maximum degradation) and 1.0 (no degradation).
 */
export function calculateGasPenaltyFactor(vocGasPpm?: number | null): number {
  if (vocGasPpm == null || isNaN(vocGasPpm) || vocGasPpm <= FRESHNESS_CONSTANTS.G0) {
    return 1.0;
  }
  const gasDelta = vocGasPpm - FRESHNESS_CONSTANTS.G0;
  const rawFactor = 1.0 - gasDelta / FRESHNESS_CONSTANTS.G_MAX;
  return Math.max(0.0, Math.min(1.0, rawFactor));
}

/**
 * Maps integer freshness score to the database enum freshness_status_enum:
 * >= 75        -> FRESH
 * 50 to 74     -> MODERATE
 * 25 to 49     -> CRITICAL
 * < 25         -> EXPIRED
 */
export function determineFreshnessStatus(score: number): FreshnessStatus {
  if (score >= FRESHNESS_CONSTANTS.SCORE_FRESH_MIN) return 'FRESH';
  if (score >= FRESHNESS_CONSTANTS.SCORE_MODERATE_MIN) return 'MODERATE';
  if (score >= FRESHNESS_CONSTANTS.SCORE_CRITICAL_MIN) return 'CRITICAL';
  return 'EXPIRED';
}

/**
 * Maps freshness score and environmental conditions to the database enum risk_level_enum:
 * Score >= 75        -> LOW
 * Score 50 to 74     -> MODERATE
 * Score 25 to 49     -> HIGH
 * Score < 25         -> CRITICAL
 *
 * Environmental escalation: High heat abuse (> 35°C) or high VOC (>= 350 ppm)
 * escalates risk level by one tier to warn against accelerated spoilage.
 */
export function determineRiskLevel(
  score: number,
  temperatureC: number,
  vocGasPpm?: number | null
): RiskLevel {
  let baseLevel: RiskLevel;
  if (score >= FRESHNESS_CONSTANTS.SCORE_FRESH_MIN) {
    baseLevel = 'LOW';
  } else if (score >= FRESHNESS_CONSTANTS.SCORE_MODERATE_MIN) {
    baseLevel = 'MODERATE';
  } else if (score >= FRESHNESS_CONSTANTS.SCORE_CRITICAL_MIN) {
    baseLevel = 'HIGH';
  } else {
    baseLevel = 'CRITICAL';
  }

  // Environmental stress escalation
  const isSevereThermalAbuse = temperatureC >= 35.0;
  const isHighGasSpike = vocGasPpm != null && vocGasPpm >= 350.0;

  if (isSevereThermalAbuse || isHighGasSpike) {
    if (baseLevel === 'LOW') return 'MODERATE';
    if (baseLevel === 'MODERATE') return 'HIGH';
    return 'CRITICAL';
  }

  return baseLevel;
}

/**
 * Estimates remaining decision-support shelf-life hours before food degrades
 * below the viable redistribution score threshold (Score = 50).
 *
 * Forward projection formula:
 *   S(t_future) = S_current * exp(-k(T) * delta_t_remaining)
 *   delta_t_remaining = ln(S_current / S_threshold) / k(T)
 */
export function estimateRemainingShelfLifeHours(
  currentScore: number,
  k: number,
  thresholdScore = FRESHNESS_CONSTANTS.SCORE_DISCARD_THRESHOLD
): number {
  if (currentScore <= thresholdScore) {
    // If already below threshold 50, estimate time to complete expiration (Score = 25)
    if (currentScore <= FRESHNESS_CONSTANTS.SCORE_CRITICAL_MIN) {
      return 0.0;
    }
    const deltaTToExpiry = Math.log(currentScore / FRESHNESS_CONSTANTS.SCORE_CRITICAL_MIN) / k;
    return Math.max(0.0, Math.round(deltaTToExpiry * 10) / 10);
  }

  const deltaHours = Math.log(currentScore / thresholdScore) / k;
  return Math.max(0.0, Math.round(deltaHours * 10) / 10);
}

/**
 * Pure evaluation function for the FoodTrust kinetic freshness model.
 * Deterministic: given identical inputs, produces identical outputs.
 */
export function evaluateFreshness(
  input: FreshnessCalculationInput
): FreshnessEvaluationResult {
  const prepTime = new Date(input.preparationTimestamp).getTime();
  const evalTime = input.evaluationTimestamp
    ? new Date(input.evaluationTimestamp).getTime()
    : Date.now();

  if (isNaN(prepTime)) {
    throw new Error('Invalid preparationTimestamp format.');
  }
  if (isNaN(evalTime)) {
    throw new Error('Invalid evaluationTimestamp format.');
  }
  if (prepTime > evalTime) {
    throw new Error(
      'Preparation timestamp cannot be in the future relative to evaluation time.'
    );
  }

  // Elapsed hours delta_t
  const elapsedMs = Math.max(0, evalTime - prepTime);
  const elapsedHours = elapsedMs / (1000 * 60 * 60);

  // Temperature decay coefficient k(T)
  const k = calculateTemperatureCoefficient(input.temperatureC);

  // VOC gas penalty factor
  const gasPenaltyFactor = calculateGasPenaltyFactor(input.vocGasPpm);

  // Kinetic Spoilage Formula: S = S0 * exp(-k * delta_t) * (1 - (G - G0) / G_max)
  const thermalDecayFactor = Math.exp(-k * elapsedHours);
  const rawScore = FRESHNESS_CONSTANTS.S0 * thermalDecayFactor * gasPenaltyFactor;

  // Final score clamped to integer 0..100
  const freshnessScore = Math.max(0, Math.min(100, Math.round(rawScore)));

  // Status & Risk mapping
  const freshnessStatus = determineFreshnessStatus(freshnessScore);
  const riskLevel = determineRiskLevel(freshnessScore, input.temperatureC, input.vocGasPpm);

  // Shelf-life estimation
  const estimatedShelfLifeHours = estimateRemainingShelfLifeHours(freshnessScore, k);

  return {
    freshnessScore,
    freshnessStatus,
    riskLevel,
    estimatedShelfLifeHours,
    elapsedHours: Math.round(elapsedHours * 100) / 100,
    decayRateK: Math.round(k * 10000) / 10000,
    gasPenaltyFactor: Math.round(gasPenaltyFactor * 1000) / 1000,
    temperatureC: input.temperatureC,
    humidityPct: input.humidityPct ?? null,
    vocGasPpm: input.vocGasPpm ?? null,
    disclaimer: FRESHNESS_CONSTANTS.COMPLIANCE_DISCLAIMER,
  };
}
