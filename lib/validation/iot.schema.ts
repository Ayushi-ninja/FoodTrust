/**
 * lib/validation/iot.schema.ts
 * FoodTrust — Phase 3: IoT Device Authentication & Telemetry
 *
 * Strict Zod validation schemas for IoT hardware endpoints:
 * - Telemetry batch payload (/api/iot/telemetry)
 * - Device heartbeat payload (/api/iot/heartbeat)
 * - Tray tare calibration payload (/api/iot/trays/[id]/tare)
 *
 * PHYSICAL BOUNDS & RATIONALES:
 * - Temperature: -10°C to 65°C (Food chamber physical operating envelope; values outside
 *   this indicate DHT22 sensor probe malfunction or wiring detachment).
 * - Humidity: 0% to 100% (Standard relative humidity range).
 * - VOC Gas: 0 to 5000 ppm (MQ-135 / BME680 detectable airborne VOC / ammonia equivalent range).
 * - Battery: 0% to 100% (Electronics Unit LiFePO4 / Li-ion backup battery capacity).
 * - Tray weight: non-negative, raw >= net, tare + net ~ raw (logical consistency).
 * - Tray number: positive integer >= 1.
 */

import { z } from 'zod';

export const foodCategoryEnum = z.enum([
  'COOKED_MEALS',
  'VEGETABLES',
  'FRUITS',
  'BAKERY',
  'DAIRY',
]);

/**
 * Individual Food Tray reading within the Food Handling Unit.
 */
export const trayTelemetryItemSchema = z
  .object({
    trayNumber: z
      .number()
      .int({ message: 'trayNumber must be an integer' })
      .min(1, { message: 'trayNumber must be at least 1' })
      .max(10, { message: 'trayNumber cannot exceed 10' }),
    category: foodCategoryEnum,
    rawWeightKg: z
      .number({ invalid_type_error: 'rawWeightKg must be numeric' })
      .min(0, { message: 'rawWeightKg cannot be negative' })
      .max(150, { message: 'rawWeightKg exceeds maximum load cell rated limit (150 kg)' }),
    tareWeightKg: z
      .number({ invalid_type_error: 'tareWeightKg must be numeric' })
      .min(0, { message: 'tareWeightKg cannot be negative' })
      .max(50, { message: 'tareWeightKg exceeds realistic tray tare threshold (50 kg)' }),
    netWeightKg: z
      .number({ invalid_type_error: 'netWeightKg must be numeric' })
      .min(0, { message: 'netWeightKg cannot be negative' })
      .max(150, { message: 'netWeightKg exceeds maximum load cell capacity' }),
  })
  .refine(
    (data) => {
      // Net weight cannot be greater than raw weight (physics check with 0.15kg load cell tolerance)
      return data.netWeightKg <= data.rawWeightKg + 0.15;
    },
    {
      message: 'netWeightKg cannot be greater than rawWeightKg',
      path: ['netWeightKg'],
    }
  );

/**
 * Chamber ambient readings from sensors in the Food Handling Unit:
 * - DHT22: Temperature (°C) and Humidity (%)
 * - MQ-135 / BME680: Volatile Organic Compounds (VOC ppm)
 */
export const ambientTelemetrySchema = z.object({
  temperatureC: z
    .number({ invalid_type_error: 'temperatureC must be numeric' })
    .min(-10, { message: 'temperatureC is below physical sensor lower threshold (-10°C)' })
    .max(65, { message: 'temperatureC is above physical sensor upper threshold (65°C)' }),
  humidityPct: z
    .number({ invalid_type_error: 'humidityPct must be numeric' })
    .min(0, { message: 'humidityPct must be between 0 and 100' })
    .max(100, { message: 'humidityPct must be between 0 and 100' }),
  vocGasPpm: z
    .number({ invalid_type_error: 'vocGasPpm must be numeric' })
    .min(0, { message: 'vocGasPpm must be non-negative' })
    .max(5000, { message: 'vocGasPpm exceeds maximum readable range (5000 ppm)' }),
});

/**
 * System status from the Electronics Unit:
 * - Lid magnetic reed switch
 * - Battery percentage
 * - Microcontroller firmware version
 */
export const systemTelemetrySchema = z.object({
  lidOpen: z.boolean(),
  batteryPct: z
    .number()
    .int()
    .min(0, { message: 'batteryPct must be between 0 and 100' })
    .max(100, { message: 'batteryPct must be between 0 and 100' }),
  firmwareVersion: z
    .string()
    .min(1, { message: 'firmwareVersion is required' })
    .max(20, { message: 'firmwareVersion max 20 chars' }),
});

/**
 * Full Ingestion Payload for POST /api/iot/telemetry
 */
export const telemetryIngestSchema = z
  .object({
    binCode: z
      .string({ required_error: 'binCode is required' })
      .min(3, { message: 'binCode must be at least 3 characters' })
      .max(50, { message: 'binCode max 50 characters' }),
    timestamp: z
      .string({ required_error: 'timestamp is required' })
      .datetime({ message: 'timestamp must be a valid ISO 8601 string' }),
    ambient: ambientTelemetrySchema,
    system: systemTelemetrySchema,
    trays: z
      .array(trayTelemetryItemSchema)
      .min(0)
      .max(10, { message: 'Maximum 10 trays supported per bin' }),
  })
  .refine(
    (data) => {
      // Replay / Clock skew validation: Reject timestamps more than 5 minutes in future
      const parsedTime = new Date(data.timestamp).getTime();
      const maxFutureAllowed = Date.now() + 5 * 60 * 1000;
      return parsedTime <= maxFutureAllowed;
    },
    {
      message: 'Telemetry timestamp cannot be in the future (exceeds 5-minute clock skew threshold)',
      path: ['timestamp'],
    }
  );

/**
 * Minimal Payload for POST /api/iot/heartbeat
 */
export const heartbeatSchema = z
  .object({
    timestamp: z
      .string({ required_error: 'timestamp is required' })
      .datetime({ message: 'timestamp must be a valid ISO 8601 string' }),
    firmwareVersion: z
      .string()
      .min(1, { message: 'firmwareVersion is required' })
      .max(20, { message: 'firmwareVersion max 20 characters' })
      .optional(),
    batteryPct: z
      .number()
      .int()
      .min(0, { message: 'batteryPct must be between 0 and 100' })
      .max(100, { message: 'batteryPct must be between 0 and 100' })
      .optional(),
  })
  .refine(
    (data) => {
      const parsedTime = new Date(data.timestamp).getTime();
      const maxFutureAllowed = Date.now() + 5 * 60 * 1000;
      return parsedTime <= maxFutureAllowed;
    },
    {
      message: 'Heartbeat timestamp cannot be in the future (exceeds 5-minute clock skew threshold)',
      path: ['timestamp'],
    }
  );

/**
 * Payload for POST /api/iot/trays/[id]/tare
 */
export const trayTareSchema = z.object({
  tareWeightKg: z
    .number({ required_error: 'tareWeightKg is required', invalid_type_error: 'tareWeightKg must be numeric' })
    .min(0, { message: 'tareWeightKg must be non-negative' })
    .max(50, { message: 'tareWeightKg exceeds maximum reasonable empty tray weight (50 kg)' }),
});

export type TelemetryIngestInput = z.infer<typeof telemetryIngestSchema>;
export type HeartbeatInput = z.infer<typeof heartbeatSchema>;
export type TrayTareInput = z.infer<typeof trayTareSchema>;
export type TrayTelemetryItem = z.infer<typeof trayTelemetryItemSchema>;
