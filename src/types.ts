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
  DESCENT = 5,             // Stage 1 drogue parachute descent (1000m -> ~600m @ 17 m/s)
  AEROBREAK_RELEASE = 6,   // Stage 2 main parafoil phase (~600m -> 0m @ 1-3 m/s); enum name kept for protocol compatibility
  IMPACT = 7,              // Touchdown / Recovery Mode
}

export interface FlightStateInfo {
  code: FlightStateCode;
  label: string;
  description: string;
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
  l1Connected: boolean;             // Primary LoRa link
  l2Connected: boolean | null;      // Backup link
  deployed: boolean | null;         // Simulator-only deployment flag; not transmitted by live hardware (always null in live)
  audioBeaconActive: boolean | null;// 92dB recovery buzzer
  gsmModuleActive: boolean | null;  // Recovery SMS active
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

