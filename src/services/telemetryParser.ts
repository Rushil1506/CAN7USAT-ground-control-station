import { FlightStateCode, TelemetryPacket } from '../types';

export const LIVE_TELEMETRY_TEAM_ID = '2026-IN-SPACe-CAN-7USAT-017';
export const DEFAULT_MAX_LINE_LENGTH = 512;

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
    return { ok: false, error: `Out-of-range value for ${fieldName}: ${value} (expected [${minVal}, ${maxVal}])` };
  }
  return { ok: true, value: Object.is(value, -0) ? 0 : value };
}

function parseGnssTime(token: string): FieldParseResult<string> {
  const match = STRICT_GNSS_TIME_REGEX.exec(token);
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
  return { ok: true, value: token };
}

/**
 * Converts a verified GNSS UTC time-of-day string (HH:MM:SS) to Indian Standard Time (IST = UTC + 05:30).
 *
 * Library verification:
 * The transmitter firmware (sketch_sep10c.ino) uses `SparkFun_u-blox_GNSS_Arduino_Library.h`
 * (`SFE_UBLOX_GNSS` over I2C with `COM_TYPE_UBX` and `setAutoPVT(true)`), constructing the field via:
 *   snprintf(gTime, sizeof(gTime), "%02d:%02d:%02d", gnss.getHour(), gnss.getMinute(), gnss.getSecond());
 * In `SFE_UBLOX_GNSS`, `getHour()`, `getMinute()`, and `getSecond()` return the UBX-NAV-PVT UTC
 * time-of-day fields (0..23 h, 0..59 m, 0..60 s).
 *
 * Because the packet contains no date field, this function returns a time-of-day string (HH:MM:SS)
 * with 24-hour midnight rollover and never fabricates a calendar date or day-offset marker.
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
 * Maps known transmitter state names to the GCS FlightStateCode enum where an unambiguous
 * equivalent exists. Unknown or transmitter-specific states return null so UI components
 * display the authoritative transmitted state string without fabricating an enum phase.
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
    case 'DESCENT':
      return FlightStateCode.DESCENT;
    case 'AEROBREAK_RELEASE':
      return FlightStateCode.AEROBREAK_RELEASE;
    case 'IMPACT':
    case 'LANDED':
      return FlightStateCode.IMPACT;
    default:
      return null;
  }
}

/**
 * Pure parser for a single CSV line from the Arduino + RA-08H LoRa receiver.
 *
 * Schema (19 fields + optional 20th empty field from trailing comma):
 *  0: teamId (2026-IN-SPACe-CAN-7USAT-017)
 *  1: missionTimeSeconds (integer, s)
 *  2: packetNumber (integer)
 *  3: altitude (float, m)
 *  4: pressure (float, Pa -> converted to hPa for GCS, raw preserved in rawPressurePa)
 *  5: temperature (float, °C)
 *  6: batteryVoltage (float, V)
 *  7: GNSS time (HH:MM:SS)
 *  8: latitude (float, deg)
 *  9: longitude (float, deg)
 * 10: GPS altitude (float, m)
 * 11: satellites in view (integer)
 * 12: accelX (float)
 * 13: accelY (float)
 * 14: accelZ (float)
 * 15: roll (float, deg)
 * 16: pitch (float, deg)
 * 17: spinRate (float, deg/s)
 * 18: flight software state (string)
 * 19: optional empty trailing field
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

  // Support either 19 fields or 20 fields when the 20th field is empty due to trailing comma
  let fields: string[];
  if (rawFields.length === 20) {
    if (rawFields[19].trim() !== '') {
      return {
        ok: false,
        error: `Unexpected 20th non-empty field '${rawFields[19]}'`,
        rawLine,
      };
    }
    fields = rawFields.slice(0, 19);
  } else if (rawFields.length === 19) {
    fields = rawFields;
  } else {
    return {
      ok: false,
      error: `Invalid field count: expected 19 fields (plus optional trailing comma), got ${rawFields.length}`,
      rawLine,
    };
  }

  // 0: teamId
  const teamId = fields[0].trim();
  if (teamId !== LIVE_TELEMETRY_TEAM_ID) {
    return {
      ok: false,
      error: `Invalid teamId '${teamId}' (expected '${LIVE_TELEMETRY_TEAM_ID}')`,
      rawLine,
    };
  }

  // 1: missionTimeSeconds
  const missionTimeRes = parseStrictNonNegativeInt(fields[1], 'missionTimeSeconds', 10_000_000);
  if (!missionTimeRes.ok) return { ok: false, error: missionTimeRes.error, rawLine };

  // 2: packetNumber
  const packetNumberRes = parseStrictNonNegativeInt(fields[2], 'packetNumber', 10_000_000);
  if (!packetNumberRes.ok) return { ok: false, error: packetNumberRes.error, rawLine };

  // 3: altitude (m)
  const altitudeRes = parseStrictFloat(fields[3], 'altitude', -1000, 100_000);
  if (!altitudeRes.ok) return { ok: false, error: altitudeRes.error, rawLine };

  // 4: pressure (Pa -> hPa)
  const pressurePaRes = parseStrictFloat(fields[4], 'pressure', 0, 300_000);
  if (!pressurePaRes.ok) return { ok: false, error: pressurePaRes.error, rawLine };
  const rawPressurePa = pressurePaRes.value;
  const pressureHpa = rawPressurePa / 100.0;

  // 5: temperature (°C)
  const temperatureRes = parseStrictFloat(fields[5], 'temperature', -100, 200);
  if (!temperatureRes.ok) return { ok: false, error: temperatureRes.error, rawLine };

  // 6: batteryVoltage (V)
  const batteryVoltageRes = parseStrictFloat(fields[6], 'batteryVoltage', 0, 50);
  if (!batteryVoltageRes.ok) return { ok: false, error: batteryVoltageRes.error, rawLine };

  // 7: GNSS time
  const gnssTimeRes = parseGnssTime(fields[7]);
  if (!gnssTimeRes.ok) return { ok: false, error: gnssTimeRes.error, rawLine };

  // 8, 9, 10: latitude, longitude, gpsAltitude (allow any finite float so unlocked GPS values like 999.0 or 0.0000 are handled by conservative GPS validity without dropping non-GPS sensors)
  const latRes = parseStrictFloat(fields[8], 'latitude', -10000, 10000);
  if (!latRes.ok) return { ok: false, error: latRes.error, rawLine };

  const lonRes = parseStrictFloat(fields[9], 'longitude', -10000, 10000);
  if (!lonRes.ok) return { ok: false, error: lonRes.error, rawLine };

  const gpsAltRes = parseStrictFloat(fields[10], 'gpsAltitude', -10000, 200_000);
  if (!gpsAltRes.ok) return { ok: false, error: gpsAltRes.error, rawLine };

  // 11: satellites in view
  const satsRes = parseStrictNonNegativeInt(fields[11], 'gpsSats', 99);
  if (!satsRes.ok) return { ok: false, error: satsRes.error, rawLine };

  // 12, 13, 14: accelX, accelY, accelZ
  const accelXRes = parseStrictFloat(fields[12], 'accelX', -500, 500);
  if (!accelXRes.ok) return { ok: false, error: accelXRes.error, rawLine };

  const accelYRes = parseStrictFloat(fields[13], 'accelY', -500, 500);
  if (!accelYRes.ok) return { ok: false, error: accelYRes.error, rawLine };

  const accelZRes = parseStrictFloat(fields[14], 'accelZ', -500, 500);
  if (!accelZRes.ok) return { ok: false, error: accelZRes.error, rawLine };

  // 15, 16: roll, pitch (degrees)
  const rollRes = parseStrictFloat(fields[15], 'roll', -360, 360);
  if (!rollRes.ok) return { ok: false, error: rollRes.error, rawLine };

  const pitchRes = parseStrictFloat(fields[16], 'pitch', -360, 360);
  if (!pitchRes.ok) return { ok: false, error: pitchRes.error, rawLine };

  // 17: spinRate
  const spinRateRes = parseStrictFloat(fields[17], 'spinRate', -10000, 10000);
  if (!spinRateRes.ok) return { ok: false, error: spinRateRes.error, rawLine };

  // 18: flight software state
  const fswStateName = fields[18].trim();
  if (!STRICT_FSW_STATE_REGEX.test(fswStateName)) {
    return {
      ok: false,
      error: `Invalid flight software state string: '${fields[18]}'`,
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

  const packet: TelemetryPacket = {
    source: 'LIVE_SERIAL',
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

    // Flight software state
    stateCode,
    fswStateName,
    l1Connected: true,

    // Absent telemetry fields explicitly set to null (never inferred or replaced with 0)
    velocity: null,
    acceleration: null,
    wheelRpm: null,
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
    audioBeaconActive: null,
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
