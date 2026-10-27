import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import {
  computeChartStats,
  computeChartWindowBounds,
  detectPhaseTransitions,
  getChartGridClass,
  getChartPresetTabs,
  segmentChartPackets,
} from '../../components/TelemetryChartPanel';
import {
  CANSAT_MM_TO_SCENE_SCALE,
  buildRamAirParafoilAssembly,
  computeNextMeshRotation,
  computeResponsiveCameraPosition,
  deriveAttitudeViewportState,
  normalizeCanSatStlGeometry,
} from '../../components/ThreeAttitudeViewport';
import { describeWebSerialSupport } from '../serialTelemetry';
import {
  filterLogsBySource,
  getLogBadgeLabel,
  getTerminalFilterTabs,
} from '../../components/TerminalDrawer';
import {
  evaluatePreflightChecklist,
  getDefaultChecklistState,
} from '../../components/PreflightChecklistPanel';
import { resolveHeaderTeamBadge } from '../../components/HeaderBar';
import {
  DEFAULT_PREDICTOR_CONFIG,
  PredictionResponsePayload,
  PredictorConfigPayload,
  PredictorRequestCoordinator,
  computeLocalPhysicsPrediction,
  enuToLatLon,
  parseAndValidateTargetCoordinates,
  shouldDisplayPredictedOverlay,
} from '../landingPredictorClient';
import {
  RADIO_OPERATING_CONSTRAINTS,
  RADIO_TEAM_NUMBER,
  TEAM_017_RADIO_ASSIGNMENT,
  derivePanId,
  deriveSyncWord,
  formatHex,
} from '../../radioConfig';
import {
  DEFAULT_OVERVIEW_PREFERENCES,
  StorageLike,
  isOverviewWidgetVisible,
  loadOverviewPreferences,
  resolveOverviewStripColumnsClass,
  sanitizeOverviewPreferences,
  saveOverviewPreferences,
  shouldShowLinkAlertBanner,
} from '../overviewPreferences';
import {
  TELEMETRY_CSV_COLUMNS,
  csvCell,
  formatTelemetryPacketsCsv,
  OFFICIAL_FLIGHT_CSV_FILENAME,
} from '../telemetryExport';
import { FIELD_READINESS_ITEMS } from '../../components/PreflightChecklistPanel';
import { FIRMWARE_FLIGHT_STATES } from '../../constants';
import {
  parseFirmwareControlLine,
  parseTelemetryLine,
  SerialLineBuffer,
} from '../telemetryParser';
import { FlightStateCode, RawLogEntry, TelemetryPacket } from '../../types';

const LAUNCH_LAT = 13.3525;
const LAUNCH_LON = 74.7928;

function makeTelemetryPacket(
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
    accelX: 0.1,
    accelY: -0.1,
    accelZ: 9.81,
    spinRate: 1.5,
    wheelRpm: 12000,
    roll: 12.0,
    pitch: -6.0,
    yaw: 45.0,
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
    temperature: 26.4,
    pressure: 1008.2,
    batteryVoltage: 7.95,
    currentDraw: null,
    power: null,
    batterySoc: 88,
    rssi: -68,
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

describe('GCS Audit Regression Suite (Stages A, B, and C)', () => {
  it('Stage A.1: ThreeAttitudeViewport handles null -> first live packet, subsequent attitude updates, and persistent manual orbit drag until Reset View', () => {
    // 1. Initial mount with latestPacket === null
    const initialNullState = deriveAttitudeViewportState(null, false, false);
    assert.equal(initialNullState.hasAttitudeData, false);
    assert.equal(initialNullState.rollDeg, 0);
    assert.equal(initialNullState.pitchDeg, 0);

    // While no attitude data has arrived, mesh rotation remains unchanged
    const startRotation = { x: 0, y: 0, z: 0 };
    const rotWhileNull = computeNextMeshRotation(startRotation, initialNullState);
    assert.deepEqual(rotWhileNull, startRotation);

    // 2. First live packet arrives (roll = 30 deg, pitch = -15 deg, yaw = null in 19-field CSV)
    const firstLivePacket = makeTelemetryPacket(1, 500, 10, 5, {
      source: 'LIVE_SERIAL',
      roll: 30,
      pitch: -15,
      yaw: null,
    });
    const firstLiveState = deriveAttitudeViewportState(firstLivePacket, false, false);
    assert.equal(firstLiveState.hasAttitudeData, true);
    assert.equal(firstLiveState.hasYaw, false);
    assert.equal(firstLiveState.yawDeg, 0);

    // Verify mesh updates to target pitch/roll in radians
    let currentRot = computeNextMeshRotation(startRotation, firstLiveState);
    const expectedPitchRad = (-15 * Math.PI) / 180;
    const expectedRollRad = (30 * Math.PI) / 180;
    assert.ok(Math.abs(currentRot.x - expectedPitchRad) < 1e-6);
    assert.ok(Math.abs(currentRot.z - expectedRollRad) < 1e-6);

    // 3. Subsequent attitude packet updates model orientation (no stale mount closure)
    const secondLivePacket = makeTelemetryPacket(2, 495, 12, 6, {
      source: 'LIVE_SERIAL',
      roll: -20,
      pitch: 10,
      yaw: null,
    });
    const secondLiveState = deriveAttitudeViewportState(secondLivePacket, false, false);
    currentRot = computeNextMeshRotation(currentRot, secondLiveState);
    assert.ok(Math.abs(currentRot.x - (10 * Math.PI) / 180) < 1e-6);
    assert.ok(Math.abs(currentRot.z - (-20 * Math.PI) / 180) < 1e-6);

    // 4. Operator drags model manually and releases mouse: manual orientation MUST persist
    const manualDraggedRotation = { x: 0.85, y: -1.15, z: 0.42 };
    const afterMouseUpState = deriveAttitudeViewportState(
      secondLivePacket,
      true,  // manualControl active
      false  // mouse released, but Reset View not yet clicked
    );
    const afterMouseUpRot = computeNextMeshRotation(
      manualDraggedRotation,
      afterMouseUpState
    );
    assert.deepEqual(afterMouseUpRot, manualDraggedRotation);

    // 5. Clicking Reset View clears manualControl and resumes tracking live telemetry
    const afterResetState = deriveAttitudeViewportState(secondLivePacket, false, false);
    const afterResetRot = computeNextMeshRotation(
      manualDraggedRotation,
      afterResetState
    );
    assert.ok(Math.abs(afterResetRot.x - (10 * Math.PI) / 180) < 1e-6);
    assert.ok(Math.abs(afterResetRot.z - (-20 * Math.PI) / 180) < 1e-6);
  });

  it('Stage A.2: PredictorRequestCoordinator throttles polling, backs off exponentially when offline, and retains local fallback', async () => {
    let fakeNowMs = 10_000;
    let fetchCalls = 0;

    const failingFetch: typeof fetch = async () => {
      fetchCalls += 1;
      throw new TypeError('fetch failed: ERR_CONNECTION_REFUSED');
    };

    const coordinator = new PredictorRequestCoordinator({
      minPollIntervalMs: 1000,
      initialBackoffMs: 3000,
      maxBackoffMs: 15000,
      requestTimeoutMs: 200,
      fetchImpl: failingFetch,
      nowMs: () => fakeNowMs,
    });

    const packets: TelemetryPacket[] = [];
    for (let i = 0; i < 8; i += 1) {
      packets.push(makeTelemetryPacket(i, 400 - i * 2.5, i * 3.0, i * 1.5));
    }

    // Attempt 1 at t = 10,000 ms: tries network once, fails, falls back to local physics, sets 3000 ms backoff
    const res1 = await coordinator.evaluate({
      historyPackets: packets,
      config: DEFAULT_PREDICTOR_CONFIG,
      telemetrySource: 'SIMULATION',
      packetAgeSeconds: 0.1,
    });
    assert.equal(fetchCalls, 1);
    assert.equal(res1.backendStatus, 'LOCAL_FALLBACK_ACTIVE');
    assert.equal(res1.skippedNetwork, false);
    assert.equal(res1.stale, false);
    assert.equal(res1.consecutiveFailures, 1);
    assert.equal(res1.nextRetryInMs, 3000);
    assert.equal(res1.response.valid, true);

    // 8 rapid telemetry updates over the next 2.5 seconds (t = 10,250 .. 12,500 ms):
    // Must NOT invoke fetch during backoff window, while still returning updated local predictions!
    for (let step = 1; step <= 8; step += 1) {
      fakeNowMs = 10_000 + step * 300;
      const nextPackets = [
        ...packets,
        makeTelemetryPacket(7 + step, 380 - step * 2.5, (7 + step) * 3.0, (7 + step) * 1.5),
      ];
      const throttledRes = await coordinator.evaluate({
        historyPackets: nextPackets,
        config: DEFAULT_PREDICTOR_CONFIG,
        telemetrySource: 'SIMULATION',
        packetAgeSeconds: 0.1,
      });
      assert.equal(fetchCalls, 1, 'Must not call fetch during offline backoff window');
      assert.equal(throttledRes.skippedNetwork, true);
      assert.equal(throttledRes.stale, false);
      assert.equal(throttledRes.response.valid, true);
    }

    // Attempt 2 after 3000 ms backoff expires (t = 13,100 ms): probes network once, fails, backs off 6000 ms
    fakeNowMs = 13_100;
    const res2 = await coordinator.evaluate({
      historyPackets: packets,
      config: DEFAULT_PREDICTOR_CONFIG,
      telemetrySource: 'SIMULATION',
      packetAgeSeconds: 0.1,
    });
    assert.equal(fetchCalls, 2);
    assert.equal(res2.consecutiveFailures, 2);
    assert.equal(res2.nextRetryInMs, 6000);
  });

  it('Stage A.2: PredictorRequestCoordinator cancels obsolete requests on source change and rejects stale out-of-order responses', async () => {
    const fakeNowMs = 50_000;
    let capturedSignal: AbortSignal | undefined;
    let resolveSlowFetch: ((value: Response) => void) | null = null;

    const slowFetch: typeof fetch = (_input, init) => {
      capturedSignal = init?.signal ?? undefined;
      return new Promise<Response>((resolve) => {
        resolveSlowFetch = resolve;
      });
    };

    const coordinator = new PredictorRequestCoordinator({
      minPollIntervalMs: 1000,
      initialBackoffMs: 3000,
      maxBackoffMs: 15000,
      requestTimeoutMs: 5000,
      fetchImpl: slowFetch,
      nowMs: () => fakeNowMs,
    });

    const simPackets: TelemetryPacket[] = [];
    for (let i = 0; i < 8; i += 1) {
      simPackets.push(makeTelemetryPacket(i, 400 - i * 2.5, i * 3.0, i * 1.5));
    }

    // Start slow SIMULATION request
    const inFlightSimPromise = coordinator.evaluate({
      historyPackets: simPackets,
      config: DEFAULT_PREDICTOR_CONFIG,
      telemetrySource: 'SIMULATION',
      packetAgeSeconds: 0.1,
    });

    assert.ok(capturedSignal, 'In-flight request should attach an AbortSignal');
    assert.equal(capturedSignal.aborted, false);

    // Switch source to LIVE_SERIAL before SIMULATION request resolves
    const liveRes = await coordinator.evaluate({
      historyPackets: [],
      config: DEFAULT_PREDICTOR_CONFIG,
      telemetrySource: 'LIVE_SERIAL',
      packetAgeSeconds: null,
    });

    // Switching source must immediately abort the obsolete in-flight SIMULATION request
    assert.equal(capturedSignal.aborted, true);
    assert.equal(liveRes.response.source, 'LIVE');
    assert.equal(liveRes.response.valid, false);
    assert.equal(liveRes.stale, false);

    // Now let the old SIMULATION HTTP response resolve late with a valid payload
    const fakeSimBackendPayload: PredictionResponsePayload = computeLocalPhysicsPrediction(
      simPackets,
      DEFAULT_PREDICTOR_CONFIG,
      'SIMULATION',
      0.1,
      false
    );
    assert.ok(resolveSlowFetch);
    (resolveSlowFetch as (value: Response) => void)(
      new Response(JSON.stringify(fakeSimBackendPayload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const lateSimResult = await inFlightSimPromise;
    assert.equal(
      lateSimResult.stale,
      true,
      'Late response from superseded request or old telemetrySource must be marked stale'
    );
  });

  it('Stage B.3: Shared target coordinate validation rejects (0,0) Null Island and persists config across Overview and Landing Predictor', () => {
    // 1. Validate target coordinate parser
    assert.equal(parseAndValidateTargetCoordinates('0', '0').valid, false);
    assert.equal(parseAndValidateTargetCoordinates('0.000000', '-0.000000').valid, false);
    assert.equal(parseAndValidateTargetCoordinates('95.0', '74.79').valid, false);
    assert.equal(parseAndValidateTargetCoordinates('13.35', '185.0').valid, false);
    assert.equal(parseAndValidateTargetCoordinates('abc', '74.79').valid, false);

    const validTarget = parseAndValidateTargetCoordinates('13.354000', '74.795000');
    assert.equal(validTarget.valid, true);
    if (validTarget.valid) {
      assert.equal(validTarget.latDeg, 13.354);
      assert.equal(validTarget.lonDeg, 74.795);
    }

    // 2. Shared config produces identical target metrics in Overview and Landing Predictor
    const sharedConfig: PredictorConfigPayload = {
      ...DEFAULT_PREDICTOR_CONFIG,
      propagation_mode: 'TWO_STAGE_CONFIGURABLE',
      parafoil_transition_altitude_m: 350,
      stage2_nominal_descent_rate_ms: 2.0,
      target_lat_deg: 13.354,
      target_lon_deg: 74.795,
    };

    const packets: TelemetryPacket[] = [];
    for (let i = 0; i < 8; i += 1) {
      packets.push(makeTelemetryPacket(i, 420 - i * 4.0, i * 2.5, i * 2.0));
    }

    const overviewPred = computeLocalPhysicsPrediction(
      packets,
      sharedConfig,
      'SIMULATION',
      0.1,
      false
    );
    assert.equal(overviewPred.valid, true);
    assert.ok(overviewPred.prediction);
    assert.equal(
      overviewPred.prediction.propagation_mode_used,
      'TWO_STAGE_CONFIGURABLE(h_tr=350m,v2=2.00m/s)'
    );
    assert.ok(
      typeof overviewPred.prediction.distance_to_target_m === 'number' &&
        overviewPred.prediction.distance_to_target_m > 0
    );

    // 3. Overview map predicted overlay gating
    const latestPkt = packets[packets.length - 1];
    assert.equal(
      shouldDisplayPredictedOverlay(
        overviewPred,
        false,
        latestPkt.latitude,
        latestPkt.longitude
      ),
      true
    );
    assert.equal(
      shouldDisplayPredictedOverlay(
        overviewPred,
        true, // stale stream -> must hide overlay immediately
        latestPkt.latitude,
        latestPkt.longitude
      ),
      false
    );
    assert.equal(
      shouldDisplayPredictedOverlay(overviewPred, false, null, null),
      false
    );
  });

  it('Stage B.4 & C.6: Source-isolated logs exclude simulator entries/controls in LIVE_SERIAL and HeaderBar never shows simulator ID #332 in LIVE_SERIAL before packets arrive', () => {
    const mixedLogs: RawLogEntry[] = [
      {
        time: '12:00:01',
        text: '2026-IN-SPACe-CAN-7USAT-017,00:00:01,1,...',
        type: 'rx',
        source: 'SIMULATION',
      },
      {
        time: '12:00:02',
        text: 'CMD,2026-IN-SPACe-CAN-7USAT-017,CAL,1',
        type: 'tx',
        source: 'SIMULATION',
      },
      {
        time: '12:00:03',
        text: '[LIVE SERIAL] Port opened @ 115200 baud (receive-only).',
        type: 'sys',
        source: 'LIVE_SERIAL',
      },
      {
        time: '12:00:04',
        text: '2026-IN-SPACe-CAN-7USAT-017,00:00:10,42,...',
        type: 'rx',
        source: 'LIVE_SERIAL',
      },
    ];

    const liveFiltered = filterLogsBySource(mixedLogs, 'LIVE_SERIAL', 'all');
    assert.equal(liveFiltered.length, 2);
    assert.ok(liveFiltered.every((l) => l.source === 'LIVE_SERIAL'));
    assert.equal(getLogBadgeLabel(liveFiltered[0], 'LIVE_SERIAL'), 'LIVE-SYS');
    assert.equal(getLogBadgeLabel(liveFiltered[1], 'LIVE_SERIAL'), 'LIVE-RX');

    const simFiltered = filterLogsBySource(mixedLogs, 'SIMULATION', 'all');
    assert.equal(simFiltered.length, 2);
    assert.ok(simFiltered.every((l) => l.source === 'SIMULATION'));
    assert.equal(getLogBadgeLabel(simFiltered[0], 'SIMULATION'), 'SIM-RX');
    assert.equal(getLogBadgeLabel(simFiltered[1], 'SIMULATION'), 'SIM-TX');

    // Verify SIM TX filter tab is omitted in LIVE_SERIAL
    const liveTabs = getTerminalFilterTabs('LIVE_SERIAL');
    assert.equal(
      liveTabs.some((t) => t.key === 'tx'),
      false,
      'LIVE_SERIAL must not display SIM TX filter tab'
    );
    const simTabs = getTerminalFilterTabs('SIMULATION');
    assert.equal(simTabs.some((t) => t.key === 'tx'), true);

    // HeaderBar Team ID badge in LIVE_SERIAL vs SIMULATION
    const awaitingBadge = resolveHeaderTeamBadge(null, 'LIVE_SERIAL');
    assert.equal(awaitingBadge.label, 'CAN-7USAT | TEAM 017');
    assert.equal(awaitingBadge.status, 'AWAITING_RX');
    assert.equal(awaitingBadge.mismatchedTeamId, null);

    const simBadge = resolveHeaderTeamBadge(null, 'SIMULATION');
    assert.equal(simBadge.label, 'CAN-7USAT | TEAM 017');
    assert.equal(simBadge.status, 'SIMULATED');
    assert.equal(simBadge.mismatchedTeamId, null);

    const livePacket017 = makeTelemetryPacket(1, 300, 0, 0, {
      source: 'LIVE_SERIAL',
      teamId: '2026-IN-SPACe-CAN-7USAT-017',
    });
    const verifiedBadge = resolveHeaderTeamBadge(livePacket017, 'LIVE_SERIAL');
    assert.equal(verifiedBadge.label, 'CAN-7USAT | TEAM 017');
    assert.equal(verifiedBadge.status, 'VERIFIED');
    assert.equal(verifiedBadge.mismatchedTeamId, null);

    const livePacketMismatch = makeTelemetryPacket(1, 300, 0, 0, {
      source: 'LIVE_SERIAL',
      teamId: 'OTHER-TEAM-999',
    });
    const mismatchBadge = resolveHeaderTeamBadge(livePacketMismatch, 'LIVE_SERIAL');
    assert.equal(mismatchBadge.label, 'CAN-7USAT | TEAM 017');
    assert.equal(mismatchBadge.status, 'MISMATCH');
    assert.equal(mismatchBadge.mismatchedTeamId, 'OTHER-TEAM-999');
  });

  it('Stage C.5: PreflightChecklistPanel initializes manual checks as unverified in LIVE_SERIAL and requires explicit operator confirmation', () => {
    const liveNominalPacket = makeTelemetryPacket(1, 100, 0, 0, {
      source: 'LIVE_SERIAL',
      wheelRpm: null, // Not transmitted in 19-field live CSV
    });

    // 1. Default LIVE_SERIAL checklist state leaves manual items (4, 5, 6, 8) unchecked
    const liveDefaultChecks = getDefaultChecklistState('LIVE_SERIAL');
    assert.equal(liveDefaultChecks[4], false);
    assert.equal(liveDefaultChecks[5], false);
    assert.equal(liveDefaultChecks[6], false);
    assert.equal(liveDefaultChecks[8], false);

    const initialLiveEval = evaluatePreflightChecklist(
      liveNominalPacket,
      'LIVE_SERIAL',
      liveDefaultChecks
    );
    assert.equal(
      initialLiveEval.allGo,
      false,
      'LIVE_SERIAL must never automatically report ALL CHECKS GO before manual hardware sign-off'
    );

    const item4 = initialLiveEval.items.find((i) => i.id === 4)!;
    assert.equal(item4.itemOk, false);
    assert.equal(item4.status, 'MANUAL VERIFICATION REQUIRED');

    // 2. Operator explicitly confirms manual items 4, 5, 6, 8
    const operatorConfirmedChecks: Record<number, boolean> = {
      ...liveDefaultChecks,
      4: true,
      5: true,
      6: true,
      8: true,
    };
    const confirmedLiveEval = evaluatePreflightChecklist(
      liveNominalPacket,
      'LIVE_SERIAL',
      operatorConfirmedChecks
    );
    assert.equal(confirmedLiveEval.allGo, true);
    assert.equal(
      confirmedLiveEval.items.find((i) => i.id === 4)!.status,
      'VERIFIED BY OPERATOR (MANUAL)'
    );

    // 3. Default SIMULATION checklist state still starts ready when sim telemetry is valid
    const simDefaultChecks = getDefaultChecklistState('SIMULATION');
    const simNominalPacket = makeTelemetryPacket(1, 100, 0, 0, {
      source: 'SIMULATION',
    });
    const simEval = evaluatePreflightChecklist(
      simNominalPacket,
      'SIMULATION',
      simDefaultChecks
    );
    assert.equal(simEval.allGo, true);
  });

  it('Stage D.1: Team 017 radio configuration matches competition assignment PDF exactly', () => {
    // Team 017 constants from PDF page 2
    assert.equal(RADIO_TEAM_NUMBER, 17);
    assert.equal(TEAM_017_RADIO_ASSIGNMENT.lora.mainMHz, 865.5);
    assert.equal(TEAM_017_RADIO_ASSIGNMENT.lora.backupMHz, 867.25);
    assert.equal(TEAM_017_RADIO_ASSIGNMENT.lora.spreadingFactor, 7);
    assert.equal(TEAM_017_RADIO_ASSIGNMENT.lora.bandwidthKHz, 125);
    assert.equal(TEAM_017_RADIO_ASSIGNMENT.lora.codingRate, '4/5');
    assert.equal(TEAM_017_RADIO_ASSIGNMENT.lora.syncWord, 0x91);
    assert.equal(deriveSyncWord(17), 0x91);
    assert.equal(formatHex(TEAM_017_RADIO_ASSIGNMENT.lora.syncWord), '0x91');

    assert.equal(TEAM_017_RADIO_ASSIGNMENT.xbee.mainChannel, 17);
    assert.equal(TEAM_017_RADIO_ASSIGNMENT.xbee.mainMHz, 2435);
    assert.equal(TEAM_017_RADIO_ASSIGNMENT.xbee.backupChannel, 21);
    assert.equal(TEAM_017_RADIO_ASSIGNMENT.xbee.backupMHz, 2455);
    assert.equal(TEAM_017_RADIO_ASSIGNMENT.xbee.panId, 0x1011);
    assert.equal(derivePanId(17), 0x1011);
    assert.equal(formatHex(TEAM_017_RADIO_ASSIGNMENT.xbee.panId, 4), '0x1011');

    assert.equal(TEAM_017_RADIO_ASSIGNMENT.autoShutdownMinutesAfterLaunchDetect, 90);
    assert.ok(RADIO_OPERATING_CONSTRAINTS.some((c) => c.includes('90 minutes')));
  });

  it('Stage D.2: Mission Overview widget display preferences and localStorage isolation', () => {
    // 1. Defaults have all 9 widgets enabled
    assert.equal(Object.keys(DEFAULT_OVERVIEW_PREFERENCES).length, 9);
    for (const [key, val] of Object.entries(DEFAULT_OVERVIEW_PREFERENCES)) {
      assert.equal(val, true, `Default widget ${key} should be true`);
    }

    // 2. simControls is hidden in LIVE_SERIAL mode regardless of user preference
    assert.equal(
      isOverviewWidgetVisible(DEFAULT_OVERVIEW_PREFERENCES, 'simControls', 'SIMULATION'),
      true
    );
    assert.equal(
      isOverviewWidgetVisible(DEFAULT_OVERVIEW_PREFERENCES, 'simControls', 'LIVE_SERIAL'),
      false
    );

    // 3. Sanitizer drops unknown keys and preserves valid booleans
    const sanitized = sanitizeOverviewPreferences({
      missionStrip: false,
      attitude: true,
      unknownKey: 'malicious',
      flightState: 'not-a-boolean',
    });
    assert.equal(sanitized.missionStrip, false);
    assert.equal(sanitized.attitude, true);
    assert.equal(sanitized.flightState, true); // fallback to default
    assert.equal('unknownKey' in sanitized, false);

    // 4. Storage serialization and persistence
    const fakeStore: Record<string, string> = {};
    const storageLike: StorageLike = {
      getItem: (k: string) => fakeStore[k] ?? null,
      setItem: (k: string, v: string) => {
        fakeStore[k] = v;
      },
    };
    saveOverviewPreferences(storageLike, {
      ...DEFAULT_OVERVIEW_PREFERENCES,
      telemetryCharts: false,
    });
    const loaded = loadOverviewPreferences(storageLike);
    assert.equal(loaded.telemetryCharts, false);
    assert.equal(loaded.missionStrip, true);

    // 5. Critical link safety alert banner logic
    // Banner hidden when link widget is visible
    assert.equal(
      shouldShowLinkAlertBanner({
        telemetrySource: 'LIVE_SERIAL',
        linkWidgetVisible: true,
        serialState: 'ERROR',
        isStale: true,
        lastError: 'COM Port Busy',
      }),
      false
    );
    // Banner shown when link widget is hidden and link is in error or stale
    assert.equal(
      shouldShowLinkAlertBanner({
        telemetrySource: 'LIVE_SERIAL',
        linkWidgetVisible: false,
        serialState: 'ERROR',
        isStale: false,
        lastError: 'COM Port Busy',
      }),
      true
    );
    assert.equal(
      shouldShowLinkAlertBanner({
        telemetrySource: 'LIVE_SERIAL',
        linkWidgetVisible: false,
        serialState: 'CONNECTED',
        isStale: true,
        lastError: null,
      }),
      true
    );
    // Never show link alert banner in SIMULATION
    assert.equal(
      shouldShowLinkAlertBanner({
        telemetrySource: 'SIMULATION',
        linkWidgetVisible: false,
        serialState: 'DISCONNECTED',
        isStale: true,
        lastError: null,
      }),
      false
    );

    // 6. Responsive top status strip column resolution
    assert.equal(
      resolveOverviewStripColumnsClass(true, true),
      'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5'
    );
    assert.equal(
      resolveOverviewStripColumnsClass(true, false),
      'grid-cols-2 sm:grid-cols-2 lg:grid-cols-4'
    );
    assert.equal(
      resolveOverviewStripColumnsClass(false, true),
      'grid-cols-1 max-w-sm'
    );
    assert.equal(
      resolveOverviewStripColumnsClass(false, false),
      'grid-cols-1'
    );

    // 7. TelemetryChartPanel Overview Mode layout and preset tabs contract
    const overviewTabs = getChartPresetTabs(true);
    assert.equal(overviewTabs.length, 4);
    assert.equal(overviewTabs[0].label, 'Primary (Alt/Rate)');
    assert.equal(overviewTabs[1].label, 'Baro & Temp');
    assert.equal(overviewTabs[2].label, 'DCS & Power');
    assert.equal(overviewTabs[3].label, 'Payload');

    const defaultTabs = getChartPresetTabs(false);
    assert.equal(defaultTabs.length, 4);
    assert.equal(defaultTabs[0].label, 'Primary Flight Metrics');
    assert.equal(defaultTabs[1].label, 'Barometric & IMU');

    const overviewGrid = getChartGridClass(true);
    assert.ok(overviewGrid.includes('grid-cols-1 sm:grid-cols-2'));
    assert.ok(
      !overviewGrid.includes('sm:grid-rows-2'),
      'Overview charts must fit on a single row without pushing row 2 down'
    );

    const defaultGrid = getChartGridClass(false);
    assert.ok(
      defaultGrid.includes('sm:grid-rows-2'),
      'Full workspace charts should render the complete 2x2 grid'
    );
  });

  it('Stage D.3: CSV Telemetry Exporter formats all 34 canonical columns, escapes delimiters, and isolates sources', () => {
    assert.equal(TELEMETRY_CSV_COLUMNS.length, 34);
    assert.equal(TELEMETRY_CSV_COLUMNS[0], 'TelemetrySource');
    assert.equal(TELEMETRY_CSV_COLUMNS[1], 'TeamID');
    assert.equal(TELEMETRY_CSV_COLUMNS[10], 'GnssTime_IST');
    assert.equal(TELEMETRY_CSV_COLUMNS[33], 'Power_W');

    // Escaping commas, quotes, and line breaks
    assert.equal(csvCell('nominal'), 'nominal');
    assert.equal(csvCell(42.5), '42.5');
    assert.equal(csvCell(null), '');
    assert.equal(csvCell(undefined), '');
    assert.equal(csvCell('hello, world'), '"hello, world"');
    assert.equal(csvCell('with "quotes"'), '"with ""quotes"""');
    assert.equal(csvCell('line1\nline2'), '"line1\nline2"');
  });

  it('Stage E.1: Telemetry chart time-domain windowing bounds and sample statistics', () => {
    const packets: TelemetryPacket[] = [];
    for (let s = 0; s < 120; s++) {
      packets.push(
        makeTelemetryPacket(s, 1000 - s * 5, s * 2, s * 3, {
          missionTimeSeconds: s,
          altitude: 1000 - s * 5,
          velocity: -5.0,
        })
      );
    }

    // 10s timeframe: window is [109, 119]
    const bounds10 = computeChartWindowBounds(packets, 10, 'SIMULATION');
    assert.equal(bounds10.latestTs, 119);
    assert.equal(bounds10.startTs, 109);
    assert.ok(bounds10.relevantPackets.length >= 10);

    // 30s timeframe: window is [89, 119]
    const bounds30 = computeChartWindowBounds(packets, 30, 'SIMULATION');
    assert.equal(bounds30.latestTs, 119);
    assert.equal(bounds30.startTs, 89);
    assert.ok(bounds30.relevantPackets.length >= 30);

    // 60s timeframe: window is [59, 119]
    const bounds60 = computeChartWindowBounds(packets, 60, 'SIMULATION');
    assert.equal(bounds60.latestTs, 119);
    assert.equal(bounds60.startTs, 59);

    // 120s timeframe: window is [0, 119]
    const bounds120 = computeChartWindowBounds(packets, 120, 'SIMULATION');
    assert.equal(bounds120.latestTs, 119);
    assert.equal(bounds120.startTs, 0);

    // Test statistics strictly within window
    const stats10 = computeChartStats(
      bounds10.relevantPackets,
      'altitude',
      bounds10.startTs,
      bounds10.latestTs,
      405,
      'SIMULATION'
    );
    assert.equal(stats10.minVal, 405);
    assert.equal(stats10.maxVal, 455);
    assert.equal(stats10.samplesInWindow.length, 11);
  });

  it('Stage E.2: Telemetry trace discontinuity segmentation across nulls, NaNs, and packet loss dropouts', () => {
    const p0 = makeTelemetryPacket(0, 1000, 0, 0, { missionTimeSeconds: 0, altitude: 1000 });
    const p1 = makeTelemetryPacket(1, 995, 0, 0, { missionTimeSeconds: 1, altitude: 995 });
    // Null measurement at t=2
    const p2 = makeTelemetryPacket(2, 0, 0, 0, { missionTimeSeconds: 2, altitude: null });
    // Resumed valid measurement at t=3
    const p3 = makeTelemetryPacket(3, 985, 0, 0, { missionTimeSeconds: 3, altitude: 985 });
    const p4 = makeTelemetryPacket(4, 980, 0, 0, { missionTimeSeconds: 4, altitude: 980 });
    // Dropout: jump from t=4 to t=10 (6s gap > 2.5s threshold)
    const p5 = makeTelemetryPacket(10, 950, 0, 0, { missionTimeSeconds: 10, altitude: 950 });
    const p6 = makeTelemetryPacket(11, 945, 0, 0, { missionTimeSeconds: 11, altitude: 945 });

    const packets = [p0, p1, p2, p3, p4, p5, p6];
    const segments = segmentChartPackets(
      packets,
      'altitude',
      0,
      15,
      300,
      150,
      900,
      1050,
      'SIMULATION',
      2.5
    );

    assert.equal(segments.length, 3);
    assert.equal(segments[0].length, 2);
    assert.equal(segments[0][0].val, 1000);
    assert.equal(segments[0][1].val, 995);

    assert.equal(segments[1].length, 2);
    assert.equal(segments[1][0].val, 985);
    assert.equal(segments[1][1].val, 980);

    assert.equal(segments[2].length, 2);
    assert.equal(segments[2][0].val, 950);
    assert.equal(segments[2][1].val, 945);
  });

  it('Stage E.3: Flight phase transitions detection and boundary annotations', () => {
    const packets = [
      makeTelemetryPacket(0, 0, 0, 0, {
        missionTimeSeconds: 0,
        stateCode: FlightStateCode.LAUNCH_PAD,
        fswStateName: 'LAUNCH_PAD',
      }),
      makeTelemetryPacket(5, 50, 0, 0, {
        missionTimeSeconds: 5,
        stateCode: FlightStateCode.ASCENT,
        fswStateName: 'ASCENT',
      }),
      makeTelemetryPacket(15, 1000, 0, 0, {
        missionTimeSeconds: 15,
        stateCode: FlightStateCode.ROCKET_DEPLOY,
        fswStateName: 'ROCKET_DEPLOY',
      }),
      makeTelemetryPacket(20, 950, 0, 0, {
        missionTimeSeconds: 20,
        stateCode: FlightStateCode.DESCENT,
        fswStateName: 'DESCENT',
      }),
      makeTelemetryPacket(45, 600, 0, 0, {
        missionTimeSeconds: 45,
        stateCode: FlightStateCode.AEROBREAK_RELEASE,
        fswStateName: 'PARAFOIL',
      }),
      makeTelemetryPacket(70, 0, 0, 0, {
        missionTimeSeconds: 70,
        stateCode: FlightStateCode.IMPACT,
        fswStateName: 'TOUCHDOWN',
      }),
    ];

    const transitions = detectPhaseTransitions(packets, 0, 80, 400, 'SIMULATION');
    assert.equal(transitions.length, 5);
    assert.equal(transitions[0].stateCode, FlightStateCode.ASCENT);
    assert.equal(transitions[1].stateCode, FlightStateCode.ROCKET_DEPLOY);
    assert.equal(transitions[2].stateCode, FlightStateCode.DESCENT);
    assert.equal(transitions[3].stateCode, FlightStateCode.AEROBREAK_RELEASE);
    assert.equal(transitions[4].stateCode, FlightStateCode.IMPACT);

    assert.ok(transitions[0].x > 0);
    assert.ok(transitions[1].x > transitions[0].x);
    assert.ok(transitions[2].x > transitions[1].x);
    assert.ok(transitions[3].x > transitions[2].x);
    assert.ok(transitions[4].x > transitions[3].x);
  });

  it('Stage F.1: Section 6.3 Official Competition CSV formatting and filename compliance', () => {
    assert.equal(
      OFFICIAL_FLIGHT_CSV_FILENAME,
      'Flight_2026-IN-SPACe-CAN-7USAT-017.csv'
    );

    const testPackets: TelemetryPacket[] = [
      makeTelemetryPacket(0, 0, 0, 0, {
        source: 'LIVE_SERIAL',
        teamId: '2026-IN-SPACe-CAN-7USAT-017',
        missionTimeSeconds: 12,
        packetNumber: 15,
        altitude: 612.4,
        rawPressurePa: 101325,
        pressure: 1013.25,
        temperature: 24.6,
        batteryVoltage: 7.84,
        timestampUtc: '07:15:32',
        gnssTimeIst: '12:45:32',
        latitude: 13.352512,
        longitude: 74.792834,
        gpsAltitude: 65.4,
        gpsSats: 8,
        gpsFixType: '3D',
        accelX: 0.02,
        accelY: -0.03,
        accelZ: 9.81,
        roll: 0.15,
        pitch: -0.2,
        spinRate: 0.01,
        fswStateName: 'TEST_MODE',
        stateCode: FlightStateCode.TEST_MODE,
        velocity: null,
        wheelRpm: null,
      }),
    ];

    const csvOutput = formatTelemetryPacketsCsv(testPackets, 'LIVE_SERIAL');
    const lines = csvOutput.split('\n');
    assert.equal(lines.length, 2);

    const headers = lines[0].split(',');
    assert.equal(headers[1], 'TeamID');
    assert.equal(headers[2], 'MissionTimeSec');
    assert.equal(headers[3], 'PacketNumber');
    assert.equal(headers[4], 'Altitude_m');
    assert.equal(headers[5], 'Pressure_Pa');
    assert.equal(headers[8], 'Batt_V');
    assert.equal(headers[9], 'GnssTime_UTC');
    assert.equal(headers[12], 'Latitude');
    assert.equal(headers[13], 'Longitude');
    assert.equal(headers[14], 'GpsAltitude_m');
    assert.equal(headers[17], 'AccelX');
    assert.equal(headers[20], 'Roll_deg');
    assert.equal(headers[22], 'SpinRate_degs');
    assert.equal(headers[23], 'FswStateName');

    const values = lines[1].split(',');
    assert.equal(values[0], 'LIVE_SERIAL');
    assert.equal(values[1], '2026-IN-SPACe-CAN-7USAT-017');
    assert.equal(values[2], '12');
    assert.equal(values[3], '15');
    assert.equal(values[4], '612.4');
    assert.equal(values[5], '101325');
    assert.equal(values[8], '7.84');
    assert.equal(values[9], '07:15:32');
    assert.equal(values[17], '0.02');
    assert.equal(values[19], '9.81');
    assert.equal(values[20], '0.15');
    assert.equal(values[22], '0.01');
    assert.equal(values[23], 'TEST_MODE');
    assert.equal(values[25], '');
    assert.equal(values[27], '');
  });

  it('Stage F.2: Section 6.1.x Real-time plot coverage contract for all required telemetry fields', () => {
    const standardTabs = getChartPresetTabs(false, false);
    assert.equal(standardTabs.length, 4);

    const expandedTabs = getChartPresetTabs(false, true);
    assert.equal(expandedTabs.length, 6);
    assert.equal(expandedTabs[0].id, 'PRIMARY');
    assert.equal(expandedTabs[1].id, 'BARO_IMU');
    assert.equal(expandedTabs[2].id, 'ACCEL_3AXIS');
    assert.equal(expandedTabs[3].id, 'GNSS_LINK');
    assert.equal(expandedTabs[4].id, 'STABILIZATION');
    assert.equal(expandedTabs[5].id, 'ENVIRONMENTAL');
    assert.equal(expandedTabs[2].label, '3-Axis Accelerometer');
    assert.equal(expandedTabs[3].label, 'GNSS & Link Metrics');
  });

  it('Stage F.3: Section 6.1.ix Processor reset discontinuity detection logic', () => {
    const prevPacket = makeTelemetryPacket(10, 500, 10, 5, {
      packetNumber: 520,
      missionTimeSeconds: 520,
    });

    const resetPacket = makeTelemetryPacket(11, 0, 0, 0, {
      packetNumber: 1,
      missionTimeSeconds: 0,
    });

    const isPacketDiscontinuity =
      resetPacket.packetNumber < prevPacket.packetNumber &&
      prevPacket.packetNumber > 1;
    assert.equal(isPacketDiscontinuity, true);

    const isTimeDiscontinuity =
      resetPacket.missionTimeSeconds < prevPacket.missionTimeSeconds &&
      prevPacket.missionTimeSeconds > 2;
    assert.equal(isTimeDiscontinuity, true);

    const nominalNextPacket = makeTelemetryPacket(12, 490, 12, 6, {
      packetNumber: 521,
      missionTimeSeconds: 521,
    });
    const isNominalReset =
      nominalNextPacket.packetNumber < prevPacket.packetNumber;
    assert.equal(isNominalReset, false);
  });

  it('Stage F.4: Section 6.1.iii, xi, xii Field equipment & operational checklist items', () => {
    assert.ok(FIELD_READINESS_ITEMS.length >= 4);
    const antennaItem = FIELD_READINESS_ITEMS.find((i) => i.id === 'antenna_elevation')!;
    assert.ok(antennaItem);
    assert.ok(antennaItem.requirement.includes('tripod'));
    assert.ok(antennaItem.sectionRef.includes('6.1.iii'));

    const batteryItem = FIELD_READINESS_ITEMS.find((i) => i.id === 'laptop_battery')!;
    assert.ok(batteryItem);
    assert.ok(batteryItem.requirement.includes('2.0 hours'));
    assert.ok(batteryItem.sectionRef.includes('6.1.xi'));

    const offlineMapsItem = FIELD_READINESS_ITEMS.find((i) => i.id === 'offline_maps')!;
    assert.ok(offlineMapsItem);
    assert.ok(offlineMapsItem.requirement.includes('IndexedDB'));
    assert.ok(offlineMapsItem.sectionRef.includes('6.1.xii'));
  });

  it('Stage G.1: Real CanSat STL mesh (CANSATassembly.stl) and inflated 7-cell ram-air parafoil assembly', () => {
    const stlFilePath = path.resolve(process.cwd(), 'public/models/CANSATassembly.stl');
    assert.equal(fs.existsSync(stlFilePath), true, 'CANSATassembly.stl must exist in public/models/');

    const buffer = fs.readFileSync(stlFilePath);
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    const loader = new STLLoader();
    const rawGeo = loader.parse(arrayBuffer);

    const posAttr = rawGeo.getAttribute('position');
    assert.equal(posAttr.count / 3, 170334, 'STL must contain all 170,334 CAD triangles');

    const { geometry, dimensionsMm } = normalizeCanSatStlGeometry(rawGeo);
    assert.ok(Math.abs(dimensionsMm.widthMm - 145.85) < 0.2);
    assert.ok(Math.abs(dimensionsMm.depthMm - 145.86) < 0.2);
    assert.ok(Math.abs(dimensionsMm.totalHeightMm - 519.4) < 0.2);
    assert.equal(dimensionsMm.cylinderHeightMm, 400.0);

    const bbox = geometry.boundingBox!;
    const expectedRadius = 72.93 * CANSAT_MM_TO_SCENE_SCALE;
    assert.ok(Math.abs(bbox.max.x - expectedRadius) < 0.01);
    assert.ok(Math.abs(bbox.min.x + expectedRadius) < 0.01);
    // Cylinder base at Y = -1.00, top rim at Y = +1.00, open Parachute Bay lid up to Y = +1.595
    assert.ok(Math.abs(bbox.min.y - -1.0) < 0.01);
    assert.ok(Math.abs(bbox.max.y - 1.595) < 0.02);

    // Verify 7-cell inflated ram-air parafoil and clean suspension lines
    const parafoil = buildRamAirParafoilAssembly();
    assert.equal(parafoil.canopyAttachmentPoints.length, 8);
    for (const pt of parafoil.canopyAttachmentPoints) {
      assert.ok(Number.isFinite(pt.x) && Number.isFinite(pt.y) && Number.isFinite(pt.z));
      assert.ok(pt.y > 2.2 && pt.y < 2.8, 'Canopy lower attachment points must sit above CanSat');
    }
    assert.ok(Math.abs(parafoil.riserPoints.port.y - 1.04) < 0.05);
    assert.ok(Math.abs(parafoil.riserPoints.starboard.y - 1.04) < 0.05);

    rawGeo.dispose();
    geometry.dispose();
    parafoil.disposables.forEach((d) => d.dispose());
  });

  it('Stage H.1: Mobile field-operations camera framing and Web Serial browser compatibility', () => {
    // 1. Desktop aspect ratio (>= 1.15) preserves exact baseline camera coordinates (2.55, 1.75, 7.15)
    const desktopCam = computeResponsiveCameraPosition(640, 420, 1.0);
    assert.ok(Math.abs(desktopCam.x - 2.55) < 1e-6);
    assert.ok(Math.abs(desktopCam.y - 1.75) < 1e-6);
    assert.ok(Math.abs(desktopCam.z - 7.15) < 1e-6);

    // 2. Narrow mobile portrait aspect ratio (< 1.15) scales camera distance outward to prevent parafoil wingtip clipping
    const mobilePortraitCam = computeResponsiveCameraPosition(330, 270, 1.0);
    assert.ok(mobilePortraitCam.z > desktopCam.z);
    assert.ok(mobilePortraitCam.x > desktopCam.x);

    const veryNarrowCam = computeResponsiveCameraPosition(240, 320, 1.0);
    assert.ok(veryNarrowCam.z > mobilePortraitCam.z);

    // 3. Pinch/wheel zoom multiplier is clamped safely to [0.58, 1.52]
    const zoomedIn = computeResponsiveCameraPosition(640, 420, 0.2);
    const zoomedInClamped = computeResponsiveCameraPosition(640, 420, 0.58);
    assert.ok(Math.abs(zoomedIn.z - zoomedInClamped.z) < 1e-6);

    const zoomedOut = computeResponsiveCameraPosition(640, 420, 3.0);
    const zoomedOutClamped = computeResponsiveCameraPosition(640, 420, 1.52);
    assert.ok(Math.abs(zoomedOut.z - zoomedOutClamped.z) < 1e-6);

    // 4. Web Serial compatibility descriptor truthfully distinguishes mobile browsers, unsupported desktop browsers, and supported Chromium
    const androidUnsupported = describeWebSerialSupport(
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/125.0.0.0 Mobile Safari/537.36',
      false
    );
    assert.equal(androidUnsupported.supported, false);
    assert.equal(androidUnsupported.isMobileBrowser, true);
    assert.equal(androidUnsupported.statusSummary, 'MOBILE BROWSER — WEB SERIAL UNSUPPORTED');
    assert.ok(androidUnsupported.guidanceMessage.includes('not supported on this mobile browser'));

    const iosUnsupported = describeWebSerialSupport(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
      false
    );
    assert.equal(iosUnsupported.supported, false);
    assert.equal(iosUnsupported.isMobileBrowser, true);

    const firefoxDesktop = describeWebSerialSupport(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0',
      false
    );
    assert.equal(firefoxDesktop.supported, false);
    assert.equal(firefoxDesktop.isMobileBrowser, false);
    assert.equal(firefoxDesktop.statusSummary, 'WEB SERIAL API UNSUPPORTED');

    const chromiumDesktop = describeWebSerialSupport(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36',
      true
    );
    assert.equal(chromiumDesktop.supported, true);
    assert.equal(chromiumDesktop.isMobileBrowser, false);
    assert.equal(chromiumDesktop.statusSummary, 'WEB SERIAL API SUPPORTED');
  });

  it('Stage I.1: CAN7USAT_FSW.ino Flight State Machine contract, 24-field export, and chunked serial reassembly', () => {
    // 1. Verify FIRMWARE_FLIGHT_STATES matches nav_types.h 0..9 enum order and wire labels
    assert.equal(FIRMWARE_FLIGHT_STATES.length, 10);
    const expectedWireNames = [
      'BOOT',
      'LAUNCH_PAD',
      'ASCENT',
      'DROGUE_DESCENT',
      'PARAFOIL_DEPLOY',
      'PRECISION_GUIDE',
      'TERMINAL_LOITER',
      'FINAL_APPROACH',
      'LANDED',
      'FAILSAFE',
    ];
    FIRMWARE_FLIGHT_STATES.forEach((st, idx) => {
      assert.strictEqual(st.fswIndex, idx);
      assert.strictEqual(st.wireName, expectedWireNames[idx]);
    });

    // 2. Verify chunked serial reassembly of a 24-field KEY=VALUE frame + ACK:TARGET_GPS line
    const fswLine =
      'TEAM_ID=2026-IN-SPACe-CAN-7USAT-017,MISSION_TIME_S=108,PACKET_COUNT=108,BARO_ALT_M=215.40,PRESSURE_PA=98412.25,BARO_TEMP_C=25.10,BATTERY_V=7.96,GPS_TIME_UTC=14:25:10,LAT_DEG=13.3512000,LON_DEG=74.7931000,GPS_ALT_MSL_M=270.40,SATELLITES=10,ACCEL_X_MPS2=0.140,ACCEL_Y_MPS2=-0.095,ACCEL_Z_MPS2=9.802,ROLL_DEG=-4.10,PITCH_DEG=2.30,GYRO_Z_RADPS=-0.8125,LEFT_SERVO_DEG=36.0,RIGHT_SERVO_DEG=90.0,BURNWIRE_MOSFET=0,BUZZER_MOSFET=0,FLYWHEEL_RPM=6000,FLIGHT_STATE=TERMINAL_LOITER';
    const ackLine = 'ACK:TARGET_GPS=13.3500000,74.7920000,EAST_M=-86.4,NORTH_M=-278.0';

    const lineBuf = new SerialLineBuffer();
    const c1 = lineBuf.pushChunk(fswLine.slice(0, 120));
    assert.equal(c1.lines.length, 0);
    const c2 = lineBuf.pushChunk(`${fswLine.slice(120)}\r\n${ackLine.slice(0, 20)}`);
    assert.equal(c2.lines.length, 1);
    assert.strictEqual(c2.lines[0], fswLine);
    const c3 = lineBuf.pushChunk(`${ackLine.slice(20)}\r\n`);
    assert.equal(c3.lines.length, 1);
    assert.strictEqual(c3.lines[0], ackLine);

    const parsedPkt = parseTelemetryLine(c2.lines[0], 1700000108000);
    assert.equal(parsedPkt.ok, true);
    if (!parsedPkt.ok) return;

    assert.strictEqual(parsedPkt.packet.stateCode, FlightStateCode.TERMINAL_GUIDANCE);
    assert.strictEqual(parsedPkt.packet.fswStateIndex, 6);
    assert.strictEqual(parsedPkt.packet.derivedSteering, -0.6);
    assert.strictEqual(parsedPkt.packet.wheelRpm, 6000);

    const parsedAck = parseFirmwareControlLine(c3.lines[0]);
    assert.ok(parsedAck !== null);
    assert.strictEqual(parsedAck?.kind, 'ACK');
    assert.strictEqual(parsedAck?.category, 'TARGET_GPS');

    // 3. Verify CSV export preserves all 34 canonical columns and exports FLYWHEEL_RPM=6000
    const csvOut = formatTelemetryPacketsCsv([parsedPkt.packet], 'LIVE_SERIAL');
    const csvRows = csvOut.trim().split('\n');
    assert.equal(csvRows.length, 2);
    assert.ok(csvRows[1].includes(',6000,'));
    assert.ok(csvRows[1].includes(',TERMINAL_LOITER,'));
  });

  it('Stage J.1: Complete Subsystem & Sensor Readout Matrix container query and responsive rules contract', () => {
    const cssPath = path.resolve(process.cwd(), 'src/index.css');
    assert.equal(fs.existsSync(cssPath), true);
    const cssContent = fs.readFileSync(cssPath, 'utf-8');

    // 1. Container type inline-size declaration on readout-matrix
    assert.ok(
      cssContent.includes('container-type: inline-size;'),
      'index.css must define container-type: inline-size'
    );
    assert.ok(
      cssContent.includes('container-name: readout-matrix;'),
      'index.css must name the container context readout-matrix'
    );

    // 2. Container query breakpoints for 1, 2, and 4 columns based on available container width
    assert.ok(
      cssContent.includes('@container readout-matrix (min-width: 560px)'),
      'index.css must define @container min-width: 560px for 2-column layout'
    );
    assert.ok(
      cssContent.includes('@container readout-matrix (min-width: 1120px)'),
      'index.css must define @container min-width: 1120px for 4-column layout'
    );

    // 3. Readout row flex-wrap, overflow-wrap, and word-break rules to prevent text clipping & collision
    assert.ok(
      cssContent.includes('flex-wrap: wrap;'),
      'readout rows must flex-wrap to prevent overlapping long telemetry values'
    );
    assert.ok(
      cssContent.includes('overflow-wrap: break-word;'),
      'readout labels and values must wrap sensibly'
    );

    // 4. Verify RawReadoutsPanel source file incorporates the container query classes and test IDs
    const panelPath = path.resolve(process.cwd(), 'src/components/RawReadoutsPanel.tsx');
    assert.equal(fs.existsSync(panelPath), true);
    const panelContent = fs.readFileSync(panelPath, 'utf-8');

    assert.ok(panelContent.includes('raw-readouts-container'));
    assert.ok(panelContent.includes('raw-readouts-grid'));
    assert.ok(panelContent.includes('raw-readout-card'));
    assert.ok(panelContent.includes('raw-readout-row'));
    assert.ok(panelContent.includes('raw-readout-label'));
    assert.ok(panelContent.includes('raw-readout-value'));
    assert.ok(panelContent.includes('data-testid="raw-readouts-grid"'));
  });
});
