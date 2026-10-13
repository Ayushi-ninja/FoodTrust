/**
 * lib/validation/freshness.schema.ts
 * FoodTrust — Phase 4: Freshness Assessment & Spoilage Kinetic Service
 *
 * Strict Zod validation schemas for freshness evaluation endpoints.
 */

import { z } from 'zod';
import { foodCategoryEnum } from '@/lib/validation/iot.schema';

/**
 * Payload for POST /api/freshness/evaluate
 */
export const freshnessEvaluateSchema = z
  .object({
    donationId: z
      .string()
      .uuid({ message: 'donationId must be a valid UUID' })
      .optional(),
    foodCategory: foodCategoryEnum,
    preparationTimestamp: z
      .string({ required_error: 'preparationTimestamp is required' })
      .datetime({ message: 'preparationTimestamp must be a valid ISO 8601 string' }),
    evaluationTimestamp: z
      .string()
      .datetime({ message: 'evaluationTimestamp must be a valid ISO 8601 string' })
      .optional(),
    temperatureC: z
      .number({ required_error: 'temperatureC is required', invalid_type_error: 'temperatureC must be numeric' })
      .min(-15, { message: 'temperatureC is below sensor physical floor (-15°C)' })
      .max(70, { message: 'temperatureC is above sensor physical ceiling (70°C)' }),
    humidityPct: z
      .number({ invalid_type_error: 'humidityPct must be numeric' })
      .min(0, { message: 'humidityPct must be between 0 and 100' })
      .max(100, { message: 'humidityPct must be between 0 and 100' })
      .nullable()
      .optional(),
    vocGasPpm: z
      .number({ invalid_type_error: 'vocGasPpm must be numeric' })
      .min(0, { message: 'vocGasPpm cannot be negative' })
      .max(5000, { message: 'vocGasPpm exceeds readable range (5000 ppm)' })
      .nullable()
      .optional(),
    persistLog: z
      .boolean({ invalid_type_error: 'persistLog must be a boolean' })
      .optional()
      .default(true),
  })
  .refine(
    (data) => {
      const prep = new Date(data.preparationTimestamp).getTime();
      const evalTime = data.evaluationTimestamp
        ? new Date(data.evaluationTimestamp).getTime()
        : Date.now();
      // Preparation time cannot be in the future relative to evaluation time
      return prep <= evalTime + 60 * 1000; // 1-minute clock skew tolerance
    },
    {
      message: 'preparationTimestamp cannot be in the future relative to evaluation time',
      path: ['preparationTimestamp'],
    }
  );

export type FreshnessEvaluateInput = z.infer<typeof freshnessEvaluateSchema>;
