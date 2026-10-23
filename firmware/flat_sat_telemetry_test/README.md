# CAN-7USAT Flat-Sat Telemetry Test Firmware & Integration Guide
**Team Parikshit (Team 017 | `2026-IN-SPACe-CAN-7USAT-017`)**  
**Target Hardware: PJRC Teensy 4.1 Breadboard Flat-Sat**  
**Compatible with: CAN-7USAT Ground Control Station (GCS)**

---

## 1. Overview & Objective

This directory contains the temporary, hardware-safe sensor integration firmware for the **Teensy 4.1 flat-sat breadboard setup**.

The primary objective is end-to-end integration and bench verification between the physical sensors (MS5611, BNO055, NEO-M9N, SCD40) and the CAN-7USAT Ground Control Station (GCS) via the Web Serial API at 115200 baud.

> [!CAUTION]
> **Hardware Safety Boundary**:  
> Missing actuators (burnwire deployment mechanism, parafoil steering servos, and BLDC reaction flywheel) are **NOT** installed on this breadboard.  
> This firmware strictly disables and omits all actuator outputs. It contains **no PWM signals, no servo pulses, and no high-current GPIO drivers**.

---

## 2. Hardware Wiring & Pinout Table

All sensors are connected to the primary I2C bus of the Teensy 4.1 (**Pin 18 / SDA**, **Pin 19 / SCL**).

### 2.1 Sensor Pin Connections

| Subsystem / Sensor | Interface | Teensy 4.1 Pin | Pin Name | Voltage Level | Notes |
|:---|:---|:---:|:---|:---:|:---|
| **Common Ground** | Power | GND | GND | 0V | Common breadboard ground rail |
| **Common 3.3V Rail** | Power | 3.3V | 3.3V (250mA max) | 3.3V | Supplies MS5611, BNO055, NEO-M9N |
| **Common 5V / VIN Rail**| Power | VIN / 5V | USB 5V | 5.0V | Supplies SCD40 (requires 3.3V–5.5V supply) |
| **MS5611 Barometer** | I2C SDA | **Pin 18** | Wire SDA0 | 3.3V | Default address `0x77` (fallback `0x76` if SDO pulled low) |
| | I2C SCL | **Pin 19** | Wire SCL0 | 3.3V | 100 kHz standard clock |
| **BNO055 9-DOF IMU** | I2C SDA | **Pin 18** | Wire SDA0 | 3.3V | Default address `0x28` (fallback `0x29` if ADR pulled high) |
| | I2C SCL | **Pin 19** | Wire SCL0 | 3.3V | External 32.768 kHz crystal mode enabled in firmware |
| **NEO-M9N GNSS** | I2C SDA | **Pin 18** | Wire SDA0 | 3.3V | Address `0x42`. UBX protocol over I2C |
| | I2C SCL | **Pin 19** | Wire SCL0 | 3.3V | 1 Hz update rate |
| **SCD40 $\text{CO}_2$ Sensor**| I2C SDA | **Pin 18** | Wire SDA0 | 3.3V / 5V | Address `0x62`. Polled periodically (~5s interval) |
| | I2C SCL | **Pin 19** | Wire SCL0 | 3.3V / 5V | Requires stable power during NDIR pulse |
| **Serial1 UART (LoRa)** | RX1 | **Pin 0** | RX1 | 3.3V | Connects to LoRa module TX (e.g. RA-08H / E220) |
| | TX1 | **Pin 1** | TX1 | 3.3V | Connects to LoRa module RX at 115200 baud |
| **Battery Divider (Opt)** | Analog | **Pin 14 (A0)**| ADC0 | 0–3.3V | Disabled by default (`VBAT_ENABLED 0`); reports `0.00V` |

> [!IMPORTANT]
> **I2C Pull-Up Resistors**:  
> Ensure 2.2 kΩ to 4.7 kΩ pull-up resistors are installed between Pin 18 (SDA) $\rightarrow$ 3.3V and Pin 19 (SCL) $\rightarrow$ 3.3V if the sensor breakout boards do not already provide them.

---

## 3. Required Arduino Libraries & Verified Versions

The following libraries must be installed in Arduino IDE 2.x via the Library Manager (`Ctrl+Shift+I`):

1. **Teensyduino Core**: Version `1.62.0` (or later).  
   - Boards Manager URL: `https://www.pjrc.com/teensy/package_teensy_index.json`
2. **MS5611** by Rob Tillaart: Version `0.5.2` (or compatible).
3. **Adafruit BNO055**: Version `1.6.4`.
4. **Adafruit Unified Sensor**: Version `1.1.15`.
5. **SparkFun u-blox GNSS Arduino Library**: Version `2.2.29`.
6. **Sensirion I2C SCD4x**: Version `1.1.0`.

---

## 4. Compilation & Upload Instructions

### 4.1 Using Arduino IDE 2.x
1. Open Arduino IDE.
2. Open the sketch:
   `groundstation/cansat-ground-control-station/firmware/flat_sat_telemetry_test/CAN7USAT_FlatSat_Telemetry_Test.ino`
   *(If prompted to move into a folder named `CAN7USAT_FlatSat_Telemetry_Test`, accept or keep the matching directory).*
3. In the board selection dropdown:
   - Select **Teensy 4.1**.
   - USB Type: **Serial**.
   - CPU Speed: **600 MHz**.
   - Optimize: **Faster**.
4. Click **Verify** (`Ctrl+R`) to compile.
5. Connect your Teensy 4.1 via Micro-USB cable to your laptop.
6. Click **Upload** (`Ctrl+U`).

### 4.2 Using Arduino CLI (Command Line)
If using `arduino-cli`:
```bash
arduino-cli compile --fqbn teensy:avr:teensy41 CAN7USAT_FlatSat_Telemetry_Test.ino
arduino-cli upload -p COMx --fqbn teensy:avr:teensy41 CAN7USAT_FlatSat_Telemetry_Test.ino
```

---

## 5. Connecting to the CAN-7USAT GCS (Web Serial)

1. **CRITICAL: Close Arduino Serial Monitor!**  
   Windows serial ports (`COMx`) are **exclusive**. If the Arduino IDE Serial Monitor or any other terminal (PuTTY, Tera Term) is open on the Teensy port, Google Chrome / Microsoft Edge will fail with:  
   `NetworkError: Failed to open serial port` or `Access denied`.  
   Always close the Arduino Serial Monitor before clicking Connect in the GCS.

2. **Launch the GCS**:
   ```bash
   cd groundstation/cansat-ground-control-station
   npm run dev
   ```
   Open `http://localhost:3000` in Google Chrome or Microsoft Edge.

3. **Connect Web Serial**:
   - In the top header bar, click the **Connect** button or navigate to **Communications & Logs**.
   - Set Baud Rate to **115200**.
   - Click **Connect Serial**.
   - In the browser device picker modal, select **USB Serial Device (Teensy 4.1)** and click **Connect**.
   - The status indicator will turn **GREEN** (`CONNECTED`).
   - Telemetry packets will begin streaming at 1 Hz, populating:
     - Mission Time & Packet Counter
     - MS5611 Barometric Pressure & Relative Altitude
     - BNO055 3D Orientation (Pitch, Roll, Spin Rate)
     - GNSS Coordinates & Fix Status (switches from `NO_FIX` to `3D` once satellites are acquired)
     - Flight State Badge (`1: TEST_MODE`)

---

## 6. Sensirion SCD40 Status Note

The Sensirion SCD40 is initialized and periodically read by the firmware in the background.

However, the authoritative CAN-7USAT live telemetry schema consists of **strictly 19 comma-separated fields**. The GCS live parser will reject any packet with extra fields. Therefore, SCD40 $\text{CO}_2$ concentration and relative humidity readings are kept in flight computer memory and logged locally, but are **not** appended to the live 19-field CSV line. See `TELEMETRY_PROTOCOL.md` for the complete field specification.
