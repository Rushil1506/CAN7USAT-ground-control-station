import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  convertGnssUtcToIst,
  evaluateGpsValidity,
  formatComputerTimeOfDayUtc,
  LIVE_TELEMETRY_TEAM_ID,
  mapTransmitterStateToCode,
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

