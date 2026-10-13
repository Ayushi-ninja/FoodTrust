# 📡 FoodTrust — ESP32 & IoT Device API Contract

**Document Version:** 1.0.0  
**Phase:** Phase 3 — IoT Device Authentication & Telemetry  
**Target Hardware:** ESP32-WROOM-32 / ESP32-S3 Microcontroller  
**Chamber Sensors:** HX711 (ADC Load Cells), DHT22 (Temp & Humidity), MQ-135 / BME680 (Airborne VOC Spoilage Gas)  
**Security Standard:** TLS 1.3 / HTTPS, Salted SHA-256 Pre-Shared Tokens, Strict Constant-Time Header Authentication

---

## 1. Physical Hardware & Safety Architecture

The FoodTrust smart bin is physically bifurcated into two hermetically isolated compartments:

```
+--------------------------------------------------------------+
| 1. FOOD HANDLING UNIT (Sanitary Interior Chamber)            |
|    - Food-grade Removable Trays (Stainless Steel / PETG)     |
|    - Tray Weighing Sub-assemblies                            |
|    - Load Cells (Mounted below tray brackets)                |
|    - DHT22 (Temperature & Humidity, sealed probe)            |
|    - MQ-135 (VOC & Spoilage gas sensor, splash-guarded)     |
+--------------------------------------------------------------+
                               ||
         Hermetic Wire Pass-through (Food-grade Silicone)
                               ||
+--------------------------------------------------------------+
| 2. ELECTRONICS UNIT (External Lower Compartment)             |
|    - HX711 24-bit ADC Modules (Amplifies load cell mV)       |
|    - ESP32 Microcontroller (Dual-core Wi-Fi/BLE)            |
|    - 5V DC Power Supply & Thermal Fuses                      |
|    - Calibration/Status LEDs and Buzzer                      |
+--------------------------------------------------------------+
```

> [!IMPORTANT]
> The **Electronics Unit** is physically isolated from the sanitary chamber. Microcontrollers, power regulation, and external communication interfaces must **NEVER** be situated within the food-contact compartment.

---

## 2. Authentication Contract

Every request made by an ESP32 hardware unit to the backend requires two HTTP request headers:

| Header | Type | Description | Example |
|--------|------|-------------|---------|
| `x-bin-id` | String | Unique physical bin identifier registered in the database | `BIN-DELHI-001` |
| `x-device-token` | String | Secret raw device token provisioned into microcontroller NVS/EEPROM | `dt_sec_9f8e7d6c5b4a3120` |

### Security Model
1. The backend **NEVER** stores raw device tokens in plaintext.
2. The database table `public.smart_bins` stores a salted SHA-256 hash:
   $$\text{api\_key\_hash} = \text{SHA256}(\text{raw\_token} + \text{IOT\_DEVICE\_SHARED\_SALT})$$
3. Verification is performed using constant-time memory comparison (`crypto.timingSafeEqual`) to prevent timing side-channel attacks.
4. If authentication fails, a generic `HTTP 401 Unauthorized` is returned without revealing whether the bin code or the token was invalid.

---

## 3. Endpoints

### 3.1 Telemetry Batch Ingestion

Transmits sensor readings from both the chamber ambient sensors and individual tray load cells.

- **URL:** `https://<DOMAIN>/api/iot/telemetry`
- **Method:** `POST`
- **Headers:**
  - `Content-Type: application/json`
  - `x-bin-id: <BIN_CODE>`
  - `x-device-token: <DEVICE_TOKEN>`

#### Request Payload
```json
{
  "binCode": "BIN-DELHI-001",
  "timestamp": "2026-09-30T17:45:00.000Z",
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
}
```

#### Physical Validation Bounds
- `temperatureC`: `-10.0` to `65.0` °C
- `humidityPct`: `0.0` to `100.0` %
- `vocGasPpm`: `0.0` to `5000.0` ppm
- `batteryPct`: `0` to `100` %
- `rawWeightKg`: `0.0` to `150.0` kg
- `tareWeightKg`: `0.0` to `50.0` kg
- `netWeightKg`: `0.0` to `150.0` kg (must be $\le \text{rawWeightKg} + 0.15\text{ kg}$)
- `category`: Must match enum `['COOKED_MEALS', 'VEGETABLES', 'FRUITS', 'BAKERY', 'DAIRY']`
- `timestamp`: ISO 8601 string. Future timestamps $>5\text{ minutes}$ from server clock are rejected.

#### Success Response (HTTP 200 OK)
```json
{
  "success": true,
  "data": {
    "binCode": "BIN-DELHI-001",
    "recordedAt": "2026-09-30T17:45:00.000Z",
    "recordsInserted": 3,
    "evaluations": [
      {
        "trayNumber": 1,
        "category": "COOKED_MEALS",
        "netWeightKg": 12.70,
        "freshnessScore": 92,
        "freshnessStatus": "FRESH",
        "riskLevel": "LOW",
        "estimatedShelfLifeHours": 6.0,
        "disclaimer": "Decision-support indicator based on ambient telemetry; not a certified substitute for food safety testing."
      },
      {
        "trayNumber": 2,
        "category": "VEGETABLES",
        "netWeightKg": 4.30,
        "freshnessScore": 86,
        "freshnessStatus": "FRESH",
        "riskLevel": "LOW",
        "estimatedShelfLifeHours": 18.0,
        "disclaimer": "Decision-support indicator based on ambient telemetry; not a certified substitute for food safety testing."
      }
    ]
  },
  "message": "Telemetry processed successfully",
  "timestamp": "2026-09-30T17:45:00.085Z"
}
```

---

### 3.2 Lightweight Heartbeat

Periodic ping sent by the ESP32 to maintain its `ONLINE` status and report firmware/battery health when no food weight changes occur.

- **URL:** `https://<DOMAIN>/api/iot/heartbeat`
- **Method:** `POST`
- **Headers:**
  - `Content-Type: application/json`
  - `x-bin-id: <BIN_CODE>`
  - `x-device-token: <DEVICE_TOKEN>`

#### Request Payload
```json
{
  "timestamp": "2026-09-30T17:45:00.000Z",
  "firmwareVersion": "1.0.4",
  "batteryPct": 95
}
```

#### Success Response (HTTP 200 OK)
```json
{
  "success": true,
  "data": {
    "binCode": "BIN-DELHI-001",
    "status": "ONLINE",
    "lastHeartbeatAt": "2026-09-30T17:45:00.000Z",
    "firmwareVersion": "1.0.4"
  },
  "message": "Heartbeat acknowledged",
  "timestamp": "2026-09-30T17:45:00.050Z"
}
```

> [!NOTE]
> **Maintenance Preservation Rule:** If a bin has been placed into `MAINTENANCE` or `ALERT` status by an administrator, incoming heartbeats and telemetry will update `last_heartbeat_at` but will **NOT** overwrite the status back to `ONLINE`.

---

## 4. Rate Limiting Contract

- **Limit:** 60 requests per minute per smart bin identity.
- **Window:** 60 seconds sliding window.
- **Exceeded Response (HTTP 429 Too Many Requests):**
  ```json
  {
    "success": false,
    "message": "Too many telemetry requests. Rate limit exceeded (maximum 60 requests per minute).",
    "error": {
      "code": "RATE_LIMIT_EXCEEDED",
      "retryAfterSeconds": 24
    },
    "timestamp": "2026-09-30T17:45:30.000Z"
  }
  ```
- **Response Headers on 429:**
  - `Retry-After: <seconds>`
  - `X-RateLimit-Limit: 60`
  - `X-RateLimit-Remaining: 0`

---

## 5. ESP32 Network Failure & Retry Guidelines

1. **TLS / HTTPS:** The ESP32 must use `WiFiClientSecure` with the Supabase/domain root CA certificate installed. Cleartext HTTP is strictly forbidden in production.
2. **Backoff on 429 / 5xx:**
   - If an `HTTP 429` is received, parse the `retryAfterSeconds` or back off for at least 30 seconds.
   - If an `HTTP 5xx` or timeout occurs, use exponential backoff: $2\text{s} \to 4\text{s} \to 8\text{s} \to 16\text{s}$ (capped at 60s).
3. **Local Buffer on Offline:**
   - When Wi-Fi connectivity drops, store the last 20 readings in ESP32 SPIFFS / LittleFS ring buffer.
   - Once connected, drain the buffer with at least 1.5-second spacing between packets to respect the 60 req/min rate limit.
