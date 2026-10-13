/**
 * scripts/iot-simulator.ts
 * FoodTrust — Phase 12: ESP32 Hardware Integration & Local IoT Simulator
 *
 * Simulates physical smart bin telemetry and heartbeat ingestion over HTTP/HTTPS.
 * Generates calibrated sensor data across normal, warm, critical, and failure modes.
 *
 * Usage:
 *   npx tsx scripts/iot-simulator.ts [options]
 *   npm run iot:simulate -- --mode=warm --once
 *
 * Options:
 *   --mode=<normal|warm|critical|sensor-failure>  Telemetry profile (default: normal)
 *   --url=<baseUrl>                               API host URL (default: http://localhost:3000)
 *   --bin=<binCode>                               Smart bin identifier (default: BIN-DELHI-001)
 *   --token=<deviceToken>                         Pre-shared raw device token (default: dt_sec_9f8e7d6c5b4a3120)
 *   --interval=<seconds>                          Periodic loop interval in seconds (default: 10)
 *   --once                                        Send a single batch and exit
 *   --dry-run                                     Print payloads without sending network requests
 *   --no-heartbeat                                Skip transmitting heartbeat before telemetry
 */

import * as fs from 'fs';
import * as path from 'path';

// Load .env.local if available
try {
  const envContent = fs.readFileSync(path.resolve(process.cwd(), '.env.local'), 'utf8');
  envContent.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        const key = trimmed.substring(0, eqIdx).trim();
        let val = trimmed.substring(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.substring(1, val.length - 1);
        }
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  });
} catch {
  // Ignore missing .env.local in production / test environments
}

interface SimulatorConfig {
  mode: 'normal' | 'warm' | 'critical' | 'sensor-failure';
  baseUrl: string;
  binCode: string;
  deviceToken: string;
  intervalSec: number;
  once: boolean;
  dryRun: boolean;
  sendHeartbeat: boolean;
}

function parseCliArgs(): SimulatorConfig {
  const args = process.argv.slice(2);
  const config: SimulatorConfig = {
    mode: 'normal',
    baseUrl: process.env.BASE_URL || 'http://localhost:3000',
    binCode: 'BIN-DELHI-001',
    deviceToken: 'dt_sec_9f8e7d6c5b4a3120',
    intervalSec: 10,
    once: false,
    dryRun: false,
    sendHeartbeat: true,
  };

  for (const arg of args) {
    if (arg.startsWith('--mode=')) {
      const modeVal = arg.substring(7).toLowerCase();
      if (['normal', 'warm', 'critical', 'sensor-failure'].includes(modeVal)) {
        config.mode = modeVal as SimulatorConfig['mode'];
      } else {
        console.warn(`[WARN] Unknown mode "${modeVal}". Defaulting to "normal".`);
      }
    } else if (arg.startsWith('--url=')) {
      config.baseUrl = arg.substring(6).replace(/\/+$/, '');
    } else if (arg.startsWith('--bin=')) {
      config.binCode = arg.substring(6);
    } else if (arg.startsWith('--token=')) {
      config.deviceToken = arg.substring(8);
    } else if (arg.startsWith('--interval=')) {
      const parsed = parseInt(arg.substring(11), 10);
      if (!isNaN(parsed) && parsed > 0) config.intervalSec = parsed;
    } else if (arg === '--once') {
      config.once = true;
    } else if (arg === '--dry-run') {
      config.dryRun = true;
    } else if (arg === '--no-heartbeat') {
      config.sendHeartbeat = false;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
FoodTrust IoT Hardware Simulator
Options:
  --mode=<normal|warm|critical|sensor-failure>  Simulation condition
  --url=<baseUrl>                               API host URL (default: http://localhost:3000)
  --bin=<binCode>                               Bin identifier (default: BIN-DELHI-001)
  --token=<token>                               Device token (default: dt_sec_9f8e7d6c5b4a3120)
  --interval=<sec>                              Loop interval in seconds (default: 10)
  --once                                        Transmit single batch and exit
  --dry-run                                     Output payload without sending
  --no-heartbeat                                Skip heartbeat ping
      `);
      process.exit(0);
    }
  }

  return config;
}

function getRandomInRange(min: number, max: number, decimals = 1): number {
  const rand = Math.random() * (max - min) + min;
  const factor = Math.pow(10, decimals);
  return Math.round(rand * factor) / factor;
}

function generateTelemetryPayload(config: SimulatorConfig) {
  const timestamp = new Date().toISOString();

  if (config.mode === 'sensor-failure') {
    // Deliberately violating Zod validation constraints (temp > 65°C, humidity < 0%)
    return {
      binCode: config.binCode,
      timestamp,
      ambient: {
        temperatureC: 85.5, // Out of physical envelope (max 65)
        humidityPct: -5.0,  // Invalid humidity (min 0)
        vocGasPpm: 6200.0,  // Exceeds max range (max 5000)
      },
      system: {
        lidOpen: false,
        batteryPct: 95,
        firmwareVersion: '1.0.4',
      },
      trays: [
        {
          trayNumber: 1,
          category: 'COOKED_MEALS',
          rawWeightKg: 10.0,
          tareWeightKg: 2.5,
          netWeightKg: 15.0, // Impossible: net > raw (triggers physics check)
        },
      ],
    };
  }

  if (config.mode === 'critical') {
    // Thermal breach: warm environment, elevated VOC, lid open
    const temp = getRandomInRange(30.0, 34.5, 1);
    const hum = getRandomInRange(80.0, 88.0, 1);
    const voc = getRandomInRange(380.0, 480.0, 1);
    return {
      binCode: config.binCode,
      timestamp,
      ambient: {
        temperatureC: temp,
        humidityPct: hum,
        vocGasPpm: voc,
      },
      system: {
        lidOpen: true,
        batteryPct: 88,
        firmwareVersion: '1.0.4',
      },
      trays: [
        {
          trayNumber: 1,
          category: 'COOKED_MEALS',
          rawWeightKg: 13.2,
          tareWeightKg: 2.5,
          netWeightKg: 10.7,
        },
        {
          trayNumber: 2,
          category: 'VEGETABLES',
          rawWeightKg: 7.5,
          tareWeightKg: 2.5,
          netWeightKg: 5.0,
        },
      ],
    };
  }

  if (config.mode === 'warm') {
    // Moderate temperature elevation
    const temp = getRandomInRange(14.0, 17.5, 1);
    const hum = getRandomInRange(68.0, 74.0, 1);
    const voc = getRandomInRange(95.0, 130.0, 1);
    return {
      binCode: config.binCode,
      timestamp,
      ambient: {
        temperatureC: temp,
        humidityPct: hum,
        vocGasPpm: voc,
      },
      system: {
        lidOpen: false,
        batteryPct: 92,
        firmwareVersion: '1.0.4',
      },
      trays: [
        {
          trayNumber: 1,
          category: 'COOKED_MEALS',
          rawWeightKg: 13.0,
          tareWeightKg: 2.5,
          netWeightKg: 10.5,
        },
        {
          trayNumber: 2,
          category: 'VEGETABLES',
          rawWeightKg: 8.7,
          tareWeightKg: 2.5,
          netWeightKg: 6.2,
        },
      ],
    };
  }

  // Normal mode: Optimal cold-chain refrigeration
  const temp = getRandomInRange(3.5, 4.5, 1);
  const hum = getRandomInRange(58.0, 64.0, 1);
  const voc = getRandomInRange(25.0, 42.0, 1);
  return {
    binCode: config.binCode,
    timestamp,
    ambient: {
      temperatureC: temp,
      humidityPct: hum,
      vocGasPpm: voc,
    },
    system: {
      lidOpen: false,
      batteryPct: 98,
      firmwareVersion: '1.0.4',
    },
    trays: [
      {
        trayNumber: 1,
        category: 'COOKED_MEALS',
        rawWeightKg: 13.5,
        tareWeightKg: 2.5,
        netWeightKg: 11.0,
      },
      {
        trayNumber: 2,
        category: 'VEGETABLES',
        rawWeightKg: 9.0,
        tareWeightKg: 2.5,
        netWeightKg: 6.5,
      },
    ],
  };
}

async function sendRequest(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  dryRun: boolean
): Promise<{ status: number; data: unknown }> {
  if (dryRun) {
    console.log(`[DRY-RUN] Request to ${url}`);
    console.log(`[DRY-RUN] Headers:`, {
      ...headers,
      'x-device-token': '[REDACTED]',
    });
    console.log(`[DRY-RUN] Body:`, JSON.stringify(body, null, 2));
    return { status: 200, data: { simulated: true } };
  }

  const startTime = Date.now();
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });

  const durationMs = Date.now() - startTime;
  const json = await response.json().catch(() => ({}));

  return { status: response.status, data: { ...json, _durationMs: durationMs } };
}

async function runSimulatorCycle(config: SimulatorConfig, cycleNumber: number) {
  const headers = {
    'x-bin-id': config.binCode,
    'x-device-token': config.deviceToken,
  };

  console.log(`\n============================================================`);
  console.log(`[SIMULATOR] Cycle #${cycleNumber} | Mode: ${config.mode.toUpperCase()} | Time: ${new Date().toLocaleTimeString()}`);
  console.log(`============================================================`);

  // 1. Heartbeat ping
  if (config.sendHeartbeat) {
    const heartbeatPayload = {
      timestamp: new Date().toISOString(),
      firmwareVersion: '1.0.4',
      batteryPct: 95,
    };

    const hbUrl = `${config.baseUrl}/api/iot/heartbeat`;
    const hbRes = await sendRequest(hbUrl, headers, heartbeatPayload, config.dryRun);

    if (hbRes.status === 200) {
      console.log(`[HEARTBEAT] OK (200) -> Bin Status: ONLINE`);
    } else {
      console.warn(`[HEARTBEAT] Status ${hbRes.status}:`, hbRes.data);
    }
  }

  // 2. Telemetry ingestion
  const telemetryPayload = generateTelemetryPayload(config);
  const telemUrl = `${config.baseUrl}/api/iot/telemetry`;

  console.log(
    `[SENSORS] Temp: ${telemetryPayload.ambient.temperatureC}°C | ` +
    `Humidity: ${telemetryPayload.ambient.humidityPct}% | ` +
    `VOC: ${telemetryPayload.ambient.vocGasPpm} ppm | ` +
    `Lid: ${telemetryPayload.system.lidOpen ? 'OPEN' : 'CLOSED'}`
  );

  const telemRes = await sendRequest(telemUrl, headers, telemetryPayload, config.dryRun);

  if (telemRes.status === 200 || telemRes.status === 201) {
    const resData = telemRes.data as Record<string, unknown>;
    console.log(`[INGESTION] Success (${telemRes.status}) in ${(resData._durationMs ?? 0)}ms`);
    if (resData.data && typeof resData.data === 'object') {
      const d = resData.data as Record<string, unknown>;
      if (d.freshnessEvaluations) {
        console.log(`[FRESHNESS EVALUATION]:`, JSON.stringify(d.freshnessEvaluations, null, 2));
      }
    }
  } else if (telemRes.status === 400) {
    console.log(`[EXPECTED ERROR] Validation Rejection (400):`, telemRes.data);
  } else if (telemRes.status === 401) {
    console.error(`[AUTH FAILURE] (401) Invalid x-bin-id or x-device-token credentials.`);
  } else if (telemRes.status === 429) {
    console.warn(`[RATE LIMITED] (429) Bin exceeded 60 requests per minute.`);
  } else {
    console.error(`[ERROR] (${telemRes.status}):`, telemRes.data);
  }
}

async function main() {
  const config = parseCliArgs();

  console.log(`
+-----------------------------------------------------------+
| FoodTrust IoT Smart Bin Hardware Simulator                |
| Target URL: ${config.baseUrl.padEnd(45)} |
| Bin Code:   ${config.binCode.padEnd(45)} |
| Mode:       ${config.mode.padEnd(45)} |
| Interval:   ${(config.intervalSec + ' seconds').padEnd(45)} |
+-----------------------------------------------------------+
`);

  let cycle = 1;

  if (config.once) {
    await runSimulatorCycle(config, cycle);
    process.exit(0);
  }

  // Run first cycle immediately
  await runSimulatorCycle(config, cycle++);

  // Interval loop
  const timer = setInterval(async () => {
    try {
      await runSimulatorCycle(config, cycle++);
    } catch (err) {
      console.error('[SIMULATOR] Error during cycle execution:', err);
    }
  }, config.intervalSec * 1000);

  // Graceful shutdown
  process.on('SIGINT', () => {
    clearInterval(timer);
    console.log('\n[SIMULATOR] Simulation stopped cleanly by user.');
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('[FATAL] Simulator encountered uncaught error:', err);
  process.exit(1);
});
