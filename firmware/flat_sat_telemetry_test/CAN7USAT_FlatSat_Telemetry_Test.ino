/*
 * CAN-7USAT — Flat-Sat Telemetry Test Firmware
 * Team Parikshit (Team 017 | 2026-IN-SPACe-CAN-7USAT-017)
 * Manipal Institute of Technology, MAHE, Manipal
 *
 * Microcontroller: PJRC Teensy 4.1 (ARM Cortex-M7 @ 600 MHz)
 * Hardware Target: Breadboard Flat-Sat Integration Test Setup
 *
 * Hardware Safety Notice:
 * This firmware is strictly for sensor telemetry acquisition and GCS
 * integration testing. Missing actuators (burnwire release mechanism,
 * parafoil steering servos, and BLDC reaction wheel) are NOT connected.
 * This firmware contains ZERO actuator pin definitions, ZERO PWM drivers,
 * and NEVER attempts to energize any actuator output.
 *
 * Connected Sensors (I2C Bus Wire, Pin 18 SDA, Pin 19 SCL):
 * 1. MS5611-01BA03 Barometric Pressure & Temperature Sensor (0x77 / 0x76)
 * 2. Adafruit BNO055 9-DOF Absolute Orientation IMU (0x28 / 0x29)
 * 3. SparkFun NEO-M9N GNSS Receiver (0x42 via UBX-NAV-PVT)
 * 4. Sensirion SCD40 NDIR CO2, Temperature & Relative Humidity (0x62)
 *
 * Telemetry Streaming:
 * - Serial:  Teensy USB Serial (Web Serial API connection to GCS at 115200 baud)
 * - Serial1: Hardware UART (Pins 0/RX1 and 1/TX1 to LoRa transceiver at 115200 baud)
 * - Rate:    1 Hz (1000 ms non-blocking millis)
 * - Format:  Strictly compliant 19-field CSV protocol (+ optional trailing comma)
 */

#include <Arduino.h>
#include <Wire.h>
#include <math.h>

#include <MS5611.h>
#include <Adafruit_Sensor.h>
#include <Adafruit_BNO055.h>
#include <SparkFun_u-blox_GNSS_Arduino_Library.h>
#include <SensirionI2cScd4x.h>

// ============================================================
// CONFIGURATION & MISSION CONSTANTS
// ============================================================

// Authoritative Team Identifier matching GCS LIVE_TELEMETRY_TEAM_ID
#define TEAM_ID               "2026-IN-SPACe-CAN-7USAT-017"

// Flight software state string reported to GCS (maps to FlightStateCode.TEST_MODE)
#define BENCH_FSW_STATE       "TEST_MODE"

// Telemetry streaming interval in milliseconds (1 Hz)
#define TELEMETRY_INTERVAL_MS 1000UL

// SCD40 internal measurement interval in milliseconds (~5 seconds)
#define SCD40_POLL_INTERVAL_MS 5000UL

// Debug diagnostics banner switch.
// Set to 0 for pure, uninterrupted GCS CSV streaming immediately on boot.
// Set to 1 only when diagnosing sensor initialization in Arduino Serial Monitor.
#define DEBUG_DIAGNOSTICS     0

// Battery monitoring configuration
// Set to 0 for flat-sat breadboard testing (streams 0.00 V cleanly).
// Set to 1 only when a verified resistor divider is connected to VBAT_PIN.
#define VBAT_ENABLED          0
#define VBAT_PIN              A0
#define VDIV_RATIO            2.0f

// Nominal sea-level pressure fallback in hPa
#define SEA_LEVEL_HPA_DEFAULT 1013.25f

// ============================================================
// SENSOR INSTANCES
// ============================================================

MS5611 baro(0x77, &Wire);
Adafruit_BNO055 bno(55, 0x28, &Wire);
SFE_UBLOX_GNSS gnss;
SensirionI2cScd4x scd4x;

// Sensor initialization status flags
bool baroOK = false;
bool imuOK  = false;
bool gnssOK = false;
bool scdOK  = false;

// Ground reference pressure in hPa for relative AGL altitude computation
float groundPressureHpa = NAN;

// SCD40 background measurements (polled safely; kept in memory)
uint16_t scdCo2Ppm     = 0;
float    scdTempC      = NAN;
float    scdHumidityPct = NAN;
bool     scdDataValid  = false;

// Telemetry counters and timers
uint32_t packetCount       = 0;
uint32_t missionStartMs    = 0;
uint32_t lastTelemetryMs   = 0;
uint32_t lastScdPollMs     = 0;

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

/**
 * Computes barometric altitude relative to established ground reference pressure
 * using the standard international barometric formula.
 */
static float calculateRelativeAltitude(float currentPressureHpa, float referencePressureHpa) {
  if (!isfinite(currentPressureHpa) || currentPressureHpa <= 0.0f ||
      !isfinite(referencePressureHpa) || referencePressureHpa <= 0.0f) {
    return 0.0f;
  }
  return 44330.0f * (1.0f - powf(currentPressureHpa / referencePressureHpa, 0.1903f));
}

/**
 * Transmits a completed CSV line identically to both USB Serial and Serial1 (LoRa UART).
 */
static void broadcastTelemetryLine(const char* line) {
  Serial.print(line);
  Serial1.print(line);
}

// ============================================================
// SETUP
// ============================================================

void setup() {
  // Initialize USB Serial and Hardware UART1 (Pins 0/RX1 and 1/TX1) at 115200 baud
  Serial.begin(115200);
  Serial1.begin(115200);

  // Short delay for power stabilization
  delay(500);

  // Initialize I2C Bus on default Teensy 4.1 pins (Pin 18 = SDA, Pin 19 = SCL)
  Wire.begin();
  Wire.setClock(100000); // 100 kHz standard I2C for breadboard signal integrity

  // 1. Initialize MS5611 Barometer (Auto-detect address 0x77 with fallback to 0x76)
  baroOK = baro.begin();
  if (!baroOK) {
    baro = MS5611(0x76, &Wire);
    baroOK = baro.begin();
  }

  // 2. Initialize BNO055 IMU (Auto-detect address 0x28 with fallback to 0x29)
  imuOK = bno.begin();
  if (!imuOK) {
    bno = Adafruit_BNO055(55, 0x29, &Wire);
    imuOK = bno.begin();
  }
  if (imuOK) {
    bno.setExtCrystalUse(true);
  }

  // 3. Initialize SparkFun NEO-M9N GNSS
  gnssOK = gnss.begin(Wire);
  if (gnssOK) {
    gnss.setI2COutput(COM_TYPE_UBX);
    gnss.setNavigationFrequency(1); // 1 Hz navigation solution
    gnss.setAutoPVT(true);          // Non-blocking automatic PVT reception
  }

  // 4. Initialize Sensirion SCD40 CO2 Sensor
  scd4x.begin(Wire, SCD40_I2C_ADDR_62);
  scd4x.stopPeriodicMeasurement(); // Clear any stale measurement state
  delay(100);
  scdOK = (scd4x.startPeriodicMeasurement() == 0);

#if DEBUG_DIAGNOSTICS
  Serial.println(F("\n--- CAN-7USAT FLAT-SAT INITIALIZATION ---"));
  Serial.print(F("MS5611 Barometer: ")); Serial.println(baroOK ? F("OK") : F("FAILED"));
  Serial.print(F("BNO055 IMU:       ")); Serial.println(imuOK  ? F("OK") : F("FAILED"));
  Serial.print(F("NEO-M9N GNSS:     ")); Serial.println(gnssOK ? F("OK") : F("FAILED"));
  Serial.print(F("SCD40 Air Quality:")); Serial.println(scdOK  ? F("OK") : F("FAILED"));
  Serial.println(F("-----------------------------------------"));
#endif

  // Establish ground reference pressure by averaging initial barometer readings
  if (baroOK) {
    float pressureAccumulator = 0.0f;
    uint8_t validSamples = 0;

    for (uint8_t i = 0; i < 20; i++) {
      if (baro.read() == MS5611_READ_OK) {
        float p = baro.getPressure();
        if (isfinite(p) && p > 300.0f && p < 1200.0f) {
          pressureAccumulator += p;
          validSamples++;
        }
      }
      delay(30);
    }

    if (validSamples >= 5) {
      groundPressureHpa = pressureAccumulator / (float)validSamples;
    } else {
      groundPressureHpa = SEA_LEVEL_HPA_DEFAULT;
    }
  } else {
    groundPressureHpa = SEA_LEVEL_HPA_DEFAULT;
  }

#if DEBUG_DIAGNOSTICS
  Serial.print(F("Ground Reference Pressure (hPa): "));
  Serial.println(groundPressureHpa, 2);
  Serial.println(F("Starting 19-field telemetry stream...\n"));
#endif

  missionStartMs  = millis();
  lastTelemetryMs = millis();
  lastScdPollMs   = millis();
}

// ============================================================
// MAIN LOOP
// ============================================================

void loop() {
  // Service background GNSS message decoding
  if (gnssOK) {
    gnss.checkUblox();
  }

  // Poll SCD40 periodically (~5 seconds) without blocking telemetry
  if (scdOK && (millis() - lastScdPollMs >= SCD40_POLL_INTERVAL_MS)) {
    lastScdPollMs = millis();
    bool dataReady = false;

    if (scd4x.getDataReadyStatus(dataReady) == 0 && dataReady) {
      uint16_t co2 = 0;
      float temp = NAN;
      float hum = NAN;

      if (scd4x.readMeasurement(co2, temp, hum) == 0 && co2 > 0) {
        scdCo2Ppm      = co2;
        scdTempC       = temp;
        scdHumidityPct = hum;
        scdDataValid   = true;
      }
    }
  }

  // Fixed 1 Hz telemetry timing
  if (millis() - lastTelemetryMs < TELEMETRY_INTERVAL_MS) {
    return;
  }
  lastTelemetryMs = millis();
  packetCount++;

  uint32_t missionTimeSeconds = (millis() - missionStartMs) / 1000UL;

  // ------------------------------------------------------------
  // 1. Read MS5611 Barometer
  // ------------------------------------------------------------
  float relativeAltitudeM = 0.0f;
  float pressurePa        = 101325.0f; // Default nominal 1 atm in Pa
  float baroTemperatureC  = 25.0f;

  if (baroOK && baro.read() == MS5611_READ_OK) {
    float pressureHpa = baro.getPressure();
    float tempC       = baro.getTemperature();

    if (isfinite(pressureHpa) && pressureHpa > 0.0f) {
      // Convert hPa to Pascals (Pa) as strictly required by GCS parser
      pressurePa = pressureHpa * 100.0f;
      relativeAltitudeM = calculateRelativeAltitude(pressureHpa, groundPressureHpa);
    }
    if (isfinite(tempC)) {
      baroTemperatureC = tempC;
    }
  }

  // ------------------------------------------------------------
  // 2. Battery Voltage Measurement
  // ------------------------------------------------------------
  float batteryVolts = 0.00f;
#if VBAT_ENABLED
  int rawAdc = analogRead(VBAT_PIN);
  batteryVolts = (float)rawAdc * (3.3f / 1023.0f) * VDIV_RATIO;
  if (!isfinite(batteryVolts) || batteryVolts < 0.0f) {
    batteryVolts = 0.00f;
  }
#endif

  // ------------------------------------------------------------
  // 3. Read SparkFun NEO-M9N GNSS
  // ------------------------------------------------------------
  char   utcTimeStr[12] = "00:00:00";
  double latitudeDeg    = 0.0;
  double longitudeDeg   = 0.0;
  float  gpsAltitudeM   = 0.0f;
  int    satellitesInView = 0;

  if (gnssOK && gnss.getPVT()) {
    satellitesInView = (int)gnss.getSIV();
    uint8_t fixType  = gnss.getFixType();

    // UTC Time: Format as strict HH:MM:SS (never send 'UNAVAILABLE')
    // Accept time if fix acquired or GNSS clock is locked
    if (fixType >= 2 || gnss.getTimeValid()) {
      snprintf(
        utcTimeStr,
        sizeof(utcTimeStr),
        "%02d:%02d:%02d",
        gnss.getHour(),
        gnss.getMinute(),
        gnss.getSecond()
      );
    }

    // Coordinates: Report valid readings only with 2D/3D fix and satellites > 0
    if (fixType >= 2 && satellitesInView > 0) {
      latitudeDeg  = (double)gnss.getLatitude()  / 1e7;
      longitudeDeg = (double)gnss.getLongitude() / 1e7;
      gpsAltitudeM = (float)gnss.getAltitudeMSL() / 1000.0f;

      if (!isfinite(latitudeDeg))  latitudeDeg  = 0.0;
      if (!isfinite(longitudeDeg)) longitudeDeg = 0.0;
      if (!isfinite(gpsAltitudeM)) gpsAltitudeM = 0.0f;
    } else {
      // Strict fallback for unlocked GNSS
      latitudeDeg  = 0.0;
      longitudeDeg = 0.0;
      gpsAltitudeM = 0.0f;
      satellitesInView = 0;
    }
  }

  // ------------------------------------------------------------
  // 4. Read Adafruit BNO055 IMU
  // ------------------------------------------------------------
  float accelX       = 0.00f;
  float accelY       = 0.00f;
  float accelZ       = 9.81f; // Nominal earth gravity at rest
  float rollDeg      = 0.00f;
  float pitchDeg     = 0.00f;
  float spinRateDegS = 0.00f; // Spin rate around Z axis in deg/s

  if (imuOK) {
    imu::Vector<3> accel = bno.getVector(Adafruit_BNO055::VECTOR_ACCELEROMETER);
    imu::Vector<3> euler = bno.getVector(Adafruit_BNO055::VECTOR_EULER);
    imu::Vector<3> gyro  = bno.getVector(Adafruit_BNO055::VECTOR_GYROSCOPE);

    if (isfinite(accel.x()) && isfinite(accel.y()) && isfinite(accel.z())) {
      accelX = accel.x();
      accelY = accel.y();
      accelZ = accel.z();
    }
    if (isfinite(euler.y()) && isfinite(euler.z())) {
      rollDeg  = euler.y(); // Adafruit BNO055 convention: y = roll
      pitchDeg = euler.z(); // Adafruit BNO055 convention: z = pitch
    }
    // Adafruit BNO055 VECTOR_GYROSCOPE outputs in degrees per second (dps)
    if (isfinite(gyro.z())) {
      spinRateDegS = gyro.z();
    }
  }

  // ------------------------------------------------------------
  // 5. Construct and Broadcast 19-Field CSV Telemetry Line
  //
  // Schema (19 fields + trailing comma):
  //  0: teamId (2026-IN-SPACe-CAN-7USAT-017)
  //  1: missionTimeSeconds (integer)
  //  2: packetNumber (integer)
  //  3: altitude (float, m relative AGL)
  //  4: pressure (float, Pascals Pa)
  //  5: temperature (float, °C)
  //  6: batteryVoltage (float, V)
  //  7: timestampUtc (strict HH:MM:SS)
  //  8: latitude (float decimal degrees)
  //  9: longitude (float decimal degrees)
  // 10: gpsAltitude (float, m AMSL)
  // 11: gpsSats (integer)
  // 12: accelX (float, m/s^2)
  // 13: accelY (float, m/s^2)
  // 14: accelZ (float, m/s^2)
  // 15: roll (float, deg)
  // 16: pitch (float, deg)
  // 17: spinRate (float, deg/s)
  // 18: fswStateName (string, e.g. TEST_MODE)
  // 19: trailing comma (treated as empty 20th field by GCS parser)
  // ------------------------------------------------------------
  char csvBuffer[320];
  snprintf(
    csvBuffer,
    sizeof(csvBuffer),
    "%s,%lu,%lu,%.2f,%.2f,%.2f,%.2f,%s,%.7f,%.7f,%.2f,%d,%.2f,%.2f,%.2f,%.2f,%.2f,%.2f,%s,\r\n",
    TEAM_ID,
    (unsigned long)missionTimeSeconds,
    (unsigned long)packetCount,
    relativeAltitudeM,
    pressurePa,
    baroTemperatureC,
    batteryVolts,
    utcTimeStr,
    latitudeDeg,
    longitudeDeg,
    gpsAltitudeM,
    satellitesInView,
    accelX,
    accelY,
    accelZ,
    rollDeg,
    pitchDeg,
    spinRateDegS,
    BENCH_FSW_STATE
  );

  broadcastTelemetryLine(csvBuffer);
}
