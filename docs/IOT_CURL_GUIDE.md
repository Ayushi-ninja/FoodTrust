# 🧪 FoodTrust Phase 3 — cURL & API Simulation Guide

This guide provides tested, ready-to-run cURL commands for all Phase 3 IoT endpoints.

---

## Environment Variables Used in Commands

```bash
export BASE_URL="http://localhost:3000"
export BIN_ID="BIN-DELHI-001"
export DEVICE_TOKEN="dt_sec_9f8e7d6c5b4a3120"
export DONOR_COOKIE="sb-access-token=<PASTE_DONOR_JWT_COOKIE>"
export TRAY_ID="a0000004-0000-4000-8000-000000000004"
```

---

## 1. IoT Telemetry Ingestion (`POST /api/iot/telemetry`)

Transmits chamber sensor readings and individual tray weights.

```bash
curl -X POST "${BASE_URL}/api/iot/telemetry" \
  -H "Content-Type: application/json" \
  -H "x-bin-id: ${BIN_ID}" \
  -H "x-device-token: ${DEVICE_TOKEN}" \
  -d '{
    "binCode": "BIN-DELHI-001",
    "timestamp": "2026-10-03T18:30:00.000Z",
    "ambient": {
      "temperatureC": 23.5,
      "humidityPct": 56.0,
      "vocGasPpm": 120.5
    },
    "system": {
      "lidOpen": false,
      "batteryPct": 95,
      "firmwareVersion": "1.0.4"
    },
    "trays": [
      {
        "trayNumber": 1,
        "category": "COOKED_MEALS",
        "rawWeightKg": 15.20,
        "tareWeightKg": 2.50,
        "netWeightKg": 12.70
      },
      {
        "trayNumber": 2,
        "category": "VEGETABLES",
        "rawWeightKg": 6.80,
        "tareWeightKg": 2.50,
        "netWeightKg": 4.30
      }
    ]
  }'
```

---

## 2. IoT Heartbeat (`POST /api/iot/heartbeat`)

Sends a connectivity ping and battery/firmware status update.

```bash
curl -X POST "${BASE_URL}/api/iot/heartbeat" \
  -H "Content-Type: application/json" \
  -H "x-bin-id: ${BIN_ID}" \
  -H "x-device-token: ${DEVICE_TOKEN}" \
  -d '{
    "timestamp": "2026-10-03T18:30:00.000Z",
    "firmwareVersion": "1.0.4",
    "batteryPct": 94
  }'
```

---

## 3. Human Authenticated: List Smart Bins (`GET /api/iot/bins`)

Lists smart bins. Requires a logged-in user session (DONOR or ADMIN).

```bash
curl -X GET "${BASE_URL}/api/iot/bins" \
  -H "Accept: application/json" \
  -H "Cookie: ${DONOR_COOKIE}"
```

---

## 4. Human Authenticated: Tare Food Tray (`POST /api/iot/trays/[id]/tare`)

Calibrates the empty tare weight for a tray slot. Restricted to the bin's donor or system admins.

```bash
curl -X POST "${BASE_URL}/api/iot/trays/${TRAY_ID}/tare" \
  -H "Content-Type: application/json" \
  -H "Cookie: ${DONOR_COOKIE}" \
  -d '{
    "tareWeightKg": 2.50
  }'
```

---

## 5. Security Test cURLs (Expected Failures)

### Missing Device Credentials (Expected: 401)
```bash
curl -i -X POST "${BASE_URL}/api/iot/telemetry" \
  -H "Content-Type: application/json" \
  -d '{"binCode": "BIN-DELHI-001"}'
```

### Invalid Device Token (Expected: 401)
```bash
curl -i -X POST "${BASE_URL}/api/iot/telemetry" \
  -H "Content-Type: application/json" \
  -H "x-bin-id: ${BIN_ID}" \
  -H "x-device-token: wrong_token_test" \
  -d '{"binCode": "BIN-DELHI-001"}'
```

### Bin Code Mismatch in Payload (Expected: 400)
```bash
curl -i -X POST "${BASE_URL}/api/iot/telemetry" \
  -H "Content-Type: application/json" \
  -H "x-bin-id: BIN-DELHI-001" \
  -H "x-device-token: ${DEVICE_TOKEN}" \
  -d '{
    "binCode": "BIN-MUMBAI-999",
    "timestamp": "2026-10-03T18:30:00.000Z",
    "ambient": {"temperatureC": 20, "humidityPct": 50, "vocGasPpm": 50},
    "system": {"lidOpen": false, "batteryPct": 90, "firmwareVersion": "1.0.4"},
    "trays": []
  }'
```
