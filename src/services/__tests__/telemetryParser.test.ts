import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  convertGnssUtcToIst,
  deriveSteeringFromServos,
  evaluateGpsValidity,
  formatComputerTimeOfDayUtc,
  FSW_TELEMETRY_KEYS,
  FSW_V2_TELEMETRY_KEYS,
  LIVE_TELEMETRY_TEAM_ID,
  mapFirmwareStateIndex,
  mapTransmitterStateToCode,
  parseFirmwareControlLine,
  parseTelemetryLine,
  SerialLineBuffer,
} from '../telemetryParser';
import { FlightStateCode } from '../../types';

const SAMPLE_HARDWARE_FRAME =
  '2026-IN-SPACe-CAN-7USAT-017,5,1,0.0,0,0.0,0.00,00:00:00,0.0000,0.0000,0.0,0,0.00,0.00,0.00,0.00,0.00,0.0,LAUNCH_PAD,';

const NOMINAL_FLIGHT_FRAME =
  '2026-IN-SPACe-CAN-7USAT-017,42,38,612.4,94215.0,24.6,7.84,12:34:56,13.3525,74.7928,667.4,8,0.12,-0.08,9.81,2.40,-1.50,3.18,DESCENT,';

describe('parseTelemetryLine — valid frames and trailing comma handling', () => {
  it('parses the actual hardware transmitter sample frame with trailing comma and zero readings', () => {
    const res = parseTelemetryLine(SAMPLE_HARDWARE_FRAME, 1700000000000);
    assert.equal(res.ok, true);
    if (!res.ok) return;

    const p = res.packet;
    assert.equal(p.source, 'LIVE_SERIAL');
    assert.equal(p.receivedAtMs, 1700000000000);
    assert.equal(p.teamId, LIVE_TELEMETRY_TEAM_ID);
    assert.equal(p.missionTimeSeconds, 5);
    assert.equal(p.packetNumber, 1);

    // Valid zeros are preserved as numeric 0, not null
    assert.strictEqual(p.altitude, 0);
    assert.strictEqual(p.rawPressurePa, 0);
    assert.strictEqual(p.pressure, 0);
    assert.strictEqual(p.temperature, 0);
    assert.strictEqual(p.batteryVoltage, 0);
    assert.equal(p.timestampUtc, '00:00:00');
    assert.strictEqual(p.gpsSats, 0);
    assert.strictEqual(p.accelX, 0);
    assert.strictEqual(p.accelY, 0);
    assert.strictEqual(p.accelZ, 0);
    assert.strictEqual(p.roll, 0);
    assert.strictEqual(p.pitch, 0);
    assert.strictEqual(p.spinRate, 0);

    // Zero coordinates and 0 satellites must NOT create a valid GPS location
    assert.equal(p.gpsValid, false);
    assert.equal(p.gpsFixType, 'NO_FIX');
    assert.strictEqual(p.latitude, null);
    assert.strictEqual(p.longitude, null);
    assert.strictEqual(p.gpsAltitude, null);

    // Flight state
    assert.equal(p.fswStateName, 'LAUNCH_PAD');
    assert.equal(p.stateCode, FlightStateCode.LAUNCH_PAD);

    // Absent telemetry fields must be explicitly null, never 0
    assert.strictEqual(p.velocity, null);
    assert.strictEqual(p.acceleration, null);
    assert.strictEqual(p.yaw, null);
    assert.strictEqual(p.wheelRpm, null);
    assert.strictEqual(p.rssi, null);
    assert.strictEqual(p.co2, null);
    assert.strictEqual(p.pm2_5, null);
    assert.strictEqual(p.uv, null);
    assert.strictEqual(p.humidity, null);
    assert.strictEqual(p.currentDraw, null);
    assert.strictEqual(p.power, null);
    assert.strictEqual(p.batterySoc, null);
  });

  it('parses a nominal in-flight frame with and without trailing comma and converts Pa to hPa', () => {
    const withComma = parseTelemetryLine(NOMINAL_FLIGHT_FRAME, 1700000000000);
    const withoutComma = parseTelemetryLine(NOMINAL_FLIGHT_FRAME.slice(0, -1), 1700000000000);

    assert.equal(withComma.ok, true);
    assert.equal(withoutComma.ok, true);
    if (!withComma.ok || !withoutComma.ok) return;

    assert.equal(withComma.packet.packetNumber, 38);
    assert.equal(withComma.packet.missionTimeSeconds, 42);
    assert.equal(withComma.packet.altitude, 612.4);
    assert.equal(withComma.packet.rawPressurePa, 94215.0);
    assert.equal(withComma.packet.pressure, 942.15); // Pa -> hPa
    assert.equal(withComma.packet.temperature, 24.6);
    assert.equal(withComma.packet.batteryVoltage, 7.84);
    assert.equal(withComma.packet.gpsValid, true);
    assert.equal(withComma.packet.gpsFixType, '3D');
    assert.equal(withComma.packet.latitude, 13.3525);
    assert.equal(withComma.packet.longitude, 74.7928);
    assert.equal(withComma.packet.gpsAltitude, 667.4);
    assert.equal(withComma.packet.gpsSats, 8);
    assert.equal(withComma.packet.accelX, 0.12);
    assert.equal(withComma.packet.accelY, -0.08);
    assert.equal(withComma.packet.accelZ, 9.81);
    assert.equal(withComma.packet.roll, 2.4);
    assert.equal(withComma.packet.pitch, -1.5);
    assert.equal(withComma.packet.spinRate, 3.18);
    assert.equal(withComma.packet.fswStateName, 'DESCENT');
    assert.equal(withComma.packet.stateCode, FlightStateCode.DESCENT);

    assert.deepEqual(
      { ...withComma.packet, receivedAtMs: 0 },
      { ...withoutComma.packet, receivedAtMs: 0 }
    );
  });

  it('rejects a 20-field frame when the 20th field is non-empty', () => {
    const extraFieldFrame = `${NOMINAL_FLIGHT_FRAME}EXTRA_DATA`;
    const res = parseTelemetryLine(extraFieldFrame);
    assert.equal(res.ok, false);
  });
});

describe('parseTelemetryLine — team ID, malformed fields, and NaN/Infinity rejection', () => {
  it('rejects invalid or simulator team IDs', () => {
    const wrongTeam = SAMPLE_HARDWARE_FRAME.replace(
      '2026-IN-SPACe-CAN-7USAT-017',
      '2026-INSPACe-CAN-7USAT-332'
    );
    const res = parseTelemetryLine(wrongTeam);
    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.match(res.error, /Invalid teamId/);
    }
  });

  it('rejects frames with too few or too many fields', () => {
    assert.equal(parseTelemetryLine('2026-IN-SPACe-CAN-7USAT-017,1,2,3').ok, false);
    assert.equal(parseTelemetryLine(`${SAMPLE_HARDWARE_FRAME},`).ok, false);
  });

  it('rejects NaN, Infinity, -Infinity, hex strings, and partial numbers', () => {
    const fields = NOMINAL_FLIGHT_FRAME.slice(0, -1).split(',');

    const withNaN = [...fields];
    withNaN[3] = 'NaN';
    assert.equal(parseTelemetryLine(withNaN.join(',')).ok, false);

    const withInf = [...fields];
    withInf[4] = 'Infinity';
    assert.equal(parseTelemetryLine(withInf.join(',')).ok, false);

    const withNegInf = [...fields];
    withNegInf[5] = '-Infinity';
    assert.equal(parseTelemetryLine(withNegInf.join(',')).ok, false);

    const withPartialFloat = [...fields];
    withPartialFloat[6] = '7.84V';
    assert.equal(parseTelemetryLine(withPartialFloat.join(',')).ok, false);

    const withFloatPacketNum = [...fields];
    withFloatPacketNum[2] = '12.5';
    assert.equal(parseTelemetryLine(withFloatPacketNum.join(',')).ok, false);

    const withNegativePacketNum = [...fields];
    withNegativePacketNum[2] = '-1';
    assert.equal(parseTelemetryLine(withNegativePacketNum.join(',')).ok, false);

    const withMissingField = [...fields];
    withMissingField[5] = '';
    assert.equal(parseTelemetryLine(withMissingField.join(',')).ok, false);
  });

  it('rejects invalid GNSS time formats', () => {
    const fields = NOMINAL_FLIGHT_FRAME.slice(0, -1).split(',');
    fields[7] = '25:00:00';
    assert.equal(parseTelemetryLine(fields.join(',')).ok, false);

    fields[7] = 'not-a-time';
    assert.equal(parseTelemetryLine(fields.join(',')).ok, false);
  });
});

describe('parseTelemetryLine & evaluateGpsValidity — conservative GPS validation', () => {
  it('marks GPS invalid when coordinates are (0, 0) even if satellites > 0', () => {
    const fields = NOMINAL_FLIGHT_FRAME.slice(0, -1).split(',');
    fields[8] = '0.0000';
    fields[9] = '0.0000';
    fields[11] = '8';
    const res = parseTelemetryLine(fields.join(','));
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.equal(res.packet.gpsValid, false);
    assert.equal(res.packet.gpsFixType, 'NO_FIX');
    assert.strictEqual(res.packet.latitude, null);
    assert.strictEqual(res.packet.longitude, null);
    assert.strictEqual(res.packet.gpsAltitude, null);
  });

  it('marks GPS invalid when satellites === 0 even if coordinates are non-zero', () => {
    const fields = NOMINAL_FLIGHT_FRAME.slice(0, -1).split(',');
    fields[11] = '0';
    const res = parseTelemetryLine(fields.join(','));
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.equal(res.packet.gpsValid, false);
    assert.equal(res.packet.gpsFixType, 'NO_FIX');
    assert.strictEqual(res.packet.latitude, null);
    assert.strictEqual(res.packet.longitude, null);
  });

  it('marks GPS invalid when latitude or longitude are out of geographic range', () => {
    const fieldsLatOut = NOMINAL_FLIGHT_FRAME.slice(0, -1).split(',');
    fieldsLatOut[8] = '95.1234';
    const resLat = parseTelemetryLine(fieldsLatOut.join(','));
    assert.equal(resLat.ok, true);
    if (resLat.ok) {
      assert.equal(resLat.packet.gpsValid, false);
      assert.strictEqual(resLat.packet.latitude, null);
      assert.strictEqual(resLat.packet.longitude, null);
    }

    const fieldsLonOut = NOMINAL_FLIGHT_FRAME.slice(0, -1).split(',');
    fieldsLonOut[9] = '-185.0000';
    const resLon = parseTelemetryLine(fieldsLonOut.join(','));
    assert.equal(resLon.ok, true);
    if (resLon.ok) {
      assert.equal(resLon.packet.gpsValid, false);
      assert.strictEqual(resLon.packet.latitude, null);
      assert.strictEqual(resLon.packet.longitude, null);
    }

    // Direct helper check
    assert.equal(evaluateGpsValidity(999.0, 999.0, 0, 5).gpsValid, false);
  });
});

describe('parseTelemetryLine — flight software state handling', () => {
  it('maps known equivalent flight states and preserves the exact transmitted label', () => {
    const fields = SAMPLE_HARDWARE_FRAME.slice(0, -1).split(',');

    fields[18] = 'LAUNCH_DETECT';
    const launchDetectRes = parseTelemetryLine(fields.join(','));
    assert.equal(launchDetectRes.ok, true);
    if (launchDetectRes.ok) {
      assert.equal(launchDetectRes.packet.fswStateName, 'LAUNCH_DETECT');
      assert.equal(launchDetectRes.packet.stateCode, FlightStateCode.ASCENT);
    }

    fields[18] = 'LANDED';
    const landedRes = parseTelemetryLine(fields.join(','));
    assert.equal(landedRes.ok, true);
    if (landedRes.ok) {
      assert.equal(landedRes.packet.fswStateName, 'LANDED');
      assert.equal(landedRes.packet.stateCode, FlightStateCode.IMPACT);
    }
  });

  it('safely represents unsupported/unmapped flight states without crashing or fabricating an enum code', () => {
    for (const unmappedState of ['IDLE', 'DEPLOY', 'CALIBRATING', 'APOGEE_WAIT']) {
      const fields = SAMPLE_HARDWARE_FRAME.slice(0, -1).split(',');
      fields[18] = unmappedState;
      const res = parseTelemetryLine(fields.join(','));
      assert.equal(res.ok, true);
      if (res.ok) {
        assert.equal(res.packet.fswStateName, unmappedState);
        assert.strictEqual(res.packet.stateCode, null);
      }
      assert.strictEqual(mapTransmitterStateToCode(unmappedState), null);
    }
  });

  it('rejects empty flight state strings', () => {
    const fields = SAMPLE_HARDWARE_FRAME.slice(0, -1).split(',');
    fields[18] = '';
    const res = parseTelemetryLine(fields.join(','));
    assert.equal(res.ok, false);
  });
});

describe('SerialLineBuffer — CR/LF variations, split chunks, and overflow protection', () => {
  it('handles CR (\\r), LF (\\n), and CRLF (\\r\\n) line endings without emitting empty lines', () => {
    const buf = new SerialLineBuffer(512);
    const res = buf.pushChunk(`${SAMPLE_HARDWARE_FRAME}\r${NOMINAL_FLIGHT_FRAME}\r\n${SAMPLE_HARDWARE_FRAME}\n`);
    assert.equal(res.overflowDiscardedCount, 0);
    assert.equal(res.lines.length, 3);
    assert.equal(res.lines[0], SAMPLE_HARDWARE_FRAME);
    assert.equal(res.lines[1], NOMINAL_FLIGHT_FRAME);
    assert.equal(res.lines[2], SAMPLE_HARDWARE_FRAME);
  });

  it('reassembles packets split across multiple arbitrary USB serial chunks including split CRLF', () => {
    const buf = new SerialLineBuffer(512);

    const part1 = SAMPLE_HARDWARE_FRAME.slice(0, 25);
    const part2 = SAMPLE_HARDWARE_FRAME.slice(25, 60);
    const part3 = `${SAMPLE_HARDWARE_FRAME.slice(60)}\r`;
    const part4 = `\n${NOMINAL_FLIGHT_FRAME.slice(0, 40)}`;
    const part5 = `${NOMINAL_FLIGHT_FRAME.slice(40)}\r`;

    assert.deepEqual(buf.pushChunk(part1).lines, []);
    assert.deepEqual(buf.pushChunk(part2).lines, []);

    const out1 = buf.pushChunk(part3);
    assert.deepEqual(out1.lines, [SAMPLE_HARDWARE_FRAME]);

    const out2 = buf.pushChunk(part4);
    assert.deepEqual(out2.lines, []);

    const out3 = buf.pushChunk(part5);
    assert.deepEqual(out3.lines, [NOMINAL_FLIGHT_FRAME]);
  });

  it('caps incomplete line length on overflow and recovers cleanly for the next frame', () => {
    const buf = new SerialLineBuffer(64);
    const hugeCorruptFrame = 'X'.repeat(200);

    const step1 = buf.pushChunk(hugeCorruptFrame);
    assert.equal(step1.lines.length, 0);
    assert.equal(buf.isOverflowing(), true);
    assert.equal(buf.getPendingLength(), 0);

    const step2 = buf.pushChunk(`\r${ SAMPLE_HARDWARE_FRAME.slice(0, 20) }\r`);
    assert.equal(step2.overflowDiscardedCount, 1);
    assert.deepEqual(step2.lines, [SAMPLE_HARDWARE_FRAME.slice(0, 20)]);
  });
});

describe('convertGnssUtcToIst & parseTelemetryLine — GNSS UTC to IST (+05:30) and reception time separation', () => {
  it('converts 00:00:00, 12:09:37, 18:45:00, and 23:59:59 from GNSS UTC to IST with minute/hour/midnight rollover', () => {
    const requiredCases: Array<{ utc: string; expectedIst: string }> = [
      { utc: '00:00:00', expectedIst: '05:30:00' },
      { utc: '12:09:37', expectedIst: '17:39:37' },
      { utc: '18:45:00', expectedIst: '00:15:00' },
      { utc: '23:59:59', expectedIst: '05:29:59' },
    ];

    for (const { utc, expectedIst } of requiredCases) {
      // Direct helper verification
      const converted = convertGnssUtcToIst(utc);
      assert.strictEqual(converted, expectedIst);
      // Must be time-of-day only (HH:MM:SS), never fabricating a date or day offset
      assert.match(converted!, /^\d{2}:\d{2}:\d{2}$/);

      // Full CSV frame parsing verification
      const fields = NOMINAL_FLIGHT_FRAME.slice(0, -1).split(',');
      fields[7] = utc;
      const frame = `${fields.join(',')},`;

      // Pass a distinct computer reception timestamp (e.g. 2026-10-17T09:11:22.000Z)
      const fixedComputerRxMs = Date.UTC(2026, 9, 17, 9, 11, 22);
      const parsed = parseTelemetryLine(frame, fixedComputerRxMs);
      assert.equal(parsed.ok, true);
      if (!parsed.ok) continue;

      // 1. Preserve received GNSS time exactly as the raw value
      assert.strictEqual(parsed.packet.timestampUtc, utc);
      // 2. Convert UTC to IST (+05:30) handling rollover across midnight
      assert.strictEqual(parsed.packet.gnssTimeIst, expectedIst);
      // 3. Keep computer packet-reception time strictly separate from GNSS time
      assert.strictEqual(parsed.packet.receivedAtMs, fixedComputerRxMs);
      assert.strictEqual(parsed.packet.receivedAtTimeStr, '09:11:22');
      assert.notEqual(parsed.packet.receivedAtTimeStr, parsed.packet.timestampUtc);
    }
  });

  it('returns null from convertGnssUtcToIst for malformed or out-of-range inputs', () => {
    assert.strictEqual(convertGnssUtcToIst(''), null);
    assert.strictEqual(convertGnssUtcToIst('24:00:00'), null);
    assert.strictEqual(convertGnssUtcToIst('12:60:00'), null);
    assert.strictEqual(convertGnssUtcToIst('12:00:60'), null);
    assert.strictEqual(convertGnssUtcToIst('2026-10-17T12:09:37Z'), null);
    assert.strictEqual(formatComputerTimeOfDayUtc(Date.UTC(2026, 9, 17, 14, 5, 9)), '14:05:09');
  });
});

describe('CAN-7USAT Flat-Sat Telemetry Dataset & Hardware Compatibility', () => {
  it('parses every frame from sample_telemetry.csv cleanly without errors', () => {
    const csvPath = fileURLToPath(
      new URL('../../../firmware/flat_sat_telemetry_test/sample_telemetry.csv', import.meta.url)
    );
    const content = fs.readFileSync(csvPath, 'utf-8');
    const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);

    assert.ok(lines.length >= 20, `Expected at least 20 sample packets, found ${lines.length}`);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const res = parseTelemetryLine(line);
      assert.equal(res.ok, true, `Line ${i + 1} failed to parse: ${res.ok ? '' : res.error} -> '${line}'`);
      if (!res.ok) continue;

      const p = res.packet;
      assert.equal(p.teamId, LIVE_TELEMETRY_TEAM_ID);
      assert.equal(p.packetNumber, i + 1);
      assert.equal(p.source, 'LIVE_SERIAL');
      assert.ok(Number.isFinite(p.altitude));
      assert.ok(Number.isFinite(p.pressure));
      assert.ok(Number.isFinite(p.rawPressurePa));
      assert.ok(Number.isFinite(p.temperature));
      assert.ok(Number.isFinite(p.batteryVoltage));
      assert.ok(p.timestampUtc !== null);
      assert.ok(Number.isFinite(p.accelX));
      assert.ok(Number.isFinite(p.accelY));
      assert.ok(Number.isFinite(p.accelZ));
      assert.ok(Number.isFinite(p.roll));
      assert.ok(Number.isFinite(p.pitch));
      assert.ok(Number.isFinite(p.spinRate));
    }
  });

  it('correctly maps TEST_MODE and LAUNCH_PAD flight states and converts Pa to hPa', () => {
    const csvPath = fileURLToPath(
      new URL('../../../firmware/flat_sat_telemetry_test/sample_telemetry.csv', import.meta.url)
    );
    const content = fs.readFileSync(csvPath, 'utf-8');
    const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);

    // Frame 1: TEST_MODE, bench rest, pressure 101325.00 Pa -> 1013.25 hPa
    const res1 = parseTelemetryLine(lines[0]);
    assert.equal(res1.ok, true);
    if (res1.ok) {
      assert.equal(res1.packet.fswStateName, 'TEST_MODE');
      assert.equal(res1.packet.stateCode, FlightStateCode.TEST_MODE);
      assert.strictEqual(res1.packet.rawPressurePa, 101325.0);
      assert.strictEqual(res1.packet.pressure, 1013.25);
      assert.strictEqual(res1.packet.batteryVoltage, 0.0);
      assert.strictEqual(res1.packet.timestampUtc, '00:00:00');
    }

    // Frame 16: LAUNCH_PAD
    const res16 = parseTelemetryLine(lines[15]);
    assert.equal(res16.ok, true);
    if (res16.ok) {
      assert.equal(res16.packet.fswStateName, 'LAUNCH_PAD');
      assert.equal(res16.packet.stateCode, FlightStateCode.LAUNCH_PAD);
    }
  });

  it('verifies GNSS no-fix frames are cleanly gated while retaining sensor attitude and altitude', () => {
    const csvPath = fileURLToPath(
      new URL('../../../firmware/flat_sat_telemetry_test/sample_telemetry.csv', import.meta.url)
    );
    const content = fs.readFileSync(csvPath, 'utf-8');
    const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);

    // Initial 5 frames: no GPS lock (00:00:00, 0,0, 0 sats)
    for (let i = 0; i < 5; i++) {
      const res = parseTelemetryLine(lines[i]);
      assert.equal(res.ok, true);
      if (!res.ok) continue;

      const p = res.packet;
      assert.equal(p.gpsValid, false);
      assert.equal(p.gpsFixType, 'NO_FIX');
      assert.strictEqual(p.latitude, null);
      assert.strictEqual(p.longitude, null);
      assert.strictEqual(p.gpsAltitude, null);
      assert.strictEqual(p.gpsSats, 0);

      // Raw zero coordinates are retained for audit
      assert.strictEqual(p.rawLatitude, 0);
      assert.strictEqual(p.rawLongitude, 0);

      // Vital attitude and barometer telemetry are fully intact
      assert.ok(Math.abs(p.accelZ! - 9.81) < 0.1);
      assert.strictEqual(p.fswStateName, 'TEST_MODE');
      assert.strictEqual(p.stateCode, FlightStateCode.TEST_MODE);
    }
  });

  it('verifies 3D GNSS lock frames calculate valid fix, IST time conversion, and orientation dynamics', () => {
    const csvPath = fileURLToPath(
      new URL('../../../firmware/flat_sat_telemetry_test/sample_telemetry.csv', import.meta.url)
    );
    const content = fs.readFileSync(csvPath, 'utf-8');
    const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);

    // Frame 6 (index 5): Locked GPS at 07:15:31 UTC -> 12:45:31 IST
    const res6 = parseTelemetryLine(lines[5]);
    assert.equal(res6.ok, true);
    if (res6.ok) {
      const p = res6.packet;
      assert.equal(p.gpsValid, true);
      assert.equal(p.gpsFixType, '3D');
      assert.strictEqual(p.gpsSats, 8);
      assert.strictEqual(p.latitude, 13.352512);
      assert.strictEqual(p.longitude, 74.792835);
      assert.strictEqual(p.gpsAltitude, 65.4);
      assert.strictEqual(p.timestampUtc, '07:15:31');
      assert.strictEqual(p.gnssTimeIst, '12:45:31');
    }

    // Frame 12 (index 11): Movement frame with tilt (~14.85° roll, ~-10.12° pitch, 2.40°/s spin)
    const res12 = parseTelemetryLine(lines[11]);
    assert.equal(res12.ok, true);
    if (res12.ok) {
      const p = res12.packet;
      assert.strictEqual(p.altitude, 0.52);
      assert.strictEqual(p.roll, 14.85);
      assert.strictEqual(p.pitch, -10.12);
      assert.strictEqual(p.spinRate, 2.4);
      assert.strictEqual(p.accelX, 2.45);
      assert.strictEqual(p.accelY, -1.7);
      assert.strictEqual(p.accelZ, 9.25);
    }
  });
});

describe('CAN7USAT_FSW.ino 24-Field KEY=VALUE & SD CSV Contract Verification', () => {
  const SAMPLE_FSW_KV_PAD_NO_FIX =
    'TEAM_ID=2026-IN-SPACe-CAN-7USAT-017,MISSION_TIME_S=4,PACKET_COUNT=4,BARO_ALT_M=0.12,PRESSURE_PA=100845.20,BARO_TEMP_C=27.45,BATTERY_V=8.18,GPS_TIME_UTC=UNAVAILABLE,LAT_DEG=0.0000000,LON_DEG=0.0000000,GPS_ALT_MSL_M=0.00,SATELLITES=0,ACCEL_X_MPS2=0.042,ACCEL_Y_MPS2=-0.018,ACCEL_Z_MPS2=9.805,ROLL_DEG=0.45,PITCH_DEG=-0.30,GYRO_Z_RADPS=0.0012,LEFT_SERVO_DEG=90.0,RIGHT_SERVO_DEG=90.0,BURNWIRE_MOSFET=0,BUZZER_MOSFET=0,FLYWHEEL_RPM=0,FLIGHT_STATE=LAUNCH_PAD';

  const SAMPLE_FSW_KV_GUIDED =
    'TEAM_ID=2026-IN-SPACe-CAN-7USAT-017,MISSION_TIME_S=92,PACKET_COUNT=92,BARO_ALT_M=540.80,PRESSURE_PA=94920.50,BARO_TEMP_C=23.10,BATTERY_V=7.84,GPS_TIME_UTC=14:22:09,LAT_DEG=13.3525120,LON_DEG=74.7928350,GPS_ALT_MSL_M=595.80,SATELLITES=9,ACCEL_X_MPS2=0.310,ACCEL_Y_MPS2=-0.220,ACCEL_Z_MPS2=9.760,ROLL_DEG=3.25,PITCH_DEG=-1.85,GYRO_Z_RADPS=1.4250,LEFT_SERVO_DEG=90.0,RIGHT_SERVO_DEG=45.0,BURNWIRE_MOSFET=0,BUZZER_MOSFET=0,FLYWHEEL_RPM=6000,FLIGHT_STATE=PRECISION_GUIDE';

  it('parses 24-field KEY=VALUE pre-lock frame with GPS_TIME_UTC=UNAVAILABLE and gates (0,0) coordinates', () => {
    const res = parseTelemetryLine(SAMPLE_FSW_KV_PAD_NO_FIX, 1700000004000);
    assert.equal(res.ok, true);
    if (!res.ok) return;

    const p = res.packet;
    assert.strictEqual(p.packetFormat, 'FSW_KV_24');
    assert.strictEqual(p.teamId, LIVE_TELEMETRY_TEAM_ID);
    assert.strictEqual(p.missionTimeSeconds, 4);
    assert.strictEqual(p.packetNumber, 4);
    assert.strictEqual(p.altitude, 0.12);
    assert.strictEqual(p.rawPressurePa, 100845.2);
    assert.ok(Math.abs(p.pressure! - 1008.452) < 1e-6);
    assert.strictEqual(p.temperature, 27.45);
    assert.strictEqual(p.batteryVoltage, 8.18);
    assert.strictEqual(p.timestampUtc, 'UNAVAILABLE');
    assert.strictEqual(p.gnssTimeIst, null);
    assert.strictEqual(p.gpsValid, false);
    assert.strictEqual(p.gpsFixType, 'NO_FIX');
    assert.strictEqual(p.latitude, null);
    assert.strictEqual(p.longitude, null);
    assert.strictEqual(p.gpsAltitude, null);
    assert.strictEqual(p.gpsSats, 0);
    assert.strictEqual(p.leftServoDeg, 90.0);
    assert.strictEqual(p.rightServoDeg, 90.0);
    assert.strictEqual(p.derivedSteering, 0);
    assert.strictEqual(p.burnwireActive, false);
    assert.strictEqual(p.buzzerMosfet, false);
    assert.strictEqual(p.audioBeaconActive, false);
    assert.strictEqual(p.wheelRpm, 0);
    assert.strictEqual(p.fswStateName, 'LAUNCH_PAD');
    assert.strictEqual(p.stateCode, FlightStateCode.LAUNCH_PAD);
    assert.strictEqual(p.fswStateIndex, 1);
  });

  it('parses 24-field KEY=VALUE guided descent frame with actuator states, 6000 RPM flywheel, and derived steering', () => {
    const res = parseTelemetryLine(SAMPLE_FSW_KV_GUIDED, 1700000092000);
    assert.equal(res.ok, true);
    if (!res.ok) return;

    const p = res.packet;
    assert.strictEqual(p.packetFormat, 'FSW_KV_24');
    assert.strictEqual(p.timestampUtc, '14:22:09');
    assert.strictEqual(p.gnssTimeIst, '19:52:09');
    assert.strictEqual(p.gpsValid, true);
    assert.strictEqual(p.gpsFixType, '3D');
    assert.strictEqual(p.latitude, 13.352512);
    assert.strictEqual(p.longitude, 74.792835);
    assert.strictEqual(p.gpsAltitude, 595.8);
    assert.strictEqual(p.gpsSats, 9);
    assert.strictEqual(p.roll, 3.25);
    assert.strictEqual(p.pitch, -1.85);
    assert.strictEqual(p.spinRate, 1.425);
    assert.strictEqual(p.gyroZRadps, 1.425);
    assert.strictEqual(p.yaw, null);
    assert.strictEqual(p.leftServoDeg, 90.0);
    assert.strictEqual(p.rightServoDeg, 45.0);
    assert.strictEqual(p.derivedSteering, 0.5);
    assert.strictEqual(p.burnwireActive, false);
    assert.strictEqual(p.buzzerMosfet, false);
    assert.strictEqual(p.wheelRpm, 6000);
    assert.strictEqual(p.fswStateName, 'PRECISION_GUIDE');
    assert.strictEqual(p.stateCode, FlightStateCode.PRECISION_GUIDANCE);
    assert.strictEqual(p.fswStateIndex, 5);
  });

  it('parses 24-field positional CSV lines from logDataToSD() and ignores the SD CSV header row', () => {
    const headerRow = FSW_TELEMETRY_KEYS.join(',');
    const headerRes = parseTelemetryLine(headerRow);
    assert.equal(headerRes.ok, false);

    const sdCsvRow =
      '2026-IN-SPACe-CAN-7USAT-017,75,75,698.40,93120.00,22.40,7.92,14:21:52,13.3524000,74.7927000,753.40,8,0.120,-0.080,9.810,1.20,-0.90,0.4500,90.0,90.0,1,0,0,PARAFOIL_DEPLOY';
    const res = parseTelemetryLine(sdCsvRow, 1700000075000);
    assert.equal(res.ok, true);
    if (!res.ok) return;

    assert.strictEqual(res.packet.packetFormat, 'FSW_CSV_24');
    assert.strictEqual(res.packet.burnwireActive, true);
    assert.strictEqual(res.packet.buzzerMosfet, false);
    assert.strictEqual(res.packet.wheelRpm, 0);
    assert.strictEqual(res.packet.fswStateName, 'PARAFOIL_DEPLOY');
    assert.strictEqual(res.packet.stateCode, FlightStateCode.PARAFOIL_DEPLOYMENT);
    assert.strictEqual(res.packet.fswStateIndex, 4);
  });

  it('maps all 10 firmware states (wire names & enum names) and keeps UNKNOWN unmapped', () => {
    const expectedMappings: Array<{
      name: string;
      code: FlightStateCode;
      fswIdx: number;
    }> = [
      { name: 'BOOT', code: FlightStateCode.BOOT, fswIdx: 0 },
      { name: 'LAUNCH_PAD', code: FlightStateCode.LAUNCH_PAD, fswIdx: 1 },
      { name: 'ASCENT', code: FlightStateCode.ASCENT, fswIdx: 2 },
      { name: 'DROGUE_DESCENT', code: FlightStateCode.DESCENT, fswIdx: 3 },
      { name: 'PARAFOIL_DEPLOY', code: FlightStateCode.PARAFOIL_DEPLOYMENT, fswIdx: 4 },
      { name: 'PARAFOIL_DEPLOYMENT', code: FlightStateCode.PARAFOIL_DEPLOYMENT, fswIdx: 4 },
      { name: 'PRECISION_GUIDE', code: FlightStateCode.PRECISION_GUIDANCE, fswIdx: 5 },
      { name: 'PRECISION_GUIDANCE', code: FlightStateCode.PRECISION_GUIDANCE, fswIdx: 5 },
      { name: 'TERMINAL_LOITER', code: FlightStateCode.TERMINAL_GUIDANCE, fswIdx: 6 },
      { name: 'TERMINAL_GUIDANCE', code: FlightStateCode.TERMINAL_GUIDANCE, fswIdx: 6 },
      { name: 'FINAL_APPROACH', code: FlightStateCode.FINAL_APPROACH, fswIdx: 7 },
      { name: 'LANDED', code: FlightStateCode.IMPACT, fswIdx: 8 },
      { name: 'LANDING', code: FlightStateCode.IMPACT, fswIdx: 8 },
      { name: 'FAILSAFE', code: FlightStateCode.FAILSAFE, fswIdx: 9 },
    ];

    for (const item of expectedMappings) {
      assert.strictEqual(mapTransmitterStateToCode(item.name), item.code, `State code mismatch for ${item.name}`);
      assert.strictEqual(mapFirmwareStateIndex(item.name), item.fswIdx, `FSW index mismatch for ${item.name}`);
    }

    assert.strictEqual(mapTransmitterStateToCode('UNKNOWN'), null);
    assert.strictEqual(mapFirmwareStateIndex('UNKNOWN'), null);
  });

  it('rejects 24-field KEY=VALUE lines with out-of-order or unknown keys or non-binary MOSFET flags', () => {
    const wrongKeyLine = SAMPLE_FSW_KV_GUIDED.replace('LEFT_SERVO_DEG=90.0', 'WRONG_KEY=90.0');
    const resWrongKey = parseTelemetryLine(wrongKeyLine);
    assert.equal(resWrongKey.ok, false);

    const invalidMosfetLine = SAMPLE_FSW_KV_GUIDED.replace('BURNWIRE_MOSFET=0', 'BURNWIRE_MOSFET=2');
    const resBadMosfet = parseTelemetryLine(invalidMosfetLine);
    assert.equal(resBadMosfet.ok, false);
  });

  it('parses firmware ACK and ERR control lines via parseFirmwareControlLine and derives servo steering', () => {
    assert.strictEqual(deriveSteeringFromServos(90, 90), 0);
    assert.strictEqual(deriveSteeringFromServos(0, 90), -1);
    assert.strictEqual(deriveSteeringFromServos(90, 0), 1);

    const gpsAck = parseFirmwareControlLine(
      'ACK:TARGET_GPS=13.3490000,74.7921000,EAST_M=-75.4,NORTH_M=-389.2\r\n'
    );
    assert.ok(gpsAck !== null);
    assert.strictEqual(gpsAck?.kind, 'ACK');
    assert.strictEqual(gpsAck?.category, 'TARGET_GPS');
    assert.strictEqual(gpsAck?.targetLatDeg, 13.349);
    assert.strictEqual(gpsAck?.targetLonDeg, 74.7921);

    const stateAck = parseFirmwareControlLine('ACK:STATE=PRECISION_GUIDE');
    assert.ok(stateAck !== null);
    assert.strictEqual(stateAck?.category, 'STATE');
    assert.strictEqual(stateAck?.stateName, 'PRECISION_GUIDE');

    const errMsg = parseFirmwareControlLine('ERR:TARGET_GPS_INVALID');
    assert.ok(errMsg !== null);
    assert.strictEqual(errMsg?.kind, 'ERR');
    assert.strictEqual(errMsg?.category, 'TARGET_GPS');

    assert.strictEqual(parseFirmwareControlLine(SAMPLE_FSW_KV_GUIDED), null);
  });
});

describe('flight-software-integrated/CAN7USAT_FSW.ino 32-Field v2 Continuous-Rotation Spool Telemetry Contract', () => {
  const SAMPLE_FSW_V2_KV_UNCAL_LOCKED =
    'TEAM_ID=2026-IN-SPACe-CAN-7USAT-017,MISSION_TIME_S=14,PACKET_COUNT=14,BARO_ALT_M=0.10,PRESSURE_PA=100850.00,BARO_TEMP_C=27.50,BATTERY_V=8.16,GPS_TIME_UTC=UNAVAILABLE,LAT_DEG=0.0000000,LON_DEG=0.0000000,GPS_ALT_MSL_M=0.00,SATELLITES=0,ACCEL_X_MPS2=0.020,ACCEL_Y_MPS2=-0.010,ACCEL_Z_MPS2=9.806,ROLL_DEG=0.20,PITCH_DEG=-0.15,GYRO_Z_RADPS=0.0005,LEFT_BRAKE_CMD=0.000,RIGHT_BRAKE_CMD=0.000,LEFT_SPOOL_DIR=STOP,RIGHT_SPOOL_DIR=STOP,LEFT_SERVO_US=1500,RIGHT_SERVO_US=1500,LEFT_EST_PULL_MM=UNCAL,RIGHT_EST_PULL_MM=UNCAL,ACTUATOR_CAL=UNCAL_LOCKED,ACTUATOR_FAULT=UNCALIBRATED,BURNWIRE_MOSFET=0,BUZZER_MOSFET=0,FLYWHEEL_RPM=0,FLIGHT_STATE=LAUNCH_PAD';

  const SAMPLE_FSW_V2_KV_CALIBRATED_GUIDED =
    'TEAM_ID=2026-IN-SPACe-CAN-7USAT-017,MISSION_TIME_S=98,PACKET_COUNT=98,BARO_ALT_M=485.20,PRESSURE_PA=95410.00,BARO_TEMP_C=22.80,BATTERY_V=7.78,GPS_TIME_UTC=14:22:15,LAT_DEG=13.3526100,LON_DEG=74.7929100,GPS_ALT_MSL_M=540.20,SATELLITES=10,ACCEL_X_MPS2=0.180,ACCEL_Y_MPS2=-0.140,ACCEL_Z_MPS2=9.790,ROLL_DEG=2.10,PITCH_DEG=-1.40,GYRO_Z_RADPS=1.1800,LEFT_BRAKE_CMD=0.000,RIGHT_BRAKE_CMD=0.500,LEFT_SPOOL_DIR=STOP,RIGHT_SPOOL_DIR=WIND,LEFT_SERVO_US=1500,RIGHT_SERVO_US=1360,LEFT_EST_PULL_MM=0.0,RIGHT_EST_PULL_MM=4.0,ACTUATOR_CAL=CALIBRATED,ACTUATOR_FAULT=NONE,BURNWIRE_MOSFET=0,BUZZER_MOSFET=0,FLYWHEEL_RPM=6000,FLIGHT_STATE=PRECISION_GUIDE';

  it('parses 32-field KEY=VALUE v2 frame in default UNCAL_LOCKED state without fabricating servo degrees or pull mm', () => {
    const res = parseTelemetryLine(SAMPLE_FSW_V2_KV_UNCAL_LOCKED, 1700000014000);
    assert.equal(res.ok, true);
    if (!res.ok) return;

    const p = res.packet;
    assert.strictEqual(p.packetFormat, 'FSW_KV_32');
    assert.strictEqual(p.leftServoDeg, null);
    assert.strictEqual(p.rightServoDeg, null);
    assert.strictEqual(p.leftBrakeCmd, 0);
    assert.strictEqual(p.rightBrakeCmd, 0);
    assert.strictEqual(p.derivedSteering, 0);
    assert.strictEqual(p.leftSpoolDir, 'STOP');
    assert.strictEqual(p.rightSpoolDir, 'STOP');
    assert.strictEqual(p.leftServoUs, 1500);
    assert.strictEqual(p.rightServoUs, 1500);
    assert.strictEqual(p.leftEstPullMm, null);
    assert.strictEqual(p.rightEstPullMm, null);
    assert.strictEqual(p.actuatorCalStatus, 'UNCAL_LOCKED');
    assert.strictEqual(p.actuatorFault, 'UNCALIBRATED');
    assert.strictEqual(p.burnwireActive, false);
    assert.strictEqual(p.buzzerMosfet, false);
    assert.strictEqual(p.wheelRpm, 0);
    assert.strictEqual(p.fswStateName, 'LAUNCH_PAD');
    assert.strictEqual(p.stateCode, FlightStateCode.LAUNCH_PAD);
  });

  it('parses 32-field KEY=VALUE v2 frame in CALIBRATED guided descent with open-loop pull estimates and PWM us', () => {
    const res = parseTelemetryLine(SAMPLE_FSW_V2_KV_CALIBRATED_GUIDED, 1700000098000);
    assert.equal(res.ok, true);
    if (!res.ok) return;

    const p = res.packet;
    assert.strictEqual(p.packetFormat, 'FSW_KV_32');
    assert.strictEqual(p.leftServoDeg, null);
    assert.strictEqual(p.rightServoDeg, null);
    assert.strictEqual(p.leftBrakeCmd, 0);
    assert.strictEqual(p.rightBrakeCmd, 0.5);
    assert.strictEqual(p.derivedSteering, 0.5);
    assert.strictEqual(p.leftSpoolDir, 'STOP');
    assert.strictEqual(p.rightSpoolDir, 'WIND');
    assert.strictEqual(p.leftServoUs, 1500);
    assert.strictEqual(p.rightServoUs, 1360);
    assert.strictEqual(p.leftEstPullMm, 0);
    assert.strictEqual(p.rightEstPullMm, 4.0);
    assert.strictEqual(p.actuatorCalStatus, 'CALIBRATED');
    assert.strictEqual(p.actuatorFault, 'NONE');
    assert.strictEqual(p.wheelRpm, 6000);
    assert.strictEqual(p.fswStateName, 'PRECISION_GUIDE');
    assert.strictEqual(p.stateCode, FlightStateCode.PRECISION_GUIDANCE);
  });

  it('parses 32-field positional CSV lines from logDataToSD() and ignores the 32-field CSV header row', () => {
    const headerRow = FSW_V2_TELEMETRY_KEYS.join(',');
    assert.equal(parseTelemetryLine(headerRow).ok, false);

    const sdCsv32Row =
      '2026-IN-SPACe-CAN-7USAT-017,99,99,480.00,95450.00,22.70,7.77,14:22:16,13.3526200,74.7929200,535.00,10,0.150,-0.120,9.800,1.80,-1.10,1.1000,0.250,0.000,RELEASE,STOP,1605,1500,2.5,0.0,CALIBRATED,BURST_CAP_REACHED,0,0,6000,TERMINAL_LOITER';
    const res = parseTelemetryLine(sdCsv32Row, 1700000099000);
    assert.equal(res.ok, true);
    if (!res.ok) return;

    const p = res.packet;
    assert.strictEqual(p.packetFormat, 'FSW_CSV_32');
    assert.strictEqual(p.leftBrakeCmd, 0.25);
    assert.strictEqual(p.rightBrakeCmd, 0);
    assert.strictEqual(p.derivedSteering, -0.25);
    assert.strictEqual(p.leftSpoolDir, 'RELEASE');
    assert.strictEqual(p.rightSpoolDir, 'STOP');
    assert.strictEqual(p.leftServoUs, 1605);
    assert.strictEqual(p.rightServoUs, 1500);
    assert.strictEqual(p.leftEstPullMm, 2.5);
    assert.strictEqual(p.rightEstPullMm, 0);
    assert.strictEqual(p.actuatorCalStatus, 'CALIBRATED');
    assert.strictEqual(p.actuatorFault, 'BURST_CAP_REACHED');
    assert.strictEqual(p.fswStateName, 'TERMINAL_LOITER');
    assert.strictEqual(p.stateCode, FlightStateCode.TERMINAL_GUIDANCE);
  });

  it('rejects malformed v2 spool direction, out-of-range brake command, or invalid calibration status', () => {
    const badDir = SAMPLE_FSW_V2_KV_CALIBRATED_GUIDED.replace('RIGHT_SPOOL_DIR=WIND', 'RIGHT_SPOOL_DIR=SPIN');
    assert.equal(parseTelemetryLine(badDir).ok, false);

    const badBrake = SAMPLE_FSW_V2_KV_CALIBRATED_GUIDED.replace('RIGHT_BRAKE_CMD=0.500', 'RIGHT_BRAKE_CMD=1.500');
    assert.equal(parseTelemetryLine(badBrake).ok, false);

    const badCal = SAMPLE_FSW_V2_KV_CALIBRATED_GUIDED.replace('ACTUATOR_CAL=CALIBRATED', 'ACTUATOR_CAL=UNKNOWN');
    assert.equal(parseTelemetryLine(badCal).ok, false);
  });

  it('parses ACK:SPOOL= and ERR:SPOOL= control responses from flight-software-integrated', () => {
    const spoolAck = parseFirmwareControlLine('ACK:SPOOL=ZERO_NEUTRAL');
    assert.ok(spoolAck !== null);
    assert.strictEqual(spoolAck?.kind, 'ACK');
    assert.strictEqual(spoolAck?.category, 'SPOOL');
    assert.strictEqual(spoolAck?.payload, 'SPOOL=ZERO_NEUTRAL');

    const spoolErr = parseFirmwareControlLine('ERR:SPOOL=JOG_REJECTED');
    assert.ok(spoolErr !== null);
    assert.strictEqual(spoolErr?.kind, 'ERR');
    assert.strictEqual(spoolErr?.category, 'SPOOL');
  });
});


