/**
 * IN-SPACe CAN-7USAT India Student Competition 2026-27 (3rd Edition)
 * Team Parikshit (Team 017, 2026-IN-SPACe-CAN-7USAT-017)
 * Manipal Institute of Technology, MAHE, Manipal
 */

export enum FlightStateCode {
  BOOT = 0,
  TEST_MODE = 1,
  LAUNCH_PAD = 2,
  ASCENT = 3,
  ROCKET_DEPLOY = 4,
  DESCENT = 5,              // FSW 3: DROGUE_DESCENT / Legacy Stage 1 drogue descent
  AEROBREAK_RELEASE = 6,    // Legacy Stage 2 main parafoil phase; enum name kept for protocol compatibility
  IMPACT = 7,               // FSW 8: LANDING (wire: "LANDED") / Touchdown & Recovery Mode
  PARAFOIL_DEPLOYMENT = 8,  // FSW 4: PARAFOIL_DEPLOYMENT (wire: "PARAFOIL_DEPLOY", <=700m AGL, 7.0s burnwire)
  PRECISION_GUIDANCE = 9,   // FSW 5: PRECISION_GUIDANCE (wire: "PRECISION_GUIDE", 10-waypoint GNC + 6000 RPM flywheel)
  TERMINAL_GUIDANCE = 10,   // FSW 6: TERMINAL_GUIDANCE (wire: "TERMINAL_LOITER", 30m radius energy-management spiral)
  FINAL_APPROACH = 11,      // FSW 7: FINAL_APPROACH (wire: "FINAL_APPROACH", direct target glide)
  FAILSAFE = 12,            // FSW 9: FAILSAFE (wire: "FAILSAFE", emergency recovery + buzzer beacon)
}

export interface FlightStateInfo {
  code: FlightStateCode;
  label: string;
  description: string;
  color: string;
  bgGlow: string;
}

export interface FirmwareFlightStateInfo {
  fswIndex: number;         // 0..9 enum index in flight-software-reference/nav_types.h (enum class FlightState : uint8_t)
  enumName: string;         // C++ identifier in FlightState enum
  wireName: string;         // Transmitted string from getFlightStateName(FlightState)
  stateCode: FlightStateCode;
  label: string;
  description: string;
  transitionRule: string;
  color: string;
  bgGlow: string;
}

export type TelemetrySource = 'SIMULATION' | 'LIVE_SERIAL';

export type SerialConnectionState =
  | 'DISCONNECTED'
  | 'CONNECTING'
  | 'CONNECTED'
  | 'ERROR'
  | 'UNSUPPORTED';

export interface SerialMetrics {
  rawBytesReceived: number;
  completeLinesReceived: number;
  validPacketsReceived: number;
  malformedPacketsReceived: number;
  connectionErrors: number;
  lastValidPacketTimeMs: number | null;
  lastValidPacketRxTime?: string | null; // Computer packet-reception time-of-day (UTC), separate from GNSS time
  lastValidPacketUtc: string | null;     // Raw received GNSS UTC time-of-day (HH:MM:SS)
  lastValidPacketIst?: string | null;    // Converted GNSS IST time-of-day (HH:MM:SS, +05:30)
  lastError: string | null;
  portLabel: string | null;
}

export interface RawLogEntry {
  time: string;
  text: string;
  type: 'rx' | 'tx' | 'sys' | 'err';
  source?: TelemetrySource;
}

export interface TelemetryPacket {
  source?: TelemetrySource;
  receivedAtMs?: number;
  receivedAtTimeStr?: string; // Computer packet-reception time-of-day (UTC), kept separate from GNSS time

  teamId: string;            // "2026-IN-SPACe-CAN-7USAT-017" (Team 017; live frames are validated against this by the parser)
  packetNumber: number;
  missionTimeSeconds: number; // Seconds since launch
  timestampUtc: string;       // Exact raw GNSS time string as received (HH:MM:SS, UTC time-of-day only, no date)
  gnssTimeIst?: string | null;// GNSS time converted from UTC to IST (+05:30, HH:MM:SS time-of-day only, no date)
  
  // Primary Telemetry (MS5611 Barometer / GY-SHT40)
  altitude: number | null;          // meters AGL
  velocity: number | null;          // m/s descent/ascent rate (null when not transmitted)
  acceleration: number | null;      // total Gs (null when not transmitted)
  accelX: number | null;
  accelY: number | null;
  accelZ: number | null;
  spinRate: number | null;          // deg/s
  
  // Z-Axis Momentum Bias Wheel (DCS Stabilization)
  wheelRpm: number | null;          // RPM (null when not transmitted)

  // 6-DOF Orientation (BNO055 IMU)
  roll: number | null;              // degrees
  pitch: number | null;             // degrees
  yaw: number | null;               // degrees (null when not transmitted)
  
  // GNSS Data (NEO-M9N)
  latitude: number | null;          // ° N (null when GPS invalid)
  longitude: number | null;         // ° E (null when GPS invalid)
  gpsAltitude: number | null;       // m AMSL (null when GPS invalid)
  gpsSats: number | null;           // Satellites in view
  gpsFixType: 'NO_FIX' | '2D' | '3D';
  gpsValid?: boolean;
  rawLatitude?: number | null;
  rawLongitude?: number | null;
  rawGpsAltitude?: number | null;
  
  // Environmental & Air Quality Sensors (Bonus Objectives)
  co2: number | null;               // SCD40 CO2 concentration in ppm
  pm2_5: number | null;             // SPS30 particulate matter in µg/m³
  uv: number | null;                // LTR390 UV Index
  humidity: number | null;          // GY-SHT40 %RH
  
  // Electrical Power Subsystem
  temperature: number | null;       // °C
  pressure: number | null;          // hPa (converted from Pa in live serial)
  rawPressurePa?: number | null;    // Raw Pascals from live serial stream
  batteryVoltage: number | null;    // Volts
  currentDraw: number | null;       // Amps
  power: number | null;             // Watts
  batterySoc: number | null;        // State of Charge %
  rssi: number | null;              // dBm
  
  // Flight Software State & Flags
  stateCode: FlightStateCode | null;
  fswStateName: string;
  fswStateIndex?: number | null;    // 0..9 enum index in CAN7USAT_FSW nav_types.h (null if unmapped/legacy)
  packetFormat?: 'FSW_KV_32' | 'FSW_CSV_32' | 'FSW_KV_24' | 'FSW_CSV_24' | 'LEGACY_CSV_19' | 'SIMULATION';
  l1Connected: boolean;             // Primary LoRa link
  l2Connected: boolean | null;      // Backup link
  deployed: boolean | null;         // Simulator-only deployment flag; not transmitted by live hardware (always null in live)
  audioBeaconActive: boolean | null;// 92dB recovery buzzer (populated from BUZZER_MOSFET in 24/32-field FSW telemetry)
  gsmModuleActive: boolean | null;  // Recovery SMS active (simulator-only; null in live FSW)

  // CAN7USAT_FSW 24-Field & 32-Field Actuator & Guidance Telemetry Extensions
  gyroZRadps?: number | null;       // Raw GYRO_Z_RADPS value as transmitted by CAN7USAT_FSW.ino
  leftServoDeg?: number | null;     // LEFT_SERVO_DEG (legacy 24-field FSW only; null in 32-field v2 continuous-rotation FSW)
  rightServoDeg?: number | null;    // RIGHT_SERVO_DEG (legacy 24-field FSW only; null in 32-field v2 continuous-rotation FSW)
  derivedSteering?: number | null;  // Deterministic steering command [-1.0, +1.0]
  burnwireActive?: boolean | null;  // BURNWIRE_MOSFET (Pin 4 XY-MOS thermal cutter active during 7.0s disreefing)
  buzzerMosfet?: boolean | null;    // BUZZER_MOSFET (Pin 5 XY-MOS 500ms beacon state in LANDED / FAILSAFE)

  // Integrated 32-Field v2 Continuous-Rotation Parafoil Brake Spool Telemetry
  leftBrakeCmd?: number | null;     // LEFT_BRAKE_CMD (0.000..1.000 normalized brake command)
  rightBrakeCmd?: number | null;    // RIGHT_BRAKE_CMD (0.000..1.000 normalized brake command)
  leftSpoolDir?: 'STOP' | 'WIND' | 'RELEASE' | null;   // LEFT_SPOOL_DIR
  rightSpoolDir?: 'STOP' | 'WIND' | 'RELEASE' | null;  // RIGHT_SPOOL_DIR
  leftServoUs?: number | null;      // LEFT_SERVO_US (microsecond PWM pulse width)
  rightServoUs?: number | null;     // RIGHT_SERVO_US (microsecond PWM pulse width)
  leftEstPullMm?: number | null;    // LEFT_EST_PULL_MM (open-loop estimated pull in mm, null when UNCAL)
  rightEstPullMm?: number | null;   // RIGHT_EST_PULL_MM (open-loop estimated pull in mm, null when UNCAL)
  actuatorCalStatus?: 'CALIBRATED' | 'UNCAL_LOCKED' | null; // ACTUATOR_CAL
  actuatorFault?: string | null;    // ACTUATOR_FAULT (e.g. NONE, UNCALIBRATED, BURST_CAP_REACHED, etc.)
}

export interface SerialConfig {
  port: string;
  baudRate: number;
  connected: boolean;
  rxCount: number;
  txCount: number;
}

export interface ChartTimeframe {
  label: string;
  seconds: number;
}

export type ActiveTab =
  | 'OVERVIEW'
  | 'LANDING_PREDICTOR'
  | 'TELEMETRY'
  | 'ATTITUDE_SENSORS'
  | 'COMMS_LOGS';

