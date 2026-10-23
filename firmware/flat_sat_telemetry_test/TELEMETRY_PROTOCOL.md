# CAN-7USAT Telemetry Protocol Specification
**IN-SPACe CAN-7USAT India Student Competition 2026–27 (3rd Edition)**  
**Team Parikshit (Team 017 | `2026-IN-SPACe-CAN-7USAT-017`)**  
**Flight Computer: PJRC Teensy 4.1 | Ground Control Station Interface**

---

## 1. Overview & Architecture

The CAN-7USAT Ground Control Station (GCS) consumes real-time telemetry from the CanSat flight computer over USB Serial (Web Serial API) or LoRa 865.50 MHz receiver (UART).

To ensure deterministic serial framing, minimal packet overhead, and zero ambiguity across browser Web Serial buffers, telemetry is encoded as a **19-field comma-separated values (CSV) ASCII line**, optionally terminated with a trailing comma and followed by `\r\n` (CRLF) or `\n`.

```
<Field 0>,<Field 1>,...,<Field 18>,\r\n
```

### Rate and Baud Rate
- **Telemetry Streaming Rate**: Fixed `1.0 Hz` (1 packet per second via non-blocking `millis()`).
- **USB Serial Baud Rate**: `115200` baud, 8 data bits, no parity, 1 stop bit (8N1).
- **Serial1 (LoRa UART) Baud Rate**: `115200` baud 8N1.

---

## 2. Canonical 19-Field Protocol Table

| Index | Field Name | Data Type | Valid Range | Physical Units | Example Value | Fallback / Bench Default | Description & Validation Rules |
|:---:|:---|:---:|:---:|:---:|:---:|:---:|:---|
| **0** | `teamId` | String | Fixed exact string | N/A | `2026-IN-SPACe-CAN-7USAT-017` | `2026-IN-SPACe-CAN-7USAT-017` | Authoritative Team ID assigned by IN-SPACe. Any other string causes immediate frame rejection by `parseTelemetryLine`. |
| **1** | `missionTimeSeconds` | Unsigned Int | `[0, 10000000]` | Seconds (`s`) | `42` | `0` | Elapsed flight computer seconds since power-up or launch detect. Formatted with integer regex `/^\d+$/`. |
| **2** | `packetNumber` | Unsigned Int | `[0, 10000000]` | Count | `128` | `1` | Monotonically incrementing packet counter for packet loss detection. Formatted with integer regex `/^\d+$/`. |
| **3** | `altitude` | Float | `[-1000.0, 100000.0]` | Meters (`m`) | `612.40` | `0.00` | Relative barometric altitude AGL, zero-referenced to startup ground pressure. Never output `NaN` or `Inf`. |
| **4** | `pressure` | Float | `[0.0, 300000.0]` | **Pascals (`Pa`)** | `101325.00` | `101325.00` | Raw barometric atmospheric pressure in **Pascals** (e.g., standard atmospheric pressure `1013.25 hPa` = `101325.0 Pa`). GCS converts `Pa` to `hPa` (`pressureHpa = rawPressurePa / 100.0`). |
| **5** | `temperature` | Float | `[-100.0, 200.0]` | Degrees Celsius (`°C`) | `24.60` | `25.00` | Ambient temperature measured by MS5611 barometer. |
| **6** | `batteryVoltage` | Float | `[0.0, 50.0]` | Volts (`V`) | `7.84` | `0.00` | Battery bus voltage. Streams `0.00` when `VBAT_ENABLED 0` (flat-sat breadboard mode). |
| **7** | `timestampUtc` | String | `00:00:00` to `23:59:59` | UTC Time of Day (`HH:MM:SS`) | `07:15:32` | `00:00:00` | GNSS UTC time-of-day. Strict regex `/^(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?$/`. **Never transmit `"UNAVAILABLE"` or alphanumeric strings**. |
| **8** | `latitude` | Float (Double) | `[-90.0, 90.0]` | Decimal Degrees (`° N`) | `13.3525123` | `0.0000000` | GNSS latitude. Unlocked/missing GPS fix sends `0.0000000`. GCS evaluates `(0,0)` as `NO_FIX` and keeps `latitude: null`. |
| **9** | `longitude` | Float (Double) | `[-180.0, 180.0]` | Decimal Degrees (`° E`) | `74.7928345` | `0.0000000` | GNSS longitude. Unlocked/missing GPS fix sends `0.0000000`. |
| **10** | `gpsAltitude` | Float | `[-1000.0, 100000.0]` | Meters AMSL (`m`) | `65.40` | `0.00` | GNSS altitude above mean sea level. Unlocked/missing GPS fix sends `0.00`. |
| **11** | `gpsSats` | Unsigned Int | `[0, 99]` | Satellite count | `8` | `0` | Number of GNSS satellites in view with valid lock. Unlocked/missing GPS fix sends `0`. |
| **12** | `accelX` | Float | `[-500.0, 500.0]` | Meters / second² (`m/s²`) | `0.02` | `0.00` | Body-frame acceleration along X axis from BNO055 `VECTOR_ACCELEROMETER`. |
| **13** | `accelY` | Float | `[-500.0, 500.0]` | Meters / second² (`m/s²`) | `-0.03` | `0.00` | Body-frame acceleration along Y axis from BNO055 `VECTOR_ACCELEROMETER`. |
| **14** | `accelZ` | Float | `[-500.0, 500.0]` | Meters / second² (`m/s²`) | `9.81` | `9.81` | Body-frame acceleration along Z axis from BNO055 `VECTOR_ACCELEROMETER` (nominal ~9.81 m/s² at rest). |
| **15** | `roll` | Float | `[-360.0, 360.0]` | Degrees (`°`) | `0.15` | `0.00` | CanSat Euler roll angle from BNO055 `VECTOR_EULER` (`euler.y()`). |
| **16** | `pitch` | Float | `[-360.0, 360.0]` | Degrees (`°`) | `-0.20` | `0.00` | CanSat Euler pitch angle from BNO055 `VECTOR_EULER` (`euler.z()`). |
| **17** | `spinRate` | Float | `[-10000.0, 10000.0]` | Degrees / second (`°/s`) | `0.01` | `0.00` | Z-axis rotation rate from BNO055 `VECTOR_GYROSCOPE` (`gyro.z()`). |
| **18** | `fswStateName` | String | `^[A-Za-z0-9_-]{1,40}$` | Nominal State Tag | `TEST_MODE` | `TEST_MODE` | Flight software state string. Mapped by GCS to `FlightStateCode`. Must be `TEST_MODE` during bench flat-sat verification. |
| **19** | *Trailing Comma* | Delimiter | Empty | N/A | `,` | `,` | Optional trailing comma supported by parser to preserve hardware transmitter compatibility. |

---

## 3. Critical Field Formats & Parser Behavior

### 3.1 Pressure Units: Pascals (`Pa`) vs Hectopascals (`hPa`)
- The firmware outputs atmospheric pressure in **Pascals (Pa)** as a floating-point number (e.g. `101325.00`).
- The GCS parser reads field index 4 as `rawPressurePa`.
- The GCS automatically converts this to `pressure` in **hPa** by dividing by `100.0`:
  $$\text{pressureHpa} = \frac{\text{rawPressurePa}}{100.0}$$
- **Do not send `hPa` directly** (e.g., `1013.25`); sending `1013.25` would cause GCS to display `10.13 hPa` (equivalent to 30 km mesospheric altitude!).

### 3.2 Time Representations: UTC and IST
- **Transmitted UTC Time**: Field index 7 must strictly match `/^(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?$/`.
  - When GNSS has acquired time, transmit UTC time formatted as `HH:MM:SS` (e.g., `07:15:32`).
  - When GNSS has no fix or clock lock, **strictly output `00:00:00`**.
  - **NEVER transmit `"UNAVAILABLE"`, `"NONE"`, or empty strings**, as this will immediately cause `parseGnssTime` to fail and discard the entire telemetry frame.
- **Indian Standard Time (IST) Display**:
  - The GCS automatically computes IST (+05:30 offset) using `convertGnssUtcToIst(packet.timestampUtc)`.
  - Reception timestamp (`receivedAtMs` / `receivedAtTimeStr`) is recorded independently on the laptop ground computer to verify latency and packet jitter.

### 3.3 Conservative GNSS Fix Validation
The GCS uses `evaluateGpsValidity(...)` to prevent erroneous map plotting:
- If `latitude == 0.0` and `longitude == 0.0`, OR if `gpsSats == 0`, OR if coordinates exceed geographic bounds:
  - `packet.gpsValid = false`
  - `packet.gpsFixType = 'NO_FIX'`
  - `packet.latitude = null`
  - `packet.longitude = null`
  - `packet.gpsAltitude = null`
- This ensures that when the flat-sat is on an indoor bench with no satellite lock, the GCS does **not** plot a point at Null Island (0°N, 0°E in the Gulf of Guinea), while still displaying all valid non-GPS telemetry (MS5611 altitude, pressure, temperature, BNO055 orientation).

### 3.4 Flight Software State Mapping
The string sent in field index 18 is mapped to `FlightStateCode`:
- `"TEST_MODE"` $\rightarrow$ `FlightStateCode.TEST_MODE` (`1: TEST_MODE`, bench testing & verification)
- `"LAUNCH_PAD"` $\rightarrow$ `FlightStateCode.LAUNCH_PAD` (`2: LAUNCH_PAD`, awaiting launch)
- `"BOOT"` $\rightarrow$ `FlightStateCode.BOOT` (`0: BOOT`, power-on reset)
- `"ASCENT"` / `"LAUNCH_DETECT"` $\rightarrow$ `FlightStateCode.ASCENT` (`3: ASCENT`)
- `"ROCKET_DEPLOY"` $\rightarrow$ `FlightStateCode.ROCKET_DEPLOY` (`4: ROCKET_DEPLOY`)
- `"DESCENT"` $\rightarrow$ `FlightStateCode.DESCENT` (`5: DESCENT`)
- `"AEROBREAK_RELEASE"` $\rightarrow$ `FlightStateCode.AEROBREAK_RELEASE` (`6: PARAFOIL`)
- `"LANDED"` / `"IMPACT"` $\rightarrow$ `FlightStateCode.IMPACT` (`7: TOUCHDOWN / RECOVERY`)

For flat-sat testing, `TEST_MODE` is authoritative.

---

## 4. Why `19thoct.ino` Was Rejected by the GCS

In earlier draft firmware (`19thoct\19thoct.ino`), two incompatible output formats were implemented:

1. **USB Serial Multi-Line Banners**:
   ```
   ============== CAN-7USAT TELEMETRY ==============
   Team ID: 2026-IN-SPACe-CAN-7USAT-017
   Mission Time (s): 42
   ...
   ```
   *Why it failed*: The GCS Web Serial stream is parsed line-by-line by `SerialLineBuffer` and `parseTelemetryLine`. Every single received line is expected to be a self-contained 19-field CSV line. When given a banner line like `Team ID: 2026-IN-SPACe-CAN-7USAT-017`, `rawFields.length` is 1 (instead of 19), triggering `Invalid field count: expected 19 fields, got 1`.

2. **LoRa UART Key-Value Strings on `Serial1`**:
   ```
   TEAM_ID=2026-IN-SPACe-CAN-7USAT-017,MISSION_TIME_S=42,PACKET_COUNT=1,...
   ```
   *Why it failed*: Field 0 contains `"TEAM_ID=2026-IN-SPACe-CAN-7USAT-017"` instead of the exact string `"2026-IN-SPACe-CAN-7USAT-017"`. The team ID check failed immediately.

3. **GPS Time String `"UNAVAILABLE"`**:
   ```
   char gpsTime[12] = "UNAVAILABLE";
   ```
   *Why it failed*: Field 7 is validated against `STRICT_GNSS_TIME_REGEX` (`/^\d{2}:\d{2}:\d{2}/`). `"UNAVAILABLE"` fails the regex and causes the entire packet to be dropped even if the rest of the fields were valid CSV!

The new firmware (`CAN7USAT_FlatSat_Telemetry_Test.ino`) fixes all three issues:
- Zero multi-line banners on `Serial` or `Serial1`.
- Clean CSV values only without key names.
- Zero-filled `"00:00:00"` clock default when GNSS has no fix.

---

## 5. Sensirion SCD40 Status & Omission from 19-Field Protocol

The breadboard setup includes the Sensirion SCD40 NDIR sensor measuring $\text{CO}_2$ concentration (ppm), temperature (°C), and relative humidity (%RH).

### Why $\text{CO}_2$ Is Not in the 19-Field Live CSV
The GCS `parseTelemetryLine` validator enforces a strict schema check:
```typescript
if (rawFields.length === 20) {
  if (rawFields[19].trim() !== '') {
    return { ok: false, error: `Unexpected 20th non-empty field '${rawFields[19]}'` };
  }
} else if (rawFields.length !== 19) {
  return { ok: false, error: `Invalid field count: expected 19 fields, got ${rawFields.length}` };
}
```
If fields for $\text{CO}_2$ or humidity were appended to the live packet, the GCS parser would immediately reject 100% of packets due to unexpected extra fields.

### Firmware Handling
In `CAN7USAT_FlatSat_Telemetry_Test.ino`:
- The SCD40 is initialized at I2C address `0x62`.
- `scd4x.startPeriodicMeasurement()` is executed.
- Measurements are polled in the background every 5 seconds.
- Values are stored in `scdCo2Ppm`, `scdTempC`, and `scdHumidityPct` in RAM.
- They are available for SD card flight logging or a future extended competition telemetry schema, but are **strictly excluded from the 19-field live stream** to maintain compatibility with the GCS.
