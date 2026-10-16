/**
 * IN-SPACe CAN-7USAT India Student Competition 2026-27 (3rd Edition)
 * Team Parikshit (Team No. 2026-INSPACe-CAN-7USAT-332)
 * Manipal Institute of Technology, MAHE, Manipal
 */

export enum FlightStateCode {
  BOOT = 0,
  TEST_MODE = 1,
  LAUNCH_PAD = 2,
  ASCENT = 3,
  ROCKET_DEPLOY = 4,
  DESCENT = 5,             // Stage 1 Reefed Parachute (1000m -> 600m @ 17 m/s)
  AEROBREAK_RELEASE = 6,   // Stage 2 Disreefed Parachute (600m -> 0m @ 1-3 m/s)
  IMPACT = 7,              // Touchdown / Recovery Mode
}

export interface FlightStateInfo {
  code: FlightStateCode;
  label: string;
  description: string;
  color: string;
  bgGlow: string;
}

export interface TelemetryPacket {
  teamId: string;            // "2026-INSPACe-CAN-7USAT-332"
  packetNumber: number;
  missionTimeSeconds: number; // Seconds since launch
  timestampUtc: string;
  
  // Primary Telemetry (MS5611 Barometer / GY-SHT40)
  altitude: number;          // meters AGL
  velocity: number;          // m/s descent/ascent rate
  acceleration: number;      // total Gs (BNO055)
  accelX: number;
  accelY: number;
  accelZ: number;
  spinRate: number;          // deg/s pitch/roll dampening precession (~3.18 deg/s)
  
  // Z-Axis Momentum Bias Wheel (DCS Stabilization)
  wheelRpm: number;          // RPM (MT2204 + 63.4g brass flywheel, 0 - 12,000 RPM)

  // 6-DOF Orientation (BNO055 IMU)
  roll: number;              // degrees
  pitch: number;             // degrees
  yaw: number;               // degrees
  
  // GNSS Data (NEO-M9N)
  latitude: number;          // ° N
  longitude: number;         // ° E
  gpsAltitude: number;       // m AMSL
  gpsSats: number;           // Satellites locked
  gpsFixType: 'NO_FIX' | '2D' | '3D';
  
  // Environmental & Air Quality Sensors (Bonus Objectives)
  co2: number;               // SCD40 CO2 concentration in ppm
  pm2_5: number;             // SPS30 particulate matter in µg/m³
  uv: number;                // LTR390 UV Index
  humidity: number;          // GY-SHT40 %RH
  
  // Electrical Power Subsystem (2S Molicel INR-18650-P30B + ACS712)
  temperature: number;       // °C (GY-SHT40)
  pressure: number;          // hPa / kPa
  batteryVoltage: number;    // Volts (6.4V - 8.4V)
  currentDraw: number;       // Amps (ACS712)
  power: number;             // Watts
  batterySoc: number;        // State of Charge %
  rssi: number;              // dBm (LoRa Zeminet 865MHz)
  
  // Flight Software State & Flags
  stateCode: FlightStateCode;
  fswStateName: string;
  l1Connected: boolean;      // Zeminet 865MHz LoRa
  l2Connected: boolean;      // Digi XBee 2.4GHz backup
  deployed: boolean;         // Disreefed parachute active
  audioBeaconActive: boolean;// 92dB recovery buzzer
  gsmModuleActive: boolean;  // Recovery SMS active
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

export type ActiveTab = 'MISSION' | 'TELEMETRY' | 'GPS_MAP' | 'CHECKLIST' | 'ANALYTICS';
