import { FlightStateCode, TelemetryPacket } from '../types';

export const LIVE_TELEMETRY_TEAM_ID = '2026-IN-SPACe-CAN-7USAT-017';
export const DEFAULT_MAX_LINE_LENGTH = 1024;

/**
 * Exact 24-field key order serialized by `transmitLoRaTelemetry()` in
 * `flight-software-reference/CAN7USAT_FSW.ino` (lines 601-662).
 */
export const FSW_TELEMETRY_KEYS = [
  'TEAM_ID',
  'MISSION_TIME_S',
  'PACKET_COUNT',
  'BARO_ALT_M',
  'PRESSURE_PA',
  'BARO_TEMP_C',
  'BATTERY_V',
  'GPS_TIME_UTC',
  'LAT_DEG',
  'LON_DEG',
  'GPS_ALT_MSL_M',
  'SATELLITES',
  'ACCEL_X_MPS2',
  'ACCEL_Y_MPS2',
  'ACCEL_Z_MPS2',
  'ROLL_DEG',
  'PITCH_DEG',
  'GYRO_Z_RADPS',
  'LEFT_SERVO_DEG',
  'RIGHT_SERVO_DEG',
  'BURNWIRE_MOSFET',
  'BUZZER_MOSFET',
  'FLYWHEEL_RPM',
  'FLIGHT_STATE',
] as const;

/**
 * Exact 32-field key order serialized by `transmitLoRaTelemetry()` and `logDataToSD()` in
 * `flight-software-integrated/CAN7USAT_FSW.ino` (v2 continuous-rotation parafoil brake spool telemetry).
 */
export const FSW_V2_TELEMETRY_KEYS = [
  'TEAM_ID',
  'MISSION_TIME_S',
  'PACKET_COUNT',
  'BARO_ALT_M',
  'PRESSURE_PA',
  'BARO_TEMP_C',
  'BATTERY_V',
  'GPS_TIME_UTC',
  'LAT_DEG',
  'LON_DEG',
  'GPS_ALT_MSL_M',
  'SATELLITES',
  'ACCEL_X_MPS2',
  'ACCEL_Y_MPS2',
  'ACCEL_Z_MPS2',
  'ROLL_DEG',
  'PITCH_DEG',
  'GYRO_Z_RADPS',
  'LEFT_BRAKE_CMD',
  'RIGHT_BRAKE_CMD',
  'LEFT_SPOOL_DIR',
  'RIGHT_SPOOL_DIR',
  'LEFT_SERVO_US',
  'RIGHT_SERVO_US',
  'LEFT_EST_PULL_MM',
  'RIGHT_EST_PULL_MM',
  'ACTUATOR_CAL',
  'ACTUATOR_FAULT',
  'BURNWIRE_MOSFET',
  'BUZZER_MOSFET',
  'FLYWHEEL_RPM',
  'FLIGHT_STATE',
] as const;

export type TelemetryParseResult =
  | {
      ok: true;
      packet: TelemetryPacket;
      rawLine: string;
      error?: string;
    }
  | {
      ok: false;
      error: string;
      rawLine: string;
      packet?: TelemetryPacket;
    };

export interface FirmwareControlMessage {
  kind: 'ACK' | 'ERR';
  category: 'STATE' | 'MODE' | 'STEER' | 'SPOOL' | 'SD' | 'TARGET_GPS' | 'UNKNOWN_CMD' | 'GENERIC';
  rawLine: string;
  payload: string;
  targetLatDeg?: number;
  targetLonDeg?: number;
  stateName?: string;
}

type FieldParseResult<T> =
  | { ok: true; value: T; error?: string }
  | { ok: false; error: string; value?: T };

const STRICT_UINT_REGEX = /^\d+$/;
const STRICT_FLOAT_REGEX = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const STRICT_GNSS_TIME_REGEX = /^(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?$/;
const STRICT_FSW_STATE_REGEX = /^[A-Za-z0-9_-]{1,40}$/;

function parseStrictNonNegativeInt(
  token: string,
  fieldName: string,
  maxVal: number = Number.MAX_SAFE_INTEGER
): FieldParseResult<number> {
  const trimmed = token.trim();
  if (!STRICT_UINT_REGEX.test(trimmed)) {
    return { ok: false, error: `Invalid integer format for ${fieldName}: '${token}'` };
  }
  const value = Number(trimmed);
  if (!Number.isSafeInteger(value) || value < 0 || value > maxVal) {
    return { ok: false, error: `Out-of-range integer for ${fieldName}: '${token}'` };
  }
  return { ok: true, value };
}

function parseStrictBinaryFlag(token: string, fieldName: string): FieldParseResult<boolean> {
  const trimmed = token.trim();
  if (trimmed === '0') {
    return { ok: true, value: false };
  }
  if (trimmed === '1') {
    return { ok: true, value: true };
  }
  return {
    ok: false,
    error: `Invalid binary flag for ${fieldName}: '${token}' (expected '0' or '1')`,
  };
}

function parseStrictFloat(
  token: string,
  fieldName: string,
  minVal: number,
  maxVal: number
): FieldParseResult<number> {
  const trimmed = token.trim();
  if (!STRICT_FLOAT_REGEX.test(trimmed)) {
    return { ok: false, error: `Invalid float format for ${fieldName}: '${token}'` };
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value)) {
    return { ok: false, error: `Non-finite float for ${fieldName}: '${token}'` };
  }
  if (value < minVal || value > maxVal) {
    return {
      ok: false,
      error: `Out-of-range value for ${fieldName}: ${value} (expected [${minVal}, ${maxVal}])`,
    };
  }
  return { ok: true, value: Object.is(value, -0) ? 0 : value };
}

/**
 * Validates GNSS UTC time token.
 * Accepts either `"HH:MM:SS"` (with optional fractional seconds) OR `"UNAVAILABLE"`
 * which `CAN7USAT_FSW.ino` (line 93) transmits before `gnss.getPVT()` locks.
 */
function parseGnssTime(token: string): FieldParseResult<string> {
  const trimmed = token.trim();
  if (trimmed.toUpperCase() === 'UNAVAILABLE') {
    return { ok: true, value: 'UNAVAILABLE' };
  }
  const match = STRICT_GNSS_TIME_REGEX.exec(trimmed);
  if (!match) {
    return { ok: false, error: `Invalid GNSS time format: '${token}'` };
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  if (hours > 23 || minutes > 59 || seconds > 59) {
    return { ok: false, error: `Out-of-range GNSS clock values: '${token}'` };
  }
  // Preserve the received GNSS time string exactly as the raw value
  return { ok: true, value: trimmed };
}

/**
 * Converts a verified GNSS UTC time-of-day string (HH:MM:SS) to Indian Standard Time (IST = UTC + 05:30).
 *
 * Library verification:
 * `CAN7USAT_FSW.ino` uses `SparkFun_u-blox_GNSS_Arduino_Library.h` (`SFE_UBLOX_GNSS`), constructing
 * the field via:
 *   snprintf(tBuf, sizeof(tBuf), "%02d:%02d:%02d", gnss.getHour(), gnss.getMinute(), gnss.getSecond());
 * Before first PVT lock, `gnssTimeUTC` is `"UNAVAILABLE"`, for which this function returns `null`.
 */
export function convertGnssUtcToIst(rawUtcTime: string): string | null {
  const match = STRICT_GNSS_TIME_REGEX.exec(rawUtcTime);
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  if (hours > 23 || minutes > 59 || seconds > 59) {
    return null;
  }
  const fractionalSuffix = rawUtcTime.slice(8);
  const totalMinutes = hours * 60 + minutes + 5 * 60 + 30; // +05:30 (330 minutes)
  const wrappedMinutes = ((totalMinutes % 1440) + 1440) % 1440;
  const istHours = Math.floor(wrappedMinutes / 60);
  const istMinutes = wrappedMinutes % 60;

  const hh = String(istHours).padStart(2, '0');
  const mm = String(istMinutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  return `${hh}:${mm}:${ss}${fractionalSuffix}`;
}

/**
 * Formats a computer packet-reception timestamp (epoch ms) as a UTC time-of-day string (HH:MM:SS).
 * Kept strictly separate from the packet's transmitted GNSS time.
 */
export function formatComputerTimeOfDayUtc(epochMs: number): string {
  if (!Number.isFinite(epochMs)) {
    return '00:00:00';
  }
  return new Date(epochMs).toISOString().slice(11, 19);
}

/**
 * Conservatively evaluates GNSS coordinate validity.
 * Zero coordinates (0, 0), zero satellites, or out-of-range coordinates
 * must never create a valid map location.
 */
export function evaluateGpsValidity(
  rawLat: number,
  rawLon: number,
  rawGpsAlt: number,
  gpsSats: number
): {
  gpsValid: boolean;
  gpsFixType: 'NO_FIX' | '2D' | '3D';
  latitude: number | null;
  longitude: number | null;
  gpsAltitude: number | null;
} {
  const inGeographicBounds =
    Number.isFinite(rawLat) &&
    Number.isFinite(rawLon) &&
    Number.isFinite(rawGpsAlt) &&
    rawLat >= -90 &&
    rawLat <= 90 &&
    rawLon >= -180 &&
    rawLon <= 180 &&
    rawGpsAlt >= -1000 &&
    rawGpsAlt <= 100000;

  const isZeroCoordinate = Math.abs(rawLat) < 1e-5 && Math.abs(rawLon) < 1e-5;
  const hasSatelliteLock = Number.isInteger(gpsSats) && gpsSats > 0;

  if (!inGeographicBounds || isZeroCoordinate || !hasSatelliteLock) {
    return {
      gpsValid: false,
      gpsFixType: 'NO_FIX',
      latitude: null,
      longitude: null,
      gpsAltitude: null,
    };
  }

  return {
    gpsValid: true,
    gpsFixType: gpsSats >= 4 ? '3D' : '2D',
    latitude: rawLat,
    longitude: rawLon,
    gpsAltitude: rawGpsAlt,
  };
}

/**
 * Maps known transmitter state names (both `getFlightStateName()` wire labels from
 * `flight-software-reference/nav_types.h` and C++ enum identifiers) to the GCS `FlightStateCode`.
 * Unknown or unmapped states (e.g. `'UNKNOWN'`, `'DEPLOY'`, `'IDLE'`) return `null` so UI components
 * display the authoritative transmitted state string without fabricating a phase.
 */
export function mapTransmitterStateToCode(fswStateName: string): FlightStateCode | null {
  const normalized = fswStateName.trim().toUpperCase();
  switch (normalized) {
    case 'BOOT':
      return FlightStateCode.BOOT;
    case 'TEST_MODE':
      return FlightStateCode.TEST_MODE;
    case 'LAUNCH_PAD':
      return FlightStateCode.LAUNCH_PAD;
    case 'ASCENT':
    case 'LAUNCH_DETECT':
      return FlightStateCode.ASCENT;
    case 'ROCKET_DEPLOY':
      return FlightStateCode.ROCKET_DEPLOY;
    case 'DROGUE_DESCENT':
    case 'DESCENT':
      return FlightStateCode.DESCENT;
    case 'PARAFOIL_DEPLOY':
    case 'PARAFOIL_DEPLOYMENT':
      return FlightStateCode.PARAFOIL_DEPLOYMENT;
    case 'PRECISION_GUIDE':
    case 'PRECISION_GUIDANCE':
      return FlightStateCode.PRECISION_GUIDANCE;
    case 'TERMINAL_LOITER':
    case 'TERMINAL_GUIDANCE':
      return FlightStateCode.TERMINAL_GUIDANCE;
    case 'FINAL_APPROACH':
      return FlightStateCode.FINAL_APPROACH;
    case 'AEROBREAK_RELEASE':
      return FlightStateCode.AEROBREAK_RELEASE;
    case 'LANDED':
    case 'LANDING':
    case 'IMPACT':
      return FlightStateCode.IMPACT;
    case 'FAILSAFE':
      return FlightStateCode.FAILSAFE;
    default:
      return null;
  }
}

/**
 * Maps a transmitted state name to the exact `0..9` `enum class FlightState : uint8_t` index
 * defined in `flight-software-reference/nav_types.h`. Returns `null` for legacy/simulator-only
 * or unknown state strings.
 */
export function mapFirmwareStateIndex(fswStateName: string): number | null {
  const normalized = fswStateName.trim().toUpperCase();
  switch (normalized) {
    case 'BOOT':
      return 0;
    case 'LAUNCH_PAD':
      return 1;
    case 'ASCENT':
    case 'LAUNCH_DETECT':
      return 2;
    case 'DROGUE_DESCENT':
    case 'DESCENT':
      return 3;
    case 'PARAFOIL_DEPLOY':
    case 'PARAFOIL_DEPLOYMENT':
      return 4;
    case 'PRECISION_GUIDE':
    case 'PRECISION_GUIDANCE':
      return 5;
    case 'TERMINAL_LOITER':
    case 'TERMINAL_GUIDANCE':
      return 6;
    case 'FINAL_APPROACH':
      return 7;
    case 'LANDED':
    case 'LANDING':
    case 'IMPACT':
      return 8;
    case 'FAILSAFE':
      return 9;
    default:
      return null;
  }
}

/**
 * Deterministically reconstructs the normalized steering command `[-1.0, +1.0]` from
 * `LEFT_SERVO_DEG` and `RIGHT_SERVO_DEG` using the inverse of `ActuatorController::setSteering`
 * (`flight-software-reference/actuators.cpp` lines 45-71):
 *   leftBrake  = clamp((90 - leftServoDeg) / 90, 0, 1)
 *   rightBrake = clamp((90 - rightServoDeg) / 90, 0, 1)
 *   steering   = rightBrake - leftBrake
 */
export function deriveSteeringFromServos(
  leftServoDeg: number,
  rightServoDeg: number
): number {
  const leftBrake = Math.max(0, Math.min(1, (90.0 - leftServoDeg) / 90.0));
  const rightBrake = Math.max(0, Math.min(1, (90.0 - rightServoDeg) / 90.0));
  const net = Math.max(-1, Math.min(1, rightBrake - leftBrake));
  return Number(net.toFixed(3));
}

/**
 * Parses `ACK:...` and `ERR:...` lines emitted on `LORA_SERIAL` by `processTelecommand()`
 * in `flight-software-reference/CAN7USAT_FSW.ino` (lines 356-539).
 */
export function parseFirmwareControlLine(inputLine: string): FirmwareControlMessage | null {
  const rawLine = inputLine.replace(/[\r\n]+$/g, '').trim();
  if (!rawLine) return null;

  if (rawLine.startsWith('ACK:')) {
    const payload = rawLine.slice(4).trim();
    if (payload.startsWith('STATE=')) {
      const stateName = payload.slice(6).trim();
      return { kind: 'ACK', category: 'STATE', rawLine, payload, stateName };
    }
    if (payload.startsWith('MODE=')) {
      return { kind: 'ACK', category: 'MODE', rawLine, payload };
    }
    if (payload.startsWith('STEER=')) {
      return { kind: 'ACK', category: 'STEER', rawLine, payload };
    }
    if (payload.startsWith('SPOOL=')) {
      return { kind: 'ACK', category: 'SPOOL', rawLine, payload };
    }
    if (payload.startsWith('SD=')) {
      return { kind: 'ACK', category: 'SD', rawLine, payload };
    }
    if (payload.startsWith('TARGET_GPS=')) {
      const rest = payload.slice('TARGET_GPS='.length);
      const parts = rest.split(',');
      const lat = parts.length >= 1 ? Number(parts[0]) : NaN;
      const lon = parts.length >= 2 ? Number(parts[1]) : NaN;
      return {
        kind: 'ACK',
        category: 'TARGET_GPS',
        rawLine,
        payload,
        targetLatDeg: Number.isFinite(lat) ? lat : undefined,
        targetLonDeg: Number.isFinite(lon) ? lon : undefined,
      };
    }
    return { kind: 'ACK', category: 'GENERIC', rawLine, payload };
  }

  if (rawLine.startsWith('ERR:')) {
    const payload = rawLine.slice(4).trim();
    if (payload.startsWith('TARGET_GPS')) {
      return { kind: 'ERR', category: 'TARGET_GPS', rawLine, payload };
    }
    if (payload.startsWith('SPOOL=')) {
      return { kind: 'ERR', category: 'SPOOL', rawLine, payload };
    }
    if (payload.startsWith('STEER=')) {
      return { kind: 'ERR', category: 'STEER', rawLine, payload };
    }
    if (payload.startsWith('UNKNOWN_CMD=')) {
      return { kind: 'ERR', category: 'UNKNOWN_CMD', rawLine, payload };
    }
    return { kind: 'ERR', category: 'GENERIC', rawLine, payload };
  }

  return null;
}

function parseSpoolDirection(
  token: string,
  fieldName: string
): FieldParseResult<'STOP' | 'WIND' | 'RELEASE'> {
  const trimmed = token.trim().toUpperCase();
  if (trimmed === 'STOP' || trimmed === 'WIND' || trimmed === 'RELEASE') {
    return { ok: true, value: trimmed };
  }
  return {
    ok: false,
    error: `Invalid spool direction for ${fieldName}: '${token}' (expected STOP, WIND, or RELEASE)`,
  };
}

function parseEstimatedPullMm(
  token: string,
  fieldName: string
): FieldParseResult<number | null> {
  const trimmed = token.trim();
  if (trimmed.toUpperCase() === 'UNCAL') {
    return { ok: true, value: null };
  }
  return parseStrictFloat(trimmed, fieldName, 0, 500);
}

function parseActuatorCalStatus(
  token: string
): FieldParseResult<'CALIBRATED' | 'UNCAL_LOCKED'> {
  const trimmed = token.trim().toUpperCase();
  if (trimmed === 'CALIBRATED' || trimmed === 'UNCAL_LOCKED') {
    return { ok: true, value: trimmed };
  }
  return {
    ok: false,
    error: `Invalid ACTUATOR_CAL token: '${token}' (expected CALIBRATED or UNCAL_LOCKED)`,
  };
}

/**
 * Pure parser for a single telemetry line from the CAN-7USAT flight software or receiver.
 *
 * Supported wire & log schemas:
 * 1. `FSW_KV_32` / `FSW_CSV_32` (Integrated `flight-software-integrated/CAN7USAT_FSW.ino` 32-field v2 continuous-rotation brake spool telemetry).
 * 2. `FSW_KV_24` / `FSW_CSV_24` (Reference `flight-software-reference/CAN7USAT_FSW.ino` 24-field v1 telemetry).
 * 3. `LEGACY_CSV_19` (19-field + optional 20th empty trailing field positional CSV format).
 */
export function parseTelemetryLine(
  inputLine: string,
  receivedAtMs: number = Date.now()
): TelemetryParseResult {
  const rawLine = inputLine.replace(/[\r\n]+$/g, '').trim();
  if (!rawLine) {
    return { ok: false, error: 'Empty telemetry line', rawLine: '' };
  }

  const rawFields = rawLine.split(',');

  // Detect whether this line uses KEY=VALUE pairs (CAN7USAT_FSW transmitLoRaTelemetry format)
  const isKeyValueFormat = rawFields[0].includes('=');

  let values: string[];
  let packetFormat: 'FSW_KV_32' | 'FSW_CSV_32' | 'FSW_KV_24' | 'FSW_CSV_24' | 'LEGACY_CSV_19';

  if (isKeyValueFormat) {
    let kvTokens: string[];
    let expectedKeys: readonly string[];
    if (
      rawFields.length === 32 ||
      (rawFields.length === 33 && rawFields[32].trim() === '')
    ) {
      packetFormat = 'FSW_KV_32';
      kvTokens = rawFields.slice(0, 32);
      expectedKeys = FSW_V2_TELEMETRY_KEYS;
    } else if (
      rawFields.length === 24 ||
      (rawFields.length === 25 && rawFields[24].trim() === '')
    ) {
      packetFormat = 'FSW_KV_24';
      kvTokens = rawFields.slice(0, 24);
      expectedKeys = FSW_TELEMETRY_KEYS;
    } else {
      return {
        ok: false,
        error: `Invalid KEY=VALUE field count: expected 32 (v2) or 24 (v1) fields, got ${rawFields.length}`,
        rawLine,
      };
    }

    values = [];
    for (let i = 0; i < expectedKeys.length; i++) {
      const token = kvTokens[i].trim();
      const eqIdx = token.indexOf('=');
      if (eqIdx <= 0) {
        return {
          ok: false,
          error: `Missing KEY=VALUE separator at field ${i} ('${token}')`,
          rawLine,
        };
      }
      const key = token.slice(0, eqIdx).trim();
      const val = token.slice(eqIdx + 1).trim();
      const expectedKey = expectedKeys[i];
      if (key !== expectedKey) {
        return {
          ok: false,
          error: `Unexpected telemetry key at field ${i}: got '${key}', expected '${expectedKey}'`,
          rawLine,
        };
      }
      values.push(val);
    }
  } else if (rawFields.length === 32 || (rawFields.length === 33 && rawFields[32].trim() === '')) {
    packetFormat = 'FSW_CSV_32';
    values = rawFields.slice(0, 32);
    if (values[0].trim() === 'TEAM_ID') {
      return {
        ok: false,
        error: 'CSV header row ignored',
        rawLine,
      };
    }
  } else if (rawFields.length === 24 || (rawFields.length === 25 && rawFields[24].trim() === '')) {
    packetFormat = 'FSW_CSV_24';
    values = rawFields.slice(0, 24);
    if (values[0].trim() === 'TEAM_ID') {
      return {
        ok: false,
        error: 'CSV header row ignored',
        rawLine,
      };
    }
  } else if (rawFields.length === 20) {
    if (rawFields[19].trim() !== '') {
      return {
        ok: false,
        error: `Unexpected 20th non-empty field '${rawFields[19]}'`,
        rawLine,
      };
    }
    packetFormat = 'LEGACY_CSV_19';
    values = rawFields.slice(0, 19);
  } else if (rawFields.length === 19) {
    packetFormat = 'LEGACY_CSV_19';
    values = rawFields;
  } else {
    return {
      ok: false,
      error: `Invalid field count: expected 32 (FSW v2), 24 (FSW v1), or 19 (legacy) fields (plus optional trailing comma), got ${rawFields.length}`,
      rawLine,
    };
  }

  // 0: teamId
  const teamId = values[0].trim();
  if (teamId !== LIVE_TELEMETRY_TEAM_ID) {
    return {
      ok: false,
      error: `Invalid teamId '${teamId}' (expected '${LIVE_TELEMETRY_TEAM_ID}')`,
      rawLine,
    };
  }

  // 1: missionTimeSeconds (MISSION_TIME_S)
  const missionTimeRes = parseStrictNonNegativeInt(values[1], 'missionTimeSeconds', 10_000_000);
  if (!missionTimeRes.ok) return { ok: false, error: missionTimeRes.error, rawLine };

  // 2: packetNumber (PACKET_COUNT / RECORD_COUNT)
  const packetNumberRes = parseStrictNonNegativeInt(values[2], 'packetNumber', 10_000_000);
  if (!packetNumberRes.ok) return { ok: false, error: packetNumberRes.error, rawLine };

  // 3: altitude (BARO_ALT_M, m AGL)
  const altitudeRes = parseStrictFloat(values[3], 'altitude', -1000, 100_000);
  if (!altitudeRes.ok) return { ok: false, error: altitudeRes.error, rawLine };

  // 4: pressure (PRESSURE_PA, Pa -> hPa)
  const pressurePaRes = parseStrictFloat(values[4], 'pressure', 0, 300_000);
  if (!pressurePaRes.ok) return { ok: false, error: pressurePaRes.error, rawLine };
  const rawPressurePa = pressurePaRes.value;
  const pressureHpa = rawPressurePa / 100.0;

  // 5: temperature (BARO_TEMP_C, °C)
  const temperatureRes = parseStrictFloat(values[5], 'temperature', -100, 200);
  if (!temperatureRes.ok) return { ok: false, error: temperatureRes.error, rawLine };

  // 6: batteryVoltage (BATTERY_V, V)
  const batteryVoltageRes = parseStrictFloat(values[6], 'batteryVoltage', 0, 50);
  if (!batteryVoltageRes.ok) return { ok: false, error: batteryVoltageRes.error, rawLine };

  // 7: GNSS time (GPS_TIME_UTC, HH:MM:SS or UNAVAILABLE)
  const gnssTimeRes = parseGnssTime(values[7]);
  if (!gnssTimeRes.ok) return { ok: false, error: gnssTimeRes.error, rawLine };

  // 8, 9, 10: LAT_DEG, LON_DEG, GPS_ALT_MSL_M
  const latRes = parseStrictFloat(values[8], 'latitude', -10000, 10000);
  if (!latRes.ok) return { ok: false, error: latRes.error, rawLine };

  const lonRes = parseStrictFloat(values[9], 'longitude', -10000, 10000);
  if (!lonRes.ok) return { ok: false, error: lonRes.error, rawLine };

  const gpsAltRes = parseStrictFloat(values[10], 'gpsAltitude', -10000, 200_000);
  if (!gpsAltRes.ok) return { ok: false, error: gpsAltRes.error, rawLine };

  // 11: satellites in view (SATELLITES)
  const satsRes = parseStrictNonNegativeInt(values[11], 'gpsSats', 99);
  if (!satsRes.ok) return { ok: false, error: satsRes.error, rawLine };

  // 12, 13, 14: ACCEL_X_MPS2, ACCEL_Y_MPS2, ACCEL_Z_MPS2
  const accelXRes = parseStrictFloat(values[12], 'accelX', -500, 500);
  if (!accelXRes.ok) return { ok: false, error: accelXRes.error, rawLine };

  const accelYRes = parseStrictFloat(values[13], 'accelY', -500, 500);
  if (!accelYRes.ok) return { ok: false, error: accelYRes.error, rawLine };

  const accelZRes = parseStrictFloat(values[14], 'accelZ', -500, 500);
  if (!accelZRes.ok) return { ok: false, error: accelZRes.error, rawLine };

  // 15, 16: ROLL_DEG, PITCH_DEG (degrees)
  const rollRes = parseStrictFloat(values[15], 'roll', -360, 360);
  if (!rollRes.ok) return { ok: false, error: rollRes.error, rawLine };

  const pitchRes = parseStrictFloat(values[16], 'pitch', -360, 360);
  if (!pitchRes.ok) return { ok: false, error: pitchRes.error, rawLine };

  // 17: GYRO_Z_RADPS / spinRate (preserved without silent rescaling)
  const spinRateRes = parseStrictFloat(values[17], 'spinRate', -10000, 10000);
  if (!spinRateRes.ok) return { ok: false, error: spinRateRes.error, rawLine };

  let leftServoDeg: number | null = null;
  let rightServoDeg: number | null = null;
  let derivedSteering: number | null = null;
  let burnwireActive: boolean | null = null;
  let buzzerMosfet: boolean | null = null;
  let wheelRpm: number | null = null;
  let leftBrakeCmd: number | null = null;
  let rightBrakeCmd: number | null = null;
  let leftSpoolDir: 'STOP' | 'WIND' | 'RELEASE' | null = null;
  let rightSpoolDir: 'STOP' | 'WIND' | 'RELEASE' | null = null;
  let leftServoUs: number | null = null;
  let rightServoUs: number | null = null;
  let leftEstPullMm: number | null = null;
  let rightEstPullMm: number | null = null;
  let actuatorCalStatus: 'CALIBRATED' | 'UNCAL_LOCKED' | null = null;
  let actuatorFault: string | null = null;
  let fswStateRaw: string;

  if (packetFormat === 'FSW_KV_32' || packetFormat === 'FSW_CSV_32') {
    // 18: LEFT_BRAKE_CMD (0.000..1.000)
    const leftBrakeRes = parseStrictFloat(values[18], 'leftBrakeCmd', 0, 1);
    if (!leftBrakeRes.ok) return { ok: false, error: leftBrakeRes.error, rawLine };
    leftBrakeCmd = leftBrakeRes.value;

    // 19: RIGHT_BRAKE_CMD (0.000..1.000)
    const rightBrakeRes = parseStrictFloat(values[19], 'rightBrakeCmd', 0, 1);
    if (!rightBrakeRes.ok) return { ok: false, error: rightBrakeRes.error, rawLine };
    rightBrakeCmd = rightBrakeRes.value;

    // Net normalized steering command [-1.0, +1.0] (right brake minus left brake)
    derivedSteering = Number(
      Math.max(-1, Math.min(1, rightBrakeCmd - leftBrakeCmd)).toFixed(3)
    );

    // 20: LEFT_SPOOL_DIR (STOP | WIND | RELEASE)
    const leftDirRes = parseSpoolDirection(values[20], 'leftSpoolDir');
    if (!leftDirRes.ok) return { ok: false, error: leftDirRes.error, rawLine };
    leftSpoolDir = leftDirRes.value;

    // 21: RIGHT_SPOOL_DIR (STOP | WIND | RELEASE)
    const rightDirRes = parseSpoolDirection(values[21], 'rightSpoolDir');
    if (!rightDirRes.ok) return { ok: false, error: rightDirRes.error, rawLine };
    rightSpoolDir = rightDirRes.value;

    // 22: LEFT_SERVO_US (0..3000 µs)
    const leftUsRes = parseStrictNonNegativeInt(values[22], 'leftServoUs', 3000);
    if (!leftUsRes.ok) return { ok: false, error: leftUsRes.error, rawLine };
    leftServoUs = leftUsRes.value;

    // 23: RIGHT_SERVO_US (0..3000 µs)
    const rightUsRes = parseStrictNonNegativeInt(values[23], 'rightServoUs', 3000);
    if (!rightUsRes.ok) return { ok: false, error: rightUsRes.error, rawLine };
    rightServoUs = rightUsRes.value;

    // 24: LEFT_EST_PULL_MM (float 0..500 or UNCAL -> null)
    const leftPullRes = parseEstimatedPullMm(values[24], 'leftEstPullMm');
    if (!leftPullRes.ok) return { ok: false, error: leftPullRes.error, rawLine };
    leftEstPullMm = leftPullRes.value;

    // 25: RIGHT_EST_PULL_MM (float 0..500 or UNCAL -> null)
    const rightPullRes = parseEstimatedPullMm(values[25], 'rightEstPullMm');
    if (!rightPullRes.ok) return { ok: false, error: rightPullRes.error, rawLine };
    rightEstPullMm = rightPullRes.value;

    // 26: ACTUATOR_CAL (CALIBRATED | UNCAL_LOCKED)
    const calRes = parseActuatorCalStatus(values[26]);
    if (!calRes.ok) return { ok: false, error: calRes.error, rawLine };
    actuatorCalStatus = calRes.value;

    // 27: ACTUATOR_FAULT (strict identifier token)
    const faultTrimmed = values[27].trim();
    if (!STRICT_FSW_STATE_REGEX.test(faultTrimmed)) {
      return {
        ok: false,
        error: `Invalid ACTUATOR_FAULT string: '${values[27]}'`,
        rawLine,
      };
    }
    actuatorFault = faultTrimmed;

    // 28: BURNWIRE_MOSFET (0 | 1)
    const burnwireRes = parseStrictBinaryFlag(values[28], 'burnwireMosfet');
    if (!burnwireRes.ok) return { ok: false, error: burnwireRes.error, rawLine };
    burnwireActive = burnwireRes.value;

    // 29: BUZZER_MOSFET (0 | 1)
    const buzzerRes = parseStrictBinaryFlag(values[29], 'buzzerMosfet');
    if (!buzzerRes.ok) return { ok: false, error: buzzerRes.error, rawLine };
    buzzerMosfet = buzzerRes.value;

    // 30: FLYWHEEL_RPM (integer RPM)
    const wheelRpmRes = parseStrictNonNegativeInt(values[30], 'flywheelRpm', 100_000);
    if (!wheelRpmRes.ok) return { ok: false, error: wheelRpmRes.error, rawLine };
    wheelRpm = wheelRpmRes.value;

    // 31: FLIGHT_STATE
    fswStateRaw = values[31];
  } else if (packetFormat === 'FSW_KV_24' || packetFormat === 'FSW_CSV_24') {
    // 18: LEFT_SERVO_DEG (0..180 deg)
    const leftServoRes = parseStrictFloat(values[18], 'leftServoDeg', 0, 180);
    if (!leftServoRes.ok) return { ok: false, error: leftServoRes.error, rawLine };
    leftServoDeg = leftServoRes.value;

    // 19: RIGHT_SERVO_DEG (0..180 deg)
    const rightServoRes = parseStrictFloat(values[19], 'rightServoDeg', 0, 180);
    if (!rightServoRes.ok) return { ok: false, error: rightServoRes.error, rawLine };
    rightServoDeg = rightServoRes.value;

    derivedSteering = deriveSteeringFromServos(leftServoDeg, rightServoDeg);

    // 20: BURNWIRE_MOSFET (0 | 1)
    const burnwireRes = parseStrictBinaryFlag(values[20], 'burnwireMosfet');
    if (!burnwireRes.ok) return { ok: false, error: burnwireRes.error, rawLine };
    burnwireActive = burnwireRes.value;

    // 21: BUZZER_MOSFET (0 | 1)
    const buzzerRes = parseStrictBinaryFlag(values[21], 'buzzerMosfet');
    if (!buzzerRes.ok) return { ok: false, error: buzzerRes.error, rawLine };
    buzzerMosfet = buzzerRes.value;

    // 22: FLYWHEEL_RPM (integer RPM)
    const wheelRpmRes = parseStrictNonNegativeInt(values[22], 'flywheelRpm', 100_000);
    if (!wheelRpmRes.ok) return { ok: false, error: wheelRpmRes.error, rawLine };
    wheelRpm = wheelRpmRes.value;

    // 23: FLIGHT_STATE
    fswStateRaw = values[23];
  } else {
    // 18: flight software state (19-field legacy CSV)
    fswStateRaw = values[18];
  }

  const fswStateName = fswStateRaw.trim();
  if (!STRICT_FSW_STATE_REGEX.test(fswStateName)) {
    return {
      ok: false,
      error: `Invalid flight software state string: '${fswStateRaw}'`,
      rawLine,
    };
  }

  const gpsEval = evaluateGpsValidity(
    latRes.value,
    lonRes.value,
    gpsAltRes.value,
    satsRes.value
  );

  const stateCode = mapTransmitterStateToCode(fswStateName);
  const fswStateIndex = mapFirmwareStateIndex(fswStateName);

  const packet: TelemetryPacket = {
    source: 'LIVE_SERIAL',
    packetFormat,
    receivedAtMs,
    receivedAtTimeStr: formatComputerTimeOfDayUtc(receivedAtMs),
    teamId,
    packetNumber: packetNumberRes.value,
    missionTimeSeconds: missionTimeRes.value,
    timestampUtc: gnssTimeRes.value,
    gnssTimeIst: convertGnssUtcToIst(gnssTimeRes.value),

    // Transmitted primary fields
    altitude: altitudeRes.value,
    pressure: pressureHpa,
    rawPressurePa,
    temperature: temperatureRes.value,
    batteryVoltage: batteryVoltageRes.value,

    // GNSS fields (conservatively validated)
    latitude: gpsEval.latitude,
    longitude: gpsEval.longitude,
    gpsAltitude: gpsEval.gpsAltitude,
    gpsSats: satsRes.value,
    gpsFixType: gpsEval.gpsFixType,
    gpsValid: gpsEval.gpsValid,
    rawLatitude: latRes.value,
    rawLongitude: lonRes.value,
    rawGpsAltitude: gpsAltRes.value,

    // IMU & Orientation fields
    accelX: accelXRes.value,
    accelY: accelYRes.value,
    accelZ: accelZRes.value,
    roll: rollRes.value,
    pitch: pitchRes.value,
    spinRate: spinRateRes.value,
    gyroZRadps: spinRateRes.value,

    // Flight software state
    stateCode,
    fswStateName,
    fswStateIndex,
    l1Connected: true,

    // Actuator & guidance fields
    wheelRpm,
    leftServoDeg,
    rightServoDeg,
    derivedSteering,
    burnwireActive,
    buzzerMosfet,
    audioBeaconActive: buzzerMosfet,
    leftBrakeCmd,
    rightBrakeCmd,
    leftSpoolDir,
    rightSpoolDir,
    leftServoUs,
    rightServoUs,
    leftEstPullMm,
    rightEstPullMm,
    actuatorCalStatus,
    actuatorFault,

    // Absent telemetry fields explicitly set to null (never inferred or replaced with 0)
    velocity: null,
    acceleration: null,
    yaw: null,
    co2: null,
    pm2_5: null,
    uv: null,
    humidity: null,
    currentDraw: null,
    power: null,
    batterySoc: null,
    rssi: null,
    l2Connected: null,
    deployed: null,
    gsmModuleActive: null,
  };

  return {
    ok: true,
    packet,
    rawLine,
  };
}

/**
 * Bounded streaming line buffer for USB-Serial chunk reassembly.
 * Safely handles \r, \n, and \r\n line endings across arbitrary chunk boundaries
 * and caps incomplete line length to prevent unbounded memory growth.
 */
export class SerialLineBuffer {
  private buffer: string = '';
  private overflowed: boolean = false;
  private pendingCr: boolean = false;
  private readonly maxLineLength: number;

  constructor(maxLineLength: number = DEFAULT_MAX_LINE_LENGTH) {
    this.maxLineLength = maxLineLength;
  }

  public pushChunk(chunk: string): { lines: string[]; overflowDiscardedCount: number } {
    const lines: string[] = [];
    let overflowDiscardedCount = 0;

    for (let i = 0; i < chunk.length; i++) {
      const ch = chunk[i];

      if (ch === '\r') {
        if (this.overflowed) {
          overflowDiscardedCount++;
        } else if (this.buffer.trim().length > 0) {
          lines.push(this.buffer);
        }
        this.buffer = '';
        this.overflowed = false;
        this.pendingCr = true;
      } else if (ch === '\n') {
        if (this.pendingCr) {
          // Second byte of a \r\n sequence that already emitted on \r
          this.pendingCr = false;
          continue;
        }
        if (this.overflowed) {
          overflowDiscardedCount++;
        } else if (this.buffer.trim().length > 0) {
          lines.push(this.buffer);
        }
        this.buffer = '';
        this.overflowed = false;
      } else {
        this.pendingCr = false;
        if (!this.overflowed) {
          if (this.buffer.length >= this.maxLineLength) {
            this.overflowed = true;
            this.buffer = '';
          } else {
            this.buffer += ch;
          }
        }
      }
    }

    return { lines, overflowDiscardedCount };
  }

  public reset(): void {
    this.buffer = '';
    this.overflowed = false;
    this.pendingCr = false;
  }

  public getPendingLength(): number {
    return this.buffer.length;
  }

  public isOverflowing(): boolean {
    return this.overflowed;
  }
}
