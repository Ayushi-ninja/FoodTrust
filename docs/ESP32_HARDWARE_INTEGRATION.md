# 🔌 FoodTrust — ESP32 Hardware Integration & Sensor Wiring Guide

**Document Version:** 1.0.0  
**Phase:** Phase 12 — ESP32 Hardware Integration & Deployment Readiness  
**Target Hardware:** Espressif ESP32-WROOM-32 / ESP32-S3 DevKitC  
**Microcontroller Framework:** Arduino / PlatformIO (C++)  
**API Endpoints:** `POST /api/iot/telemetry`, `POST /api/iot/heartbeat`  
**Security Standard:** Pre-Shared Salted SHA-256 Tokens (`x-bin-id`, `x-device-token`), Constant-Time Comparison, TLS 1.3 / HTTPS

---

## 1. Physical Compartment Bifurcation & Safety Segregation

To comply with sanitation, food safety, and electrical standards, the FoodTrust Smart Bin is physically divided into two hermetically isolated compartments:

```
+-------------------------------------------------------------------------+
| 1. SANITARY FOOD HANDLING UNIT (Interior Refrigerator Chamber)          |
|    - Food-grade Removable Trays (Stainless Steel / PETG, Tare: ~2.5 kg) |
|    - 4x Single-Point Strain Gauge Load Cells (Mounted below tray rails) |
|    - DHT22 Temperature & Humidity Sensor (Food-grade epoxy probe)       |
|    - MQ-135 Gas Sensor Probe (Splash-resistant sintered metal mesh)    |
|    - Magnetic Door Reed Switch (Recessed sanitary door gasket)          |
+-------------------------------------------------------------------------+
                                    ||
     Hermetic Food-Grade Silicone Cable Gland (IP67 Waterproof Pass-through)
                                    ||
+-------------------------------------------------------------------------+
| 2. ELECTRONICS & COMMUNICATION UNIT (External Lower Service Bay)        |
|    - Dual HX711 24-bit ADC Differential Amplifier Boards                |
|    - ESP32-WROOM-32 Microcontroller Module                              |
|    - 5V / 3.3V Step-down Power Supply, Overcurrent Thermal Fuse (2A)     |
|    - LiFePO4 Backup Battery Pack (4-hour power outage failover)         |
|    - Calibration/Status Indicator LEDs & Piezo Buzzer                   |
+-------------------------------------------------------------------------+
```

> [!CAUTION]
> **Food Contact Prohibition:** High-voltage regulation, lithium battery cells, and the ESP32 microcontroller board must **NEVER** be placed inside the food storage compartment. All wiring entering the refrigerated chamber must pass through an IP67-rated food-grade silicone grommet.

---

## 2. Hardware Pinout & Wiring Specifications

### ESP32-WROOM-32 Pin Mapping Table

| Component | Pin Function | ESP32 GPIO | Description / Notes |
|---|---|---|---|
| **DHT22** | DATA (One-Wire) | `GPIO 4` | 4.7kΩ pull-up resistor to 3.3V |
| **DHT22** | VCC / GND | 3.3V / GND | Food-sealed probe in cold chamber |
| **MQ-135** | AOUT (Analog) | `GPIO 34` (ADC1_CH6) | Measures airborne VOC / ammonia equivalent |
| **MQ-135** | VCC / GND | 5.0V / GND | Heater requires 5V rail; ADC voltage divider to 3.3V |
| **Lid Sensor** | Magnetic Reed Switch | `GPIO 21` | Active LOW with internal `INPUT_PULLUP` |
| **HX711 (Tray 1)** | DOUT (Data) | `GPIO 16` | 24-bit serial output from Load Cell 1 |
| **HX711 (Tray 1)** | SCK (Clock) | `GPIO 17` | Clock pulses for serial readout |
| **HX711 (Tray 2)** | DOUT (Data) | `GPIO 18` | 24-bit serial output from Load Cell 2 |
| **HX711 (Tray 2)** | SCK (Clock) | `GPIO 19` | Clock pulses for serial readout |
| **Status LED** | Anode | `GPIO 2` | On-board blue status indicator LED |

---

## 3. Physical Sensor Bounds & Operational Envelopes

The backend enforces strict schema validation (via Zod in `lib/validation/iot.schema.ts`). Readings outside these envelopes are rejected with HTTP 400 to protect data integrity against sensor hardware disconnections:

| Sensor Metric | Minimum Allowed | Maximum Allowed | Failure Diagnosis |
|---|---|---|---|
| **Temperature** | `-10.0°C` | `+65.0°C` | DHT22 pin disconnected or probe shorted |
| **Humidity** | `0.0%` | `100.0%` | Sensor element condensation saturation |
| **VOC Spoilage Gas**| `0 ppm` | `5000 ppm` | Heater coil disconnection or MQ-135 detachment |
| **Tray Net Weight** | `0.00 kg` | `150.00 kg` | Load cell mechanical overload or dislodged wiring |
| **Weight Physics** | `netWeightKg <= rawWeightKg + 0.15` | Net weight cannot exceed gross raw weight |
| **Clock Skew** | Past | `Date.now() + 5 min` | Prevents replay attacks from future timestamps |

---

## 4. HX711 Load Cell Calibration Walkthrough

Each food tray rests upon a calibrated 4-wire strain gauge load cell connected to an HX711 24-bit ADC amplifier.

### Step 1: Tare Calibration (Zero Load)
1. Ensure the tray bracket is completely empty.
2. In firmware setup, invoke `scale.tare()`. The library captures the baseline zero offset:
   $$\text{Offset} = \text{Average}(20 \text{ raw ADC samples})$$

### Step 2: Scale Factor Calculation
1. Place a certified reference mass on the tray (e.g., $M_{\text{known}} = 5.00\text{ kg}$).
2. Read the raw ADC counts difference:
   $$\Delta_{\text{counts}} = \text{Raw reading} - \text{Offset}$$
3. Compute the calibration factor:
   $$\text{Calibration Factor} = \frac{\Delta_{\text{counts}}}{M_{\text{known}}}$$
4. Configure the constant in `include/config.h`:
   ```cpp
   #define HX711_TRAY1_CAL_FACTOR  -2280.0f
   ```

---

## 5. Security & Device Provisioning Runbook

### Authentication Schema
The backend never stores raw device tokens. The database table `public.smart_bins` stores a salted SHA-256 hash:

$$\text{api\_key\_hash} = \text{SHA256}(\text{raw\_device\_token} + \text{IOT\_DEVICE\_SHARED\_SALT})$$

Every HTTP request must pass:
- `x-bin-id`: Matches `smart_bins.bin_code` (e.g., `BIN-DELHI-001`)
- `x-device-token`: The provisioned plaintext secret token (e.g., `dt_sec_9f8e7d6c5b4a3120`)

### Provisioning a New Smart Bin
1. **Generate Raw Token:**
   Generate a cryptographically secure random token (minimum 24 characters):
   ```bash
   node -e "console.log('dt_sec_' + require('crypto').randomBytes(16).toString('hex'))"
   # Example: dt_sec_9f8e7d6c5b4a3120
   ```
2. **Compute Database Hash:**
   Using the server's `IOT_DEVICE_SHARED_SALT` environment variable:
   ```bash
   node -e "
   const crypto = require('crypto');
   const token = 'dt_sec_9f8e7d6c5b4a3120';
   const salt = process.env.IOT_DEVICE_SHARED_SALT;
   const hash = crypto.createHash('sha256').update(token + salt).digest('hex');
   console.log('Database api_key_hash:', hash);
   "
   ```
3. **Insert Bin into Database:**
   ```sql
   INSERT INTO public.smart_bins (
     bin_code, donor_id, location_name, address, status, api_key_hash
   ) VALUES (
     'BIN-DELHI-001', '00000000-0000-0000-0000-000000000001',
     'Central Connaught Hub', 'Connaught Place, New Delhi', 'ONLINE',
     '<COMPUTED_HASH>'
   );
   ```
4. **Flash ESP32 Microcontroller:**
   Copy `include/config.h.example` to `include/config.h`, set `SMART_BIN_CODE` and `SMART_BIN_DEVICE_TOKEN`, and flash using PlatformIO:
   ```bash
   cd firmware/esp32-foodtrust
   pio run --target upload
   ```

---

## 6. Networking, Rate Limiting & Resilience

1. **Sliding-Window Rate Limiter:** The backend limits each smart bin to **60 requests per minute**. Exceeding this returns `HTTP 429 Too Many Requests`. The firmware defaults to:
   - Telemetry transmission interval: **30 seconds**
   - Heartbeat connectivity ping: **60 seconds**
2. **Heartbeat State Machine:**
   - When a bin is `OFFLINE`, an incoming heartbeat transitions it to `ONLINE`.
   - **Safety Invariant:** If a bin is set to `MAINTENANCE` (physical repair) or `ALERT` (spoilage alarm), the heartbeat **NEVER** overwrites this state.
3. **Masked Serial Logging:** Microcontroller firmware must **NEVER** log raw device tokens to serial/UART output. Log lines redact the token:
   `[HTTP] Headers: x-bin-id=BIN-DELHI-001, x-device-token=[REDACTED]`
4. **Sensor Simulation Fallback:** If sensors are not attached during bench testing, the firmware automatically provides realistic synthetic data (`4.2°C`, `62% RH`, `45 ppm VOC`) to verify backend connectivity.
