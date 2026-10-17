import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  DEFAULT_PREDICTOR_CONFIG,
  LANDING_ACCURACY_DISCLAIMER,
  PredictionResponsePayload,
  PredictorConfigPayload,
  calculateHaversineDistanceM,
  computeLocalPhysicsPrediction,
  enuToLatLon,
  evaluateLandingPredictionWithBackend,
  isValidCoordinateFix,
  latLonToEnu,
  resolvePacketTimestampSeconds,
} from '../landingPredictorClient';
import { FlightStateCode, TelemetryPacket, TelemetrySource } from '../../types';

const LAUNCH_LAT = 13.3525;
const LAUNCH_LON = 74.7928;

function makeDescentPacket(
  step: number,
  altM: number,
  eastM: number,
  northM: number,
  overrides: Partial<TelemetryPacket> = {}
): TelemetryPacket {
  const [lat, lon] = enuToLatLon(eastM, northM, LAUNCH_LAT, LAUNCH_LON);
  return {
    source: 'SIMULATION',
    receivedAtMs: 1_700_000_000_000 + step * 1000,
    teamId: '2026-IN-SPACe-CAN-7USAT-017',
    packetNumber: step + 1,
    missionTimeSeconds: step,
    timestampUtc: '12:00:00',
    gnssTimeIst: '17:30:00',
    altitude: altM,
    velocity: -2.5,
    acceleration: 1.0,
    accelX: 0,
    accelY: 0,
    accelZ: 9.81,
    spinRate: 0,
    wheelRpm: 0,
    roll: 0,
    pitch: 0,
    yaw: 0,
    latitude: lat,
    longitude: lon,
    gpsAltitude: altM + 55.0,
    gpsSats: 9,
    gpsFixType: '3D',
    gpsValid: true,
    co2: null,
    pm2_5: null,
    uv: null,
    humidity: 55,
    temperature: 26,
    pressure: 1005,
    batteryVoltage: 7.8,
    currentDraw: null,
    power: null,
    batterySoc: 85,
    rssi: -70,
    stateCode: FlightStateCode.AEROBREAK_RELEASE,
    fswStateName: 'DESCENT',
    l1Connected: true,
    l2Connected: null,
    deployed: true,
    audioBeaconActive: false,
    gsmModuleActive: false,
    ...overrides,
  };
}

function resolvePythonExecutable(): string {
  const venvCandidate = path.resolve(
    process.cwd(),
    '..',
    '..',
    'Precision Landing Algo',
    '.venv',
    'Scripts',
    'python.exe'
  );
  if (fs.existsSync(venvCandidate)) {
    return venvCandidate;
  }
  return 'python';
}

function evaluatePythonPredictor(
  historyPackets: TelemetryPacket[],
  config: PredictorConfigPayload,
  telemetrySource: TelemetrySource,
  packetAgeSeconds: number | null,
  isStaleOverride = false
): PredictionResponsePayload {
  const pythonExe = resolvePythonExecutable();
  const sourceLabel: 'LIVE' | 'SIMULATION' =
    telemetrySource === 'LIVE_SERIAL' ? 'LIVE' : 'SIMULATION';

  const pointsPayload = historyPackets.slice(-150).map((pkt) => ({
    timestamp_s: resolvePacketTimestampSeconds(pkt, telemetrySource),
    lat_deg: pkt.latitude ?? 0.0,
    lon_deg: pkt.longitude ?? 0.0,
    baro_altitude_m: pkt.altitude,
    gps_altitude_amsl_m: pkt.gpsAltitude,
    gps_valid:
      pkt.gpsValid !== false &&
      pkt.gpsFixType !== 'NO_FIX' &&
      (typeof pkt.gpsSats !== 'number' || pkt.gpsSats > 0) &&
      isValidCoordinateFix(pkt.latitude, pkt.longitude, true),
    vertical_speed_Telemetry_ms: pkt.velocity,
    source: sourceLabel,
  }));

  let latestValidTs = 0.0;
  for (const pt of pointsPayload) {
    if (pt.gps_valid && Number.isFinite(pt.timestamp_s)) {
      latestValidTs = pt.timestamp_s;
    }
  }
  const rawAgeS =
    packetAgeSeconds !== null && Number.isFinite(packetAgeSeconds)
      ? Math.max(0.0, packetAgeSeconds)
      : 0.0;
  const effectiveAgeS = isStaleOverride
    ? Math.max(config.stale_threshold_seconds + 1.0, rawAgeS)
    : rawAgeS;
  const evaluationTimeS = latestValidTs + effectiveAgeS;

  const pyScript = `
import json, sys
from predictor_service.predictor_engine import PhysicsBaselinePredictor, PredictorConfig, TelemetryPointInput

payload = json.loads(sys.stdin.read())
cfg = PredictorConfig.from_dict(payload["config"])
predictor = PhysicsBaselinePredictor(config=cfg)
points = [TelemetryPointInput.from_dict(p) for p in payload["points"]]
for pt in points:
    predictor.ingest_point(pt)
res = predictor.predict_current(source=payload["source"], evaluation_time_s=payload["evaluation_time_s"])
print(json.dumps(res.to_dict()))
`;

  const stdout = execFileSync(pythonExe, ['-c', pyScript], {
    cwd: process.cwd(),
    input: JSON.stringify({
      config,
      points: pointsPayload,
      source: sourceLabel,
      evaluation_time_s: evaluationTimeS,
    }),
    encoding: 'utf-8',
  });

  return JSON.parse(stdout.trim()) as PredictionResponsePayload;
}

describe('landingPredictorClient — Stage 3 ENU Physics & Validity Gates', () => {
  it('computes accurate landing coordinate on constant ground velocity trajectory', () => {
    const startAlt = 300.0;
    const vDesc = 2.5;
    const vEast = 4.5;
    const vNorth = -3.0;
    const totalTime = startAlt / vDesc; // 120 s
    const [trueLat, trueLon] = enuToLatLon(
      vEast * totalTime,
      vNorth * totalTime,
      LAUNCH_LAT,
      LAUNCH_LON
    );

    const packets: TelemetryPacket[] = [];
    for (let s = 0; s <= 40; s++) {
      packets.push(
        makeDescentPacket(
          s,
          startAlt - vDesc * s,
          vEast * s,
          vNorth * s
        )
      );
    }

    const res = computeLocalPhysicsPrediction(
      packets,
      DEFAULT_PREDICTOR_CONFIG,
      'SIMULATION',
      0.0
    );

    assert.equal(res.valid, true);
    assert.equal(res.is_calibrated_probability, false);
    assert.equal(res.landing_accuracy_warning, LANDING_ACCURACY_DISCLAIMER);
    assert.equal(res.input_trajectory_stability_tier, 'HIGH');
    assert.ok(res.prediction !== null);

    const errM = calculateHaversineDistanceM(
      res.prediction.predicted_lat_deg,
      res.prediction.predicted_lon_deg,
      trueLat,
      trueLon
    );
    assert.ok(errM < 0.05, `Expected horizontal error < 0.05 m, got ${errM} m`);
  });

  it('degrades stability tier and score under noisy GPS fixes without claiming HIGH quality', () => {
    const startAlt = 300.0;
    const vDesc = 2.5;
    const vEast = 4.5;
    const vNorth = -3.0;

    // Deterministic sinusoidal/alternating 2.0 m horizontal jitter
    const jitterOffsets = [2.1, -1.9, 1.8, -2.2, 2.0, -1.7, 2.3, -2.0, 1.9, -2.1];
    const packets: TelemetryPacket[] = [];
    for (let s = 0; s <= 30; s++) {
      const j = jitterOffsets[s % jitterOffsets.length];
      packets.push(
        makeDescentPacket(
          s,
          startAlt - vDesc * s,
          vEast * s + j,
          vNorth * s - j
        )
      );
    }

    const res = computeLocalPhysicsPrediction(
      packets,
      DEFAULT_PREDICTOR_CONFIG,
      'SIMULATION',
      0.0
    );

    assert.equal(res.valid, true);
    assert.notEqual(res.input_trajectory_stability_tier, 'HIGH');
    assert.ok(res.input_trajectory_stability_score < 0.7);
    assert.ok(res.trajectory_metrics !== null);
    assert.ok(res.trajectory_metrics.window_position_rmse_m > 1.5);
    assert.ok(res.trajectory_metrics.extrapolated_position_std_error_m > 10.0);
  });

  it('gates out invalid (0,0) GPS fixes, stale telemetry, and non-descending states', () => {
    const zeroGpsPackets = [
      makeDescentPacket(0, 200, 0, 0, { latitude: 0, longitude: 0 }),
      makeDescentPacket(1, 197, 0, 0, { latitude: 0, longitude: 0 }),
      makeDescentPacket(2, 195, 0, 0, { latitude: 0, longitude: 0 }),
    ];
    const resZero = computeLocalPhysicsPrediction(
      zeroGpsPackets,
      DEFAULT_PREDICTOR_CONFIG,
      'LIVE_SERIAL',
      0.2
    );
    assert.equal(resZero.valid, false);
    assert.equal(resZero.reason_code, 'NO_VALID_GPS_FIX');
    assert.equal(resZero.prediction, null);

    // Stale telemetry check
    const validPackets = [
      makeDescentPacket(0, 200, 10, 10),
      makeDescentPacket(1, 197.5, 14.5, 7),
      makeDescentPacket(2, 195.0, 19.0, 4),
      makeDescentPacket(3, 192.5, 23.5, 1),
    ];
    const resStale = computeLocalPhysicsPrediction(
      validPackets,
      DEFAULT_PREDICTOR_CONFIG,
      'LIVE_SERIAL',
      4.5
    );
    assert.equal(resStale.valid, false);
    assert.equal(resStale.reason_code, 'TELEMETRY_STALE');
    assert.equal(resStale.prediction, null);

    // Ascending check
    const climbingPackets = [
      makeDescentPacket(0, 100, 10, 10),
      makeDescentPacket(1, 115, 12, 12),
      makeDescentPacket(2, 130, 14, 14),
      makeDescentPacket(3, 145, 16, 16),
    ];
    const resClimb = computeLocalPhysicsPrediction(
      climbingPackets,
      DEFAULT_PREDICTOR_CONFIG,
      'SIMULATION',
      0.0
    );
    assert.equal(resClimb.valid, false);
    assert.equal(resClimb.reason_code, 'NOT_DESCENDING');
    assert.equal(resClimb.prediction, null);
  });

  it('independently computes Stage 1 and Stage 2 time-to-landing in TWO_STAGE_CONFIGURABLE mode', () => {
    // Descending at 17.0 m/s from 840 m down to 670 m (above 500 m disreef)
    const stage1Packets: TelemetryPacket[] = [];
    for (let s = 0; s <= 10; s++) {
      stage1Packets.push(
        makeDescentPacket(s, 840.0 - 17.0 * s, 3.2 * s, 1.8 * s)
      );
    }

    const res2Stage = computeLocalPhysicsPrediction(
      stage1Packets,
      {
        ...DEFAULT_PREDICTOR_CONFIG,
        propagation_mode: 'TWO_STAGE_CONFIGURABLE',
        disreef_transition_altitude_m: 500.0,
        stage1_nominal_descent_rate_ms: 17.0,
        stage2_nominal_descent_rate_ms: 2.2,
      },
      'SIMULATION',
      0.0
    );

    assert.equal(res2Stage.valid, true);
    assert.ok(res2Stage.prediction !== null);
    assert.equal(res2Stage.prediction.stage1_time_remaining_s, 10.0);
    assert.ok(
      Math.abs((res2Stage.prediction.stage2_time_remaining_s ?? 0) - 500.0 / 2.2) < 0.05
    );
    assert.ok(
      Math.abs(
        res2Stage.prediction.estimated_time_to_landing_s - (10.0 + 500.0 / 2.2)
      ) < 0.05
    );

    // ENU round-trip check
    const [e, n] = latLonToEnu(13.355, 74.795, LAUNCH_LAT, LAUNCH_LON);
    const [latBack, lonBack] = enuToLatLon(e, n, LAUNCH_LAT, LAUNCH_LON);
    assert.ok(Math.abs(latBack - 13.355) < 1e-9);
    assert.ok(Math.abs(lonBack - 74.795) < 1e-9);
  });

  it('maintains strict parity between Python predictor engine and TypeScript fallback across all modes and gates', () => {
    // 1. Constant ground velocity (OBSERVED_RATE, BARO_PREFERRED, with target coordinates)
    const nominalPackets: TelemetryPacket[] = [];
    for (let s = 0; s <= 15; s++) {
      nominalPackets.push(
        makeDescentPacket(s, 420.0 - 2.4 * s, 4.1 * s, -2.7 * s)
      );
    }
    const cfgWithTarget: PredictorConfigPayload = {
      ...DEFAULT_PREDICTOR_CONFIG,
      target_lat_deg: 13.356,
      target_lon_deg: 74.796,
    };

    // 2. Two-stage configurable above transition (TWO_STAGE_CONFIGURABLE, h > 550m)
    const stage1Packets: TelemetryPacket[] = [];
    for (let s = 0; s <= 10; s++) {
      stage1Packets.push(
        makeDescentPacket(s, 820.0 - 16.5 * s, 5.0 * s, 2.2 * s)
      );
    }
    const cfgTwoStage: PredictorConfigPayload = {
      ...DEFAULT_PREDICTOR_CONFIG,
      propagation_mode: 'TWO_STAGE_CONFIGURABLE',
      disreef_transition_altitude_m: 550.0,
      stage1_nominal_descent_rate_ms: 16.5,
      stage2_nominal_descent_rate_ms: 2.3,
    };

    // 3. Two-stage configurable below transition (TWO_STAGE_CONFIGURABLE, h < 550m)
    const stage2Packets: TelemetryPacket[] = [];
    for (let s = 0; s <= 10; s++) {
      stage2Packets.push(
        makeDescentPacket(s, 320.0 - 2.3 * s, 3.0 * s, -1.5 * s)
      );
    }

    // 4. GPS_AMSL_MINUS_GROUND altitude handling
    const cfgGpsAlt: PredictorConfigPayload = {
      ...DEFAULT_PREDICTOR_CONFIG,
      altitude_source: 'GPS_AMSL_MINUS_GROUND',
      ground_elevation_amsl_m: 55.0,
    };

    // 5. BARO_ONLY with baro_ground_offset_m
    const cfgBaroOffset: PredictorConfigPayload = {
      ...DEFAULT_PREDICTOR_CONFIG,
      altitude_source: 'BARO_ONLY',
      baro_ground_offset_m: 12.5,
    };

    // 6. Noisy GPS trajectory with duplicate timestamp & rejected invalid mid-flight packet
    const jitter = [1.6, -1.4, 1.9, -1.8, 1.5, -1.7, 2.0, -1.5, 1.3, -1.6];
    const noisyPackets: TelemetryPacket[] = [];
    for (let s = 0; s <= 14; s++) {
      const j = jitter[s % jitter.length];
      noisyPackets.push(
        makeDescentPacket(s, 360.0 - 2.6 * s, 3.8 * s + j, -2.9 * s - j, {
          source: 'LIVE_SERIAL',
        })
      );
      if (s === 5) {
        // Duplicate timestamp packet
        noisyPackets.push(
          makeDescentPacket(s, 360.0 - 2.6 * s, 3.8 * s, -2.9 * s, {
            source: 'LIVE_SERIAL',
          })
        );
      }
      if (s === 8) {
        // Mid-flight invalid GPS packet followed by valid packets
        noisyPackets.push(
          makeDescentPacket(s + 0.5, 360.0 - 2.6 * (s + 0.5), 0, 0, {
            source: 'LIVE_SERIAL',
            latitude: 0,
            longitude: 0,
            gpsValid: false,
            gpsFixType: 'NO_FIX',
            gpsSats: 0,
          })
        );
      }
    }

    // 7. Latest packet lost GPS lock after valid fixes -> must gate with NO_VALID_GPS_FIX
    const lostFixAtEndPackets = [
      ...nominalPackets.slice(0, 8),
      makeDescentPacket(9, 395.0, 0, 0, {
        latitude: 0,
        longitude: 0,
        gpsValid: false,
        gpsFixType: 'NO_FIX',
        gpsSats: 0,
      }),
    ];

    // 8. Touchdown completion gate
    const touchdownPackets = [
      makeDescentPacket(0, 12.0, 10, 10),
      makeDescentPacket(1, 9.0, 13, 12),
      makeDescentPacket(2, 6.0, 16, 14),
      makeDescentPacket(3, 1.5, 19, 16),
    ];

    const scenarios: Array<{
      name: string;
      packets: TelemetryPacket[];
      config: PredictorConfigPayload;
      source: TelemetrySource;
      ageS: number;
      staleOverride?: boolean;
    }> = [
      {
        name: 'Nominal constant velocity + target',
        packets: nominalPackets,
        config: cfgWithTarget,
        source: 'SIMULATION',
        ageS: 0.0,
      },
      {
        name: 'Two-stage configurable above transition',
        packets: stage1Packets,
        config: cfgTwoStage,
        source: 'SIMULATION',
        ageS: 0.0,
      },
      {
        name: 'Two-stage configurable below transition',
        packets: stage2Packets,
        config: cfgTwoStage,
        source: 'SIMULATION',
        ageS: 0.0,
      },
      {
        name: 'GPS_AMSL_MINUS_GROUND altitude handling',
        packets: nominalPackets,
        config: cfgGpsAlt,
        source: 'LIVE_SERIAL',
        ageS: 0.4,
      },
      {
        name: 'BARO_ONLY with ground offset',
        packets: nominalPackets,
        config: cfgBaroOffset,
        source: 'LIVE_SERIAL',
        ageS: 0.25,
      },
      {
        name: 'Noisy GPS + duplicate ts + recovered fix',
        packets: noisyPackets,
        config: DEFAULT_PREDICTOR_CONFIG,
        source: 'LIVE_SERIAL',
        ageS: 0.5,
      },
      {
        name: 'Stale telemetry gate',
        packets: nominalPackets,
        config: DEFAULT_PREDICTOR_CONFIG,
        source: 'LIVE_SERIAL',
        ageS: 4.2,
      },
      {
        name: 'Latest packet lost GPS fix gate',
        packets: lostFixAtEndPackets,
        config: DEFAULT_PREDICTOR_CONFIG,
        source: 'LIVE_SERIAL',
        ageS: 0.1,
      },
      {
        name: 'Touchdown completion gate',
        packets: touchdownPackets,
        config: DEFAULT_PREDICTOR_CONFIG,
        source: 'SIMULATION',
        ageS: 0.0,
      },
    ];

    for (const sc of scenarios) {
      const tsRes = computeLocalPhysicsPrediction(
        sc.packets,
        sc.config,
        sc.source,
        sc.ageS,
        sc.staleOverride ?? false
      );
      const pyRes = evaluatePythonPredictor(
        sc.packets,
        sc.config,
        sc.source,
        sc.ageS,
        sc.staleOverride ?? false
      );

      assert.equal(tsRes.valid, pyRes.valid, `[${sc.name}] valid mismatch`);
      assert.equal(
        tsRes.reason_code,
        pyRes.reason_code,
        `[${sc.name}] reason_code mismatch`
      );
      assert.equal(tsRes.source, pyRes.source, `[${sc.name}] source mismatch`);
      assert.equal(
        tsRes.input_trajectory_stability_tier,
        pyRes.input_trajectory_stability_tier,
        `[${sc.name}] stability tier mismatch`
      );
      assert.equal(
        tsRes.input_trajectory_stability_score,
        pyRes.input_trajectory_stability_score,
        `[${sc.name}] stability score mismatch`
      );
      assert.deepEqual(
        tsRes.prediction,
        pyRes.prediction,
        `[${sc.name}] prediction payload mismatch`
      );
      assert.deepEqual(
        tsRes.trajectory_metrics,
        pyRes.trajectory_metrics,
        `[${sc.name}] trajectory_metrics payload mismatch`
      );
    }
  });

  it('enforces source isolation, invalidates predictions on GPS lock loss or staleness, and falls back cleanly when HTTP backend is offline', async () => {
    // 1. Build valid SIMULATION history
    const simPackets: TelemetryPacket[] = [];
    for (let s = 0; s <= 12; s++) {
      simPackets.push(
        makeDescentPacket(s, 350.0 - 2.5 * s, 4.0 * s, -2.0 * s, {
          source: 'SIMULATION',
        })
      );
    }
    const simValid = computeLocalPhysicsPrediction(
      simPackets,
      DEFAULT_PREDICTOR_CONFIG,
      'SIMULATION',
      0.0,
      false
    );
    assert.equal(simValid.valid, true);
    assert.equal(simValid.source, 'SIMULATION');
    assert.ok(simValid.prediction !== null);

    // 2. Switching to LIVE_SERIAL with empty live buffer must immediately gate (never leak SIMULATION prediction)
    const liveEmpty = computeLocalPhysicsPrediction(
      [],
      DEFAULT_PREDICTOR_CONFIG,
      'LIVE_SERIAL',
      null,
      false
    );
    assert.equal(liveEmpty.valid, false);
    assert.equal(liveEmpty.source, 'LIVE');
    assert.equal(liveEmpty.reason_code, 'NO_VALID_GPS_FIX');
    assert.equal(liveEmpty.prediction, null);

    // 3. Live stream with valid history that subsequently becomes stale must immediately gate
    const livePackets = simPackets.map((p) => ({
      ...p,
      source: 'LIVE_SERIAL' as const,
    }));
    const liveFresh = computeLocalPhysicsPrediction(
      livePackets,
      DEFAULT_PREDICTOR_CONFIG,
      'LIVE_SERIAL',
      0.3,
      false
    );
    assert.equal(liveFresh.valid, true);
    assert.equal(liveFresh.source, 'LIVE');

    const liveStaleByFlag = computeLocalPhysicsPrediction(
      livePackets,
      DEFAULT_PREDICTOR_CONFIG,
      'LIVE_SERIAL',
      0.3,
      true // isStaleOverride = true
    );
    assert.equal(liveStaleByFlag.valid, false);
    assert.equal(liveStaleByFlag.reason_code, 'TELEMETRY_STALE');
    assert.equal(liveStaleByFlag.prediction, null);

    // 4. Live stream that loses GPS lock on the newest packet must immediately suppress old prediction
    const liveLostFixPackets: TelemetryPacket[] = [
      ...livePackets,
      makeDescentPacket(13, 317.5, 0, 0, {
        source: 'LIVE_SERIAL',
        latitude: 0,
        longitude: 0,
        gpsValid: false,
        gpsFixType: 'NO_FIX',
        gpsSats: 0,
      }),
    ];
    const liveLostFix = computeLocalPhysicsPrediction(
      liveLostFixPackets,
      DEFAULT_PREDICTOR_CONFIG,
      'LIVE_SERIAL',
      0.2,
      false
    );
    assert.equal(liveLostFix.valid, false);
    assert.equal(liveLostFix.reason_code, 'NO_VALID_GPS_FIX');
    assert.equal(liveLostFix.prediction, null);

    // 5. Service-unavailable fallback: point to an unreachable local port and verify seamless fallback
    const fallbackResult = await evaluateLandingPredictionWithBackend(
      livePackets,
      DEFAULT_PREDICTOR_CONFIG,
      'LIVE_SERIAL',
      0.3,
      false,
      'http://127.0.0.1:59999'
    );
    assert.equal(fallbackResult.backendStatus, 'LOCAL_FALLBACK_ACTIVE');
    assert.deepEqual(fallbackResult.response, liveFresh);
  });
});
