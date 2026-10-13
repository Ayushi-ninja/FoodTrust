/**
 * lib/config/constants.ts
 * FoodTrust — System-wide constants and conversion factors
 *
 * References:
 * - IMPLEMENTATION_DECISIONS.md Section 3.2 (Impact Estimation Protocol)
 * - ARCHITECTURE_REVIEW.md Issue 15.1
 */

export const IMPACT_CONFIG = {
  DEFAULT_KG_PER_MEAL: 0.4, // Standard FAO portion estimate (400g per meal)
  DEFAULT_CO2_OFFSET_PER_KG: 2.5, // UNEP Food Waste Index factor (2.5 kg CO2e per kg food saved)
  IS_ESTIMATE: true,
  METHODOLOGY_MEALS: 'UNEP/FAO standard portion estimate (0.40 kg per meal)',
  METHODOLOGY_CO2: 'UNEP Food Waste Index conversion factor (2.50 kg CO2e per kg food saved)',
} as const;

export const OTP_CONFIG = {
  LENGTH: 6,
  MAX_ATTEMPTS: 3,
  EXPIRY_MINUTES: 120, // 2-hour collection window from generation
} as const;
