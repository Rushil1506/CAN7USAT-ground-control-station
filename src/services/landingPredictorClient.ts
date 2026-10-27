/**
 * CAN-7USAT Ground Control Station — Stage 3 Landing Predictor Client & Deterministic ENU Engine.
 *
 * Architecture & Safety Guarantees:
 * 1. Primary Method: Physics-based local tangent-plane (ENU) baseline anchored dynamically
 *    to the latest valid GPS fix (lat_n, lon_n).
 * 2. Wind Observability: GPS-derived horizontal ground velocity already equals (v_air + v_wind).
 *    No separate wind vector is ever added, preventing the double-counting defect in Notebook Cell 15.
 * 3. Configurable Altitude & Mission Profile Assumptions:
 *    - Barometric altitude reference (`altitude_source`, `baro_ground_offset_m`, `ground_elevation_amsl_m`)
 *      and two-stage descent parameters (`propagation_mode`, `parafoil_transition_altitude_m`,
 *      `stage1_nominal_descent_rate_ms`, `stage2_nominal_descent_rate_ms`) are explicit and configurable.
 * 4. Input/Trajectory Stability Diagnostic:
 *    - Never labeled as a calibrated landing-accuracy probability (`is_calibrated_probability: false`).
 *    - Always accompanied by `LANDING_ACCURACY_DISCLAIMER`.
 * 5. Hardware Isolation:
 *    - Strictly receive-only telemetry evaluation; never writes to serial hardware.
 */

import { BASE_GPS } from '../constants';
import { TelemetryPacket, TelemetrySource } from '../types';

export const EARTH_RADIUS_M = 6_371_000.0;

export const LANDING_ACCURACY_DISCLAIMER =
  'Input/trajectory stability diagnostic only — NOT a calibrated landing-accuracy ' +
  'probability or confidence interval. True landing-position accuracy is unknown and ' +
  'sensitive to unmodeled wind shear below the vehicle and velocity estimation error ' +
  'amplified by remaining descent time.';

export type AltitudeSourceMode =
  | 'BARO_PREFERRED'
  | 'BARO_ONLY'
  | 'GPS_AMSL_MINUS_GROUND';

export type DescentPropagationMode =
  | 'OBSERVED_RATE'
  | 'TWO_STAGE_CONFIGURABLE';

export type StabilityTier = 'LOW' | 'MEDIUM' | 'HIGH';

export type PredictorReasonCode =
  | 'VALID'
  | 'NO_VALID_GPS_FIX'
  | 'INSUFFICIENT_GPS_HISTORY'
  | 'TELEMETRY_STALE'
  | 'NOT_DESCENDING'
  | 'TOUCHDOWN_COMPLETE'
  | 'ALTITUDE_UNAVAILABLE'
  | 'EXPERIMENTAL_RNN_DISABLED'
  | 'MODEL_UNTRAINED'
  | 'INVALID_OUTPUT';

export interface PredictorConfigPayload {
  altitude_source: AltitudeSourceMode;
  baro_ground_offset_m: number;
  ground_elevation_amsl_m: number;
  altitude_reference_verified: boolean;
  propagation_mode: DescentPropagationMode;
  parafoil_transition_altitude_m: number;
  stage1_nominal_descent_rate_ms: number;
  stage2_nominal_descent_rate_ms: number;
  mission_profile_verified: boolean;
  velocity_window_seconds: number;
  max_window_samples: number;
  min_valid_points: number;
  min_dt_seconds: number;
  min_window_span_seconds: number;
  stale_threshold_seconds: number;
  min_descent_rate_ms: number;
  max_plausible_descent_rate_ms: number;
  max_plausible_ground_speed_ms: number;
  touchdown_altitude_m: number;
  target_lat_deg: number | null;
  target_lon_deg: number | null;
  launch_lat_deg: number | null;
  launch_lon_deg: number | null;
  enable_experimental_rnn: boolean;
  rnn_artifact_path: string | null;
}

export const DEFAULT_PREDICTOR_CONFIG: PredictorConfigPayload = {
  altitude_source: 'BARO_PREFERRED',
  baro_ground_offset_m: 0.0,
  ground_elevation_amsl_m: 55.0,
  altitude_reference_verified: false,
  propagation_mode: 'OBSERVED_RATE',
  parafoil_transition_altitude_m: 600.0,
  stage1_nominal_descent_rate_ms: 17.0,
  stage2_nominal_descent_rate_ms: 2.2,
  mission_profile_verified: false,
  velocity_window_seconds: 8.0,
  max_window_samples: 12,
  min_valid_points: 3,
  min_dt_seconds: 0.2,
  min_window_span_seconds: 0.8,
  stale_threshold_seconds: 3.0,
  min_descent_rate_ms: 0.5,
  max_plausible_descent_rate_ms: 60.0,
  max_plausible_ground_speed_ms: 65.0,
  touchdown_altitude_m: 2.0,
  target_lat_deg: null,
  target_lon_deg: null,
  launch_lat_deg: BASE_GPS.latitude,
  launch_lon_deg: BASE_GPS.longitude,
  enable_experimental_rnn: false,
  rnn_artifact_path: null,
};

export interface TrajectoryMetricsPayload {
  anchor_lat_deg: number;
  anchor_lon_deg: number;
  remaining_altitude_m: number;
  altitude_source_used: string;
  ground_velocity_east_ms: number;
  ground_velocity_north_ms: number;
  horizontal_ground_speed_ms: number;
  ground_track_heading_deg: number;
  vertical_descent_rate_ms: number;
  window_sample_count: number;
  window_duration_s: number;
  latest_sample_age_s: number;
  rejected_invalid_gps_count: number;
  rejected_duplicate_timestamp_count: number;
  window_position_rmse_m: number;
  velocity_std_error_ms: number;
  descent_rate_std_error_ms: number;
  extrapolated_position_std_error_m: number;
}

export interface LandingPredictionOutputPayload {
  predicted_lat_deg: number;
  predicted_lon_deg: number;
  predicted_east_offset_m: number;
  predicted_north_offset_m: number;
  horizontal_drift_distance_m: number;
  drift_bearing_deg: number;
  estimated_time_to_landing_s: number;
  propagation_mode_used: string;
  stage1_time_remaining_s: number | null;
  stage2_time_remaining_s: number | null;
  distance_from_launch_m: number | null;
  bearing_from_launch_deg: number | null;
  distance_to_target_m: number | null;
  bearing_to_target_deg: number | null;
}

export interface PredictionResponsePayload {
  valid: boolean;
  status: string;
  reason_code: PredictorReasonCode;
  reason_message: string;
  method: string;
  source: 'LIVE' | 'SIMULATION';
  input_trajectory_stability_tier: StabilityTier;
  input_trajectory_stability_score: number;
  heuristic_diagnostic_quality: StabilityTier;
  heuristic_stability_score: number;
  is_calibrated_probability: false;
  landing_accuracy_warning: string;
  prediction: LandingPredictionOutputPayload | null;
  trajectory_metrics: TrajectoryMetricsPayload | null;
  observability_notes: {
    observable_from_telemetry: string[];
    unobservable_without_independent_wind_sensor: string[];
    wind_handling_policy: string;
    extrapolation_error_model: string;
  };
  assumptions: Record<string, unknown>;
}

export function latLonToEnu(
  latDeg: number,
  lonDeg: number,
  refLatDeg: number,
  refLonDeg: number
): [number, number] {
  const dLatRad = ((latDeg - refLatDeg) * Math.PI) / 180.0;
  const dLonRad = ((lonDeg - refLonDeg) * Math.PI) / 180.0;
  const refLatRad = (refLatDeg * Math.PI) / 180.0;
  const eastM = EARTH_RADIUS_M * dLonRad * Math.cos(refLatRad);
  const northM = EARTH_RADIUS_M * dLatRad;
  return [eastM, northM];
}

export function enuToLatLon(
  eastM: number,
  northM: number,
  refLatDeg: number,
  refLonDeg: number
): [number, number] {
  const refLatRad = (refLatDeg * Math.PI) / 180.0;
  const cosLat = Math.cos(refLatRad);
  if (Math.abs(cosLat) < 1e-12) {
    throw new Error('Reference latitude too close to geographic pole for ENU conversion.');
  }
  const dLatDeg = (northM / EARTH_RADIUS_M) * (180.0 / Math.PI);
  const dLonDeg = (eastM / (EARTH_RADIUS_M * cosLat)) * (180.0 / Math.PI);
  return [refLatDeg + dLatDeg, refLonDeg + dLonDeg];
}

export function calculateHaversineDistanceM(
  lat1Deg: number,
  lon1Deg: number,
  lat2Deg: number,
  lon2Deg: number
): number {
  const lat1Rad = (lat1Deg * Math.PI) / 180.0;
  const lat2Rad = (lat2Deg * Math.PI) / 180.0;
  const dLatRad = ((lat2Deg - lat1Deg) * Math.PI) / 180.0;
  const dLonRad = ((lon2Deg - lon1Deg) * Math.PI) / 180.0;
  const sinDLat = Math.sin(dLatRad / 2.0);
  const sinDLon = Math.sin(dLonRad / 2.0);
  const a = Math.min(
    1.0,
    Math.max(
      0.0,
      sinDLat * sinDLat +
        Math.cos(lat1Rad) * Math.cos(lat2Rad) * sinDLon * sinDLon
    )
  );
  const c = 2.0 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0.0, 1.0 - a)));
  return EARTH_RADIUS_M * c;
}

export function calculateForwardBearingDeg(
  lat1Deg: number,
  lon1Deg: number,
  lat2Deg: number,
  lon2Deg: number
): number {
  const lat1Rad = (lat1Deg * Math.PI) / 180.0;
  const lat2Rad = (lat2Deg * Math.PI) / 180.0;
  const dLonRad = ((lon2Deg - lon1Deg) * Math.PI) / 180.0;
  const y = Math.sin(dLonRad) * Math.cos(lat2Rad);
  const x =
    Math.cos(lat1Rad) * Math.sin(lat2Rad) -
    Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLonRad);
  if (Math.abs(x) < 1e-15 && Math.abs(y) < 1e-15) {
    return 0.0;
  }
  const bearingDeg = (Math.atan2(y, x) * 180.0) / Math.PI;
  return (bearingDeg + 360.0) % 360.0;
}

export function isValidCoordinateFix(
  latDeg: number | null | undefined,
  lonDeg: number | null | undefined,
  gpsValidFlag = true
): latDeg is number {
  if (!gpsValidFlag) return false;
  if (typeof latDeg !== 'number' || typeof lonDeg !== 'number') return false;
  if (!Number.isFinite(latDeg) || !Number.isFinite(lonDeg)) return false;
  if (Math.abs(latDeg) > 90.0 || Math.abs(lonDeg) > 180.0) return false;
  if (Math.abs(latDeg) < 1e-5 && Math.abs(lonDeg) < 1e-5) return false;
  return true;
}

export interface TargetCoordinateValidationResult {
  valid: boolean;
  latDeg: number;
  lonDeg: number;
  error: string | null;
}

export function parseAndValidateTargetCoordinates(
  latInput: string,
  lonInput: string
): TargetCoordinateValidationResult {
  const latDeg = Number.parseFloat(latInput.trim());
  const lonDeg = Number.parseFloat(lonInput.trim());

  if (!Number.isFinite(latDeg) || !Number.isFinite(lonDeg)) {
    return {
      valid: false,
      latDeg: 0,
      lonDeg: 0,
      error: 'Enter valid numeric latitude (-90..90) and longitude (-180..180).',
    };
  }
  if (latDeg < -90.0 || latDeg > 90.0 || lonDeg < -180.0 || lonDeg > 180.0) {
    return {
      valid: false,
      latDeg: 0,
      lonDeg: 0,
      error: 'Coordinates out of range: latitude [-90, 90], longitude [-180, 180].',
    };
  }
  if (Math.abs(latDeg) < 1e-5 && Math.abs(lonDeg) < 1e-5) {
    return {
      valid: false,
      latDeg: 0,
      lonDeg: 0,
      error: 'Invalid (0.0000, 0.0000) Null Island coordinate rejected.',
    };
  }
  return { valid: true, latDeg, lonDeg, error: null };
}

export function shouldDisplayPredictedOverlay(
  prediction: PredictionResponsePayload | null | undefined,
  isStale: boolean,
  canSatLat: number | null,
  canSatLon: number | null
): boolean {
  if (isStale) return false;
  if (canSatLat === null || canSatLon === null) return false;
  if (!prediction || !prediction.valid || !prediction.prediction) return false;
  return isValidCoordinateFix(
    prediction.prediction.predicted_lat_deg,
    prediction.prediction.predicted_lon_deg,
    true
  );
}

interface LinearFitResult {
  slope: number;
  interceptAtZero: number;
  rSquared: number;
  residualRmse: number;
  slopeStdError: number;
}

function linearLeastSquaresFit(timesS: number[], values: number[]): LinearFitResult {
  const n = timesS.length;
  if (n < 2) {
    return {
      slope: 0.0,
      interceptAtZero: 0.0,
      rSquared: 0.0,
      residualRmse: 0.0,
      slopeStdError: 0.0,
    };
  }
  const tMean = timesS.reduce((acc, v) => acc + v, 0.0) / n;
  const vMean = values.reduce((acc, v) => acc + v, 0.0) / n;

  let ssTt = 0.0;
  let ssTv = 0.0;
  let ssVv = 0.0;
  for (let i = 0; i < n; i++) {
    const dt = timesS[i] - tMean;
    const dv = values[i] - vMean;
    ssTt += dt * dt;
    ssTv += dt * dv;
    ssVv += dv * dv;
  }

  if (ssTt < 1e-12) {
    return {
      slope: 0.0,
      interceptAtZero: vMean,
      rSquared: 0.0,
      residualRmse: 0.0,
      slopeStdError: 0.0,
    };
  }

  const slope = ssTv / ssTt;
  const interceptAtZero = vMean - slope * tMean;
  let rSquared = 1.0;
  let ssr = 0.0;
  if (ssVv >= 1e-12) {
    rSquared = Math.max(0.0, Math.min(1.0, (ssTv * ssTv) / (ssTt * ssVv)));
    ssr = Math.max(0.0, ssVv - slope * ssTv);
  }
  const dof = Math.max(1, n - 2);
  const residualRmse = n >= 3 ? Math.sqrt(ssr / dof) : 0.0;
  const slopeStdError = n >= 3 ? residualRmse / Math.sqrt(ssTt) : 0.0;

  return {
    slope,
    interceptAtZero,
    rSquared,
    residualRmse,
    slopeStdError,
  };
}

interface NormalizedPoint {
  timestampS: number;
  latDeg: number;
  lonDeg: number;
  baroAltitudeM: number | null;
  gpsAltitudeAmslM: number | null;
  gpsValid: boolean;
  verticalSpeedMs: number | null;
}

export function resolvePacketTimestampSeconds(
  packet: TelemetryPacket,
  telemetrySource: TelemetrySource
): number {
  if (
    telemetrySource === 'SIMULATION' &&
    typeof packet.missionTimeSeconds === 'number' &&
    Number.isFinite(packet.missionTimeSeconds)
  ) {
    return packet.missionTimeSeconds;
  }
  if (typeof packet.receivedAtMs === 'number' && Number.isFinite(packet.receivedAtMs)) {
    return packet.receivedAtMs / 1000.0;
  }
  if (
    typeof packet.missionTimeSeconds === 'number' &&
    Number.isFinite(packet.missionTimeSeconds)
  ) {
    return packet.missionTimeSeconds;
  }
  return Date.now() / 1000.0;
}

function resolveRemainingAltitudeM(
  pt: NormalizedPoint,
  cfg: PredictorConfigPayload
): [number | null, string] {
  const baroValid =
    pt.baroAltitudeM !== null && Number.isFinite(pt.baroAltitudeM);
  const gpsAltValid =
    pt.gpsAltitudeAmslM !== null && Number.isFinite(pt.gpsAltitudeAmslM);

  if (cfg.altitude_source === 'BARO_ONLY') {
    if (!baroValid) return [null, 'UNAVAILABLE'];
    return [
      pt.baroAltitudeM! - cfg.baro_ground_offset_m,
      'BARO_MINUS_OFFSET',
    ];
  }
  if (cfg.altitude_source === 'GPS_AMSL_MINUS_GROUND') {
    if (!gpsAltValid) return [null, 'UNAVAILABLE'];
    return [
      pt.gpsAltitudeAmslM! - cfg.ground_elevation_amsl_m,
      'GPS_AMSL_MINUS_GROUND',
    ];
  }
  if (baroValid) {
    return [
      pt.baroAltitudeM! - cfg.baro_ground_offset_m,
      'BARO_MINUS_OFFSET',
    ];
  }
  if (gpsAltValid) {
    return [
      pt.gpsAltitudeAmslM! - cfg.ground_elevation_amsl_m,
      'GPS_AMSL_MINUS_GROUND',
    ];
  }
  return [null, 'UNAVAILABLE'];
}

function computeInputTrajectoryStability(
  windowPoints: NormalizedPoint[],
  windowSpanS: number,
  windowPositionRmseM: number,
  extrapolatedPositionStdErrorM: number,
  descentRateMs: number
): [StabilityTier, number] {
  const n = windowPoints.length;
  const sampleFactor =
    Math.min(1.0, Math.max(0.0, (n - 2) / 6.0)) *
    Math.min(1.0, Math.max(0.0, windowSpanS / 6.0));

  const dts: number[] = [];
  for (let i = 1; i < n; i++) {
    dts.push(windowPoints[i].timestampS - windowPoints[i - 1].timestampS);
  }
  const maxDt = dts.length > 0 ? Math.max(...dts) : 999.0;
  const meanDt =
    dts.length > 0 ? dts.reduce((a, b) => a + b, 0.0) / dts.length : 999.0;

  let regularityFactor = 0.2;
  if (maxDt <= 1.5 * Math.max(1.0, meanDt) && maxDt <= 2.5) {
    regularityFactor = 1.0;
  } else if (maxDt <= 5.0) {
    regularityFactor = 0.55;
  }

  const jitterFactor = Math.exp(-Math.pow(windowPositionRmseM / 1.7, 2));
  const extrapFactor =
    1.0 / (1.0 + Math.pow(extrapolatedPositionStdErrorM / 15.0, 2));
  const descentFactor =
    descentRateMs >= 1.0 && descentRateMs <= 30.0 ? 1.0 : 0.5;

  const rawScore =
    0.35 * jitterFactor +
    0.3 * extrapFactor +
    0.2 * sampleFactor +
    0.1 * regularityFactor +
    0.05 * descentFactor;
  const score = Math.max(0.0, Math.min(1.0, rawScore));

  let tier: StabilityTier = 'LOW';
  if (
    score >= 0.8 &&
    n >= 5 &&
    maxDt <= 2.5 &&
    windowPositionRmseM <= 0.75 &&
    extrapolatedPositionStdErrorM <= 10.0
  ) {
    tier = 'HIGH';
  } else if (score >= 0.45 && n >= 3 && windowPositionRmseM <= 3.5) {
    tier = 'MEDIUM';
  }

  return [tier, Number(score.toFixed(4))];
}

/**
 * Deterministic TypeScript mirror of `predictor_service/predictor_engine.py`.
 * Ensures identical behavior when the Python HTTP server is offline or during unit tests.
 */
export function computeLocalPhysicsPrediction(
  historyPackets: TelemetryPacket[],
  config: PredictorConfigPayload = DEFAULT_PREDICTOR_CONFIG,
  telemetrySource: TelemetrySource = 'SIMULATION',
  packetAgeSecondsOverride: number | null = null,
  isStaleOverride = false
): PredictionResponsePayload {
  const sourceLabel: 'LIVE' | 'SIMULATION' =
    telemetrySource === 'LIVE_SERIAL' || telemetrySource === 'REMOTE_VIEWER' ? 'LIVE' : 'SIMULATION';

  const observabilityNotes = {
    observable_from_telemetry: [
      'gps_horizontal_position_lat_lon',
      'gps_horizontal_ground_velocity_east_north_ms',
      'barometric_altitude_m',
      'gnss_altitude_amsl_m',
      'vertical_descent_rate_ms',
    ],
    unobservable_without_independent_wind_sensor: [
      'air_relative_horizontal_velocity_ms',
      'ambient_wind_velocity_vector_ms',
      'altitude_dependent_wind_shear_profile',
    ],
    wind_handling_policy:
      'GPS-derived horizontal velocity already equals (v_air + v_wind). No separate wind vector is added to prevent double-counting wind.',
    extrapolation_error_model:
      'Horizontal landing error scales with OLS velocity standard error SE(v_horiz) multiplied by remaining descent time t_rem, plus anchor position noise and any unmodeled wind shear below the vehicle.',
  };

  const assumptions: Record<string, unknown> = {
    altitude_source: config.altitude_source,
    baro_ground_offset_m: config.baro_ground_offset_m,
    ground_elevation_amsl_m: config.ground_elevation_amsl_m,
    altitude_reference_verified_against_firmware:
      config.altitude_reference_verified,
    propagation_mode: config.propagation_mode,
    parafoil_transition_altitude_m: config.parafoil_transition_altitude_m,
    stage1_nominal_descent_rate_ms: config.stage1_nominal_descent_rate_ms,
    stage2_nominal_descent_rate_ms: config.stage2_nominal_descent_rate_ms,
    mission_profile_verified_against_official_spec:
      config.mission_profile_verified,
    constant_ground_velocity_extrapolation: true,
  };

  const buildInvalid = (
    status: string,
    reasonCode: PredictorReasonCode,
    reasonMessage: string,
    method = 'PHYSICS_ENU_BASELINE',
    metrics: TrajectoryMetricsPayload | null = null
  ): PredictionResponsePayload => ({
    valid: false,
    status,
    reason_code: reasonCode,
    reason_message: reasonMessage,
    method,
    source: sourceLabel,
    input_trajectory_stability_tier: 'LOW',
    input_trajectory_stability_score: 0.0,
    heuristic_diagnostic_quality: 'LOW',
    heuristic_stability_score: 0.0,
    is_calibrated_probability: false,
    landing_accuracy_warning: LANDING_ACCURACY_DISCLAIMER,
    prediction: null,
    trajectory_metrics: metrics,
    observability_notes: observabilityNotes,
    assumptions,
  });

  if (config.enable_experimental_rnn) {
    return buildInvalid(
      'Experimental RNN Unavailable',
      'MODEL_UNTRAINED',
      'Experimental RNN mode was requested, but no validated trained model artifact exists at the configured path.',
      'EXPERIMENTAL_RNN_UNAVAILABLE'
    );
  }

  const validHistory: NormalizedPoint[] = [];
  let rejectedInvalidGps = 0;
  let rejectedDuplicateTs = 0;
  let latestFixLost = false;

  for (const pkt of historyPackets) {
    const tsS = resolvePacketTimestampSeconds(pkt, telemetrySource);
    if (!Number.isFinite(tsS)) {
      rejectedInvalidGps += 1;
      continue;
    }

    if (validHistory.length > 0) {
      const dt = tsS - validHistory[validHistory.length - 1].timestampS;
      if (dt < config.min_dt_seconds) {
        rejectedDuplicateTs += 1;
        continue;
      }
    }

    const gpsOk =
      pkt.gpsValid !== false &&
      pkt.gpsFixType !== 'NO_FIX' &&
      (typeof pkt.gpsSats !== 'number' || pkt.gpsSats > 0) &&
      isValidCoordinateFix(pkt.latitude, pkt.longitude, true);

    if (!gpsOk) {
      rejectedInvalidGps += 1;
      latestFixLost = true;
      continue;
    }

    latestFixLost = false;
    validHistory.push({
      timestampS: tsS,
      latDeg: pkt.latitude!,
      lonDeg: pkt.longitude!,
      baroAltitudeM:
        typeof pkt.altitude === 'number' && Number.isFinite(pkt.altitude)
          ? pkt.altitude
          : null,
      gpsAltitudeAmslM:
        typeof pkt.gpsAltitude === 'number' && Number.isFinite(pkt.gpsAltitude)
          ? pkt.gpsAltitude
          : null,
      gpsValid: true,
      verticalSpeedMs:
        typeof pkt.velocity === 'number' && Number.isFinite(pkt.velocity)
          ? pkt.velocity
          : null,
    });
  }

  const maxKeep = Math.max(120, config.max_window_samples * 5);
  if (validHistory.length > maxKeep) {
    validHistory.splice(0, validHistory.length - maxKeep);
  }

  if (validHistory.length === 0 || latestFixLost) {
    return buildInvalid(
      'Waiting for valid GPS fix',
      'NO_VALID_GPS_FIX',
      latestFixLost
        ? 'Latest telemetry packet does not contain a valid GPS fix.'
        : 'No valid GPS coordinates have been received.'
    );
  }

  const latest = validHistory[validHistory.length - 1];
  const rawAgeS =
    packetAgeSecondsOverride !== null && Number.isFinite(packetAgeSecondsOverride)
      ? Math.max(0.0, packetAgeSecondsOverride)
      : 0.0;
  const sampleAgeS = isStaleOverride
    ? Math.max(config.stale_threshold_seconds + 1.0, rawAgeS)
    : rawAgeS;

  const [remainingAltM, altSourceUsed] = resolveRemainingAltitudeM(
    latest,
    config
  );
  if (remainingAltM === null) {
    return buildInvalid(
      'Altitude Unavailable',
      'ALTITUDE_UNAVAILABLE',
      `Could not resolve remaining altitude using source ${config.altitude_source}.`
    );
  }

  if (isStaleOverride || sampleAgeS > config.stale_threshold_seconds) {
    return buildInvalid(
      'Telemetry Stale',
      'TELEMETRY_STALE',
      `Latest valid GPS fix is ${sampleAgeS.toFixed(2)} s old (threshold: ${config.stale_threshold_seconds.toFixed(2)} s).`
    );
  }

  if (remainingAltM <= config.touchdown_altitude_m) {
    const tdMetrics: TrajectoryMetricsPayload = {
      anchor_lat_deg: latest.latDeg,
      anchor_lon_deg: latest.lonDeg,
      remaining_altitude_m: Number(Math.max(0.0, remainingAltM).toFixed(4)),
      altitude_source_used: altSourceUsed,
      ground_velocity_east_ms: 0.0,
      ground_velocity_north_ms: 0.0,
      horizontal_ground_speed_ms: 0.0,
      ground_track_heading_deg: 0.0,
      vertical_descent_rate_ms: 0.0,
      window_sample_count: validHistory.length,
      window_duration_s: 0.0,
      latest_sample_age_s: Number(sampleAgeS.toFixed(3)),
      rejected_invalid_gps_count: rejectedInvalidGps,
      rejected_duplicate_timestamp_count: rejectedDuplicateTs,
      window_position_rmse_m: 0.0,
      velocity_std_error_ms: 0.0,
      descent_rate_std_error_ms: 0.0,
      extrapolated_position_std_error_m: 0.0,
    };
    return buildInvalid(
      'Touchdown Complete',
      'TOUCHDOWN_COMPLETE',
      `Remaining altitude (${remainingAltM.toFixed(2)} m) is at or below touchdown threshold (${config.touchdown_altitude_m.toFixed(2)} m).`,
      'PHYSICS_ENU_BASELINE',
      tdMetrics
    );
  }

  const cutoffTs = latest.timestampS - config.velocity_window_seconds;
  let windowPts = validHistory.filter((pt) => pt.timestampS >= cutoffTs);
  if (
    windowPts.length < config.min_valid_points &&
    validHistory.length >= config.min_valid_points
  ) {
    windowPts = validHistory.slice(-config.min_valid_points);
  }
  if (windowPts.length > config.max_window_samples) {
    windowPts = windowPts.slice(-config.max_window_samples);
  }

  if (windowPts.length < config.min_valid_points) {
    return buildInvalid(
      'Insufficient GPS History',
      'INSUFFICIENT_GPS_HISTORY',
      `Need at least ${config.min_valid_points} valid GPS fixes with distinct timestamps (currently have ${windowPts.length}).`
    );
  }

  const windowSpanS =
    windowPts[windowPts.length - 1].timestampS - windowPts[0].timestampS;
  if (windowSpanS < config.min_window_span_seconds) {
    return buildInvalid(
      'Insufficient Time Span',
      'INSUFFICIENT_GPS_HISTORY',
      `Valid GPS window spans ${windowSpanS.toFixed(2)} s; requires at least ${config.min_window_span_seconds.toFixed(2)} s.`
    );
  }

  const refLat = latest.latDeg;
  const refLon = latest.lonDeg;
  const refT = latest.timestampS;

  const relTimes: number[] = [];
  const eastPositionsM: number[] = [];
  const northPositionsM: number[] = [];
  const altitudesM: number[] = [];
  const altTimes: number[] = [];

  for (const pt of windowPts) {
    const [eM, nM] = latLonToEnu(pt.latDeg, pt.lonDeg, refLat, refLon);
    const dtRel = pt.timestampS - refT;
    relTimes.push(dtRel);
    eastPositionsM.push(eM);
    northPositionsM.push(nM);

    const [ptAlt] = resolveRemainingAltitudeM(pt, config);
    if (ptAlt !== null) {
      altitudesM.push(ptAlt);
      altTimes.push(dtRel);
    }
  }

  const eastFit = linearLeastSquaresFit(relTimes, eastPositionsM);
  const northFit = linearLeastSquaresFit(relTimes, northPositionsM);

  const vEastMs = eastFit.slope;
  const vNorthMs = northFit.slope;
  const horizontalSpeedMs = Math.hypot(vEastMs, vNorthMs);
  const groundHeadingDeg =
    horizontalSpeedMs > 1e-3
      ? ((Math.atan2(vEastMs, vNorthMs) * 180.0) / Math.PI + 360.0) % 360.0
      : 0.0;

  const windowPosRmseM = Math.hypot(
    eastFit.residualRmse,
    northFit.residualRmse
  );
  const velStdErrMs = Math.hypot(
    eastFit.slopeStdError,
    northFit.slopeStdError
  );

  let descentRateMs = 0.0;
  let descentRateSeMs = 0.0;
  if (altitudesM.length >= 2) {
    const altFit = linearLeastSquaresFit(altTimes, altitudesM);
    descentRateMs = -altFit.slope;
    descentRateSeMs = altFit.slopeStdError;
  } else if (latest.verticalSpeedMs !== null) {
    descentRateMs = -latest.verticalSpeedMs;
  }

  const metrics: TrajectoryMetricsPayload = {
    anchor_lat_deg: refLat,
    anchor_lon_deg: refLon,
    remaining_altitude_m: Number(remainingAltM.toFixed(4)),
    altitude_source_used: altSourceUsed,
    ground_velocity_east_ms: Number(vEastMs.toFixed(4)),
    ground_velocity_north_ms: Number(vNorthMs.toFixed(4)),
    horizontal_ground_speed_ms: Number(horizontalSpeedMs.toFixed(4)),
    ground_track_heading_deg: Number(groundHeadingDeg.toFixed(2)),
    vertical_descent_rate_ms: Number(descentRateMs.toFixed(4)),
    window_sample_count: windowPts.length,
    window_duration_s: Number(windowSpanS.toFixed(3)),
    latest_sample_age_s: Number(sampleAgeS.toFixed(3)),
    rejected_invalid_gps_count: rejectedInvalidGps,
    rejected_duplicate_timestamp_count: rejectedDuplicateTs,
    window_position_rmse_m: Number(windowPosRmseM.toFixed(4)),
    velocity_std_error_ms: Number(velStdErrMs.toFixed(4)),
    descent_rate_std_error_ms: Number(descentRateSeMs.toFixed(4)),
    extrapolated_position_std_error_m: 0.0,
  };

  if (descentRateMs < config.min_descent_rate_ms) {
    return buildInvalid(
      'Not Actively Descending',
      'NOT_DESCENDING',
      `Observed vertical descent rate is ${descentRateMs.toFixed(2)} m/s (minimum required for active descent: ${config.min_descent_rate_ms.toFixed(2)} m/s).`,
      'PHYSICS_ENU_BASELINE',
      metrics
    );
  }

  if (
    descentRateMs > config.max_plausible_descent_rate_ms ||
    horizontalSpeedMs > config.max_plausible_ground_speed_ms
  ) {
    return buildInvalid(
      'Implausible Telemetry Kinematics',
      'INVALID_OUTPUT',
      `Derived ground speed (${horizontalSpeedMs.toFixed(1)} m/s) or descent rate (${descentRateMs.toFixed(1)} m/s) exceeds physical sanity bounds.`,
      'PHYSICS_ENU_BASELINE',
      metrics
    );
  }

  let tRemS = remainingAltM / descentRateMs;
  let stage1TimeS: number | null = null;
  let stage2TimeS: number | null = null;
  let propModeUsed = 'OBSERVED_RATE';

  if (
    config.propagation_mode === 'TWO_STAGE_CONFIGURABLE' &&
    remainingAltM > config.parafoil_transition_altitude_m
  ) {
    const altStage1 = remainingAltM - config.parafoil_transition_altitude_m;
    const altStage2 = config.parafoil_transition_altitude_m;
    const vStage1 = Math.max(descentRateMs, config.min_descent_rate_ms);
    const vStage2 = Math.max(
      config.stage2_nominal_descent_rate_ms,
      config.min_descent_rate_ms
    );
    stage1TimeS = Number((altStage1 / vStage1).toFixed(4));
    stage2TimeS = Number((altStage2 / vStage2).toFixed(4));
    tRemS = altStage1 / vStage1 + altStage2 / vStage2;
    propModeUsed = `TWO_STAGE_CONFIGURABLE(h_tr=${config.parafoil_transition_altitude_m.toFixed(0)}m,v2=${vStage2.toFixed(2)}m/s)`;
  } else if (config.propagation_mode === 'TWO_STAGE_CONFIGURABLE') {
    stage1TimeS = 0.0;
    stage2TimeS = Number(tRemS.toFixed(4));
  }

  const dtRemSeS =
    descentRateMs > 1e-3
      ? (remainingAltM / (descentRateMs * descentRateMs)) * descentRateSeMs
      : 0.0;
  const extrapPosSeM = Math.hypot(
    velStdErrMs * tRemS,
    horizontalSpeedMs * dtRemSeS
  );
  metrics.extrapolated_position_std_error_m = Number(extrapPosSeM.toFixed(4));

  const predEastM = vEastMs * tRemS;
  const predNorthM = vNorthMs * tRemS;
  const [predLatDeg, predLonDeg] = enuToLatLon(
    predEastM,
    predNorthM,
    refLat,
    refLon
  );

  if (!isValidCoordinateFix(predLatDeg, predLonDeg, true)) {
    return buildInvalid(
      'Invalid Predicted Coordinate',
      'INVALID_OUTPUT',
      'Propagated coordinate failed geodetic sanity validation.',
      'PHYSICS_ENU_BASELINE',
      metrics
    );
  }

  const driftDistanceM = Math.hypot(predEastM, predNorthM);
  const driftBearingDeg = calculateForwardBearingDeg(
    refLat,
    refLon,
    predLatDeg,
    predLonDeg
  );

  let distLaunchM: number | null = null;
  let bearLaunchDeg: number | null = null;
  if (config.launch_lat_deg !== null && config.launch_lon_deg !== null) {
    distLaunchM = Number(
      calculateHaversineDistanceM(
        config.launch_lat_deg,
        config.launch_lon_deg,
        predLatDeg,
        predLonDeg
      ).toFixed(2)
    );
    bearLaunchDeg = Number(
      calculateForwardBearingDeg(
        config.launch_lat_deg,
        config.launch_lon_deg,
        predLatDeg,
        predLonDeg
      ).toFixed(2)
    );
  }

  let distTargetM: number | null = null;
  let bearTargetDeg: number | null = null;
  if (config.target_lat_deg !== null && config.target_lon_deg !== null) {
    distTargetM = Number(
      calculateHaversineDistanceM(
        predLatDeg,
        predLonDeg,
        config.target_lat_deg,
        config.target_lon_deg
      ).toFixed(2)
    );
    bearTargetDeg = Number(
      calculateForwardBearingDeg(
        predLatDeg,
        predLonDeg,
        config.target_lat_deg,
        config.target_lon_deg
      ).toFixed(2)
    );
  }

  const [tier, score] = computeInputTrajectoryStability(
    windowPts,
    windowSpanS,
    windowPosRmseM,
    extrapPosSeM,
    descentRateMs
  );

  return {
    valid: true,
    status: 'Active Physics ENU Prediction',
    reason_code: 'VALID',
    reason_message:
      'Prediction computed from observed GPS ground velocity and descent rate.',
    method: 'PHYSICS_ENU_BASELINE',
    source: sourceLabel,
    input_trajectory_stability_tier: tier,
    input_trajectory_stability_score: score,
    heuristic_diagnostic_quality: tier,
    heuristic_stability_score: score,
    is_calibrated_probability: false,
    landing_accuracy_warning: LANDING_ACCURACY_DISCLAIMER,
    prediction: {
      predicted_lat_deg: Number(predLatDeg.toFixed(7)),
      predicted_lon_deg: Number(predLonDeg.toFixed(7)),
      predicted_east_offset_m: Number(predEastM.toFixed(2)),
      predicted_north_offset_m: Number(predNorthM.toFixed(2)),
      horizontal_drift_distance_m: Number(driftDistanceM.toFixed(2)),
      drift_bearing_deg: Number(driftBearingDeg.toFixed(2)),
      estimated_time_to_landing_s: Number(tRemS.toFixed(2)),
      propagation_mode_used: propModeUsed,
      stage1_time_remaining_s: stage1TimeS,
      stage2_time_remaining_s: stage2TimeS,
      distance_from_launch_m: distLaunchM,
      bearing_from_launch_deg: bearLaunchDeg,
      distance_to_target_m: distTargetM,
      bearing_to_target_deg: bearTargetDeg,
    },
    trajectory_metrics: metrics,
    observability_notes: observabilityNotes,
    assumptions,
  };
}

export type PredictorBackendConnection =
  | 'PYTHON_HTTP_ONLINE'
  | 'LOCAL_FALLBACK_ACTIVE';

export interface EvaluateBackendOptions {
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export async function evaluateLandingPredictionWithBackend(
  historyPackets: TelemetryPacket[],
  config: PredictorConfigPayload,
  telemetrySource: TelemetrySource,
  packetAgeSeconds: number | null,
  isStaleOverride = false,
  endpointBaseUrl = 'http://127.0.0.1:8001',
  options?: EvaluateBackendOptions
): Promise<{
  response: PredictionResponsePayload;
  backendStatus: PredictorBackendConnection;
}> {
  const recentSlice = historyPackets.slice(-150);
  const sourceLabel: 'LIVE' | 'SIMULATION' =
    telemetrySource === 'LIVE_SERIAL' || telemetrySource === 'REMOTE_VIEWER' ? 'LIVE' : 'SIMULATION';

  const pointsPayload = recentSlice.map((pkt) => ({
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

  let latestTs =
    pointsPayload.length > 0
      ? pointsPayload[pointsPayload.length - 1].timestamp_s
      : 0.0;
  for (let i = pointsPayload.length - 1; i >= 0; i -= 1) {
    if (pointsPayload[i].gps_valid) {
      latestTs = pointsPayload[i].timestamp_s;
      break;
    }
  }

  const rawAgeS =
    packetAgeSeconds !== null && Number.isFinite(packetAgeSeconds)
      ? Math.max(0.0, packetAgeSeconds)
      : 0.0;
  const effectiveAgeS = isStaleOverride
    ? Math.max(config.stale_threshold_seconds + 1.0, rawAgeS)
    : rawAgeS;
  const evaluationTimeS = latestTs + effectiveAgeS;

  const fetchFn = options?.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options?.timeoutMs ?? 500;
  const controller = new AbortController();
  const externalSignal = options?.signal;
  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
  }
  const timeoutId = globalThis.setTimeout(() => controller.abort(), timeoutMs);

  try {
    if (typeof fetchFn === 'function' && !controller.signal.aborted) {
      const res = await fetchFn(`${endpointBaseUrl}/api/predictor/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          points: pointsPayload,
          evaluation_time_s: evaluationTimeS,
          config,
        }),
        signal: controller.signal,
      });

      if (res.ok) {
        const json = (await res.json()) as PredictionResponsePayload;
        return {
          response: json,
          backendStatus: 'PYTHON_HTTP_ONLINE',
        };
      }
    }
  } catch {
    // Expected when predictor service is offline or request is aborted; fall back to local physics
  } finally {
    globalThis.clearTimeout(timeoutId);
    if (externalSignal) {
      externalSignal.removeEventListener('abort', onExternalAbort);
    }
  }

  return {
    response: computeLocalPhysicsPrediction(
      historyPackets,
      config,
      telemetrySource,
      packetAgeSeconds,
      isStaleOverride
    ),
    backendStatus: 'LOCAL_FALLBACK_ACTIVE',
  };
}

export interface PredictorCoordinatorOptions {
  minPollIntervalMs?: number;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  requestTimeoutMs?: number;
  endpointBaseUrl?: string;
  fetchImpl?: typeof fetch;
  nowMs?: () => number;
}

export interface PredictorEvaluateParams {
  historyPackets: TelemetryPacket[];
  config: PredictorConfigPayload;
  telemetrySource: TelemetrySource;
  packetAgeSeconds: number | null;
  isStaleOverride?: boolean;
  forceNetwork?: boolean;
}

export interface CoordinatedPredictionResult {
  response: PredictionResponsePayload;
  backendStatus: PredictorBackendConnection;
  requestId: number;
  stale: boolean;
  skippedNetwork: boolean;
  consecutiveFailures: number;
  nextRetryInMs: number;
}

/**
 * Coordinates HTTP requests to the optional Python predictor service (`127.0.0.1:8001`).
 * - Bounds online polling rate to `minPollIntervalMs` (default 1000 ms).
 * - Applies exponential backoff (`initialBackoffMs` -> `maxBackoffMs`) when the service is unreachable
 *   so the browser never floods the console/network with `ERR_CONNECTION_REFUSED`.
 * - Cancels obsolete in-flight requests on telemetry source changes or explicit cancellation.
 * - Guards against request races so a late HTTP response cannot overwrite a newer prediction.
 */
export class PredictorRequestCoordinator {
  private readonly minPollIntervalMs: number;
  private readonly initialBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly requestTimeoutMs: number;
  private readonly endpointBaseUrl: string;
  private readonly fetchImpl?: typeof fetch;
  private readonly nowMs: () => number;

  private latestRequestId = 0;
  private activeSource: TelemetrySource | null = null;
  private inFlightController: AbortController | null = null;
  private lastBackendStatus: PredictorBackendConnection = 'LOCAL_FALLBACK_ACTIVE';
  private consecutiveFailures = 0;
  private nextAllowedNetworkAttemptMs = 0;

  constructor(options?: PredictorCoordinatorOptions) {
    this.minPollIntervalMs = options?.minPollIntervalMs ?? 1000;
    this.initialBackoffMs = options?.initialBackoffMs ?? 3000;
    this.maxBackoffMs = options?.maxBackoffMs ?? 15000;
    this.requestTimeoutMs = options?.requestTimeoutMs ?? 500;
    this.endpointBaseUrl = options?.endpointBaseUrl ?? 'http://127.0.0.1:8001';
    this.fetchImpl = options?.fetchImpl;
    this.nowMs = options?.nowMs ?? (() => Date.now());
  }

  public cancelPending(): void {
    this.latestRequestId += 1;
    if (this.inFlightController) {
      this.inFlightController.abort();
      this.inFlightController = null;
    }
  }

  public resetBackoff(): void {
    this.consecutiveFailures = 0;
    this.nextAllowedNetworkAttemptMs = 0;
  }

  public getState(): {
    latestRequestId: number;
    lastBackendStatus: PredictorBackendConnection;
    consecutiveFailures: number;
    nextAllowedNetworkAttemptMs: number;
    hasInFlightRequest: boolean;
  } {
    return {
      latestRequestId: this.latestRequestId,
      lastBackendStatus: this.lastBackendStatus,
      consecutiveFailures: this.consecutiveFailures,
      nextAllowedNetworkAttemptMs: this.nextAllowedNetworkAttemptMs,
      hasInFlightRequest: this.inFlightController !== null,
    };
  }

  public async evaluate(
    params: PredictorEvaluateParams
  ): Promise<CoordinatedPredictionResult> {
    const {
      historyPackets,
      config,
      telemetrySource,
      packetAgeSeconds,
      isStaleOverride = false,
      forceNetwork = false,
    } = params;

    if (this.activeSource !== null && this.activeSource !== telemetrySource) {
      this.cancelPending();
    }
    this.activeSource = telemetrySource;

    if (forceNetwork && this.inFlightController) {
      this.inFlightController.abort();
      this.inFlightController = null;
    }

    this.latestRequestId += 1;
    const requestId = this.latestRequestId;
    const requestSource = telemetrySource;

    const localResponse = computeLocalPhysicsPrediction(
      historyPackets,
      config,
      telemetrySource,
      packetAgeSeconds,
      isStaleOverride
    );

    const now = this.nowMs();

    if (historyPackets.length === 0) {
      return {
        response: localResponse,
        backendStatus: this.lastBackendStatus,
        requestId,
        stale: false,
        skippedNetwork: true,
        consecutiveFailures: this.consecutiveFailures,
        nextRetryInMs: Math.max(0, this.nextAllowedNetworkAttemptMs - now),
      };
    }

    const canAttemptNetwork =
      forceNetwork ||
      (this.inFlightController === null && now >= this.nextAllowedNetworkAttemptMs);

    if (!canAttemptNetwork) {
      return {
        response: localResponse,
        backendStatus: this.lastBackendStatus,
        requestId,
        stale: false,
        skippedNetwork: true,
        consecutiveFailures: this.consecutiveFailures,
        nextRetryInMs: Math.max(0, this.nextAllowedNetworkAttemptMs - now),
      };
    }

    const controller = new AbortController();
    this.inFlightController = controller;
    let abortedExternally = false;
    const onAbort = () => {
      abortedExternally = true;
    };
    controller.signal.addEventListener('abort', onAbort, { once: true });

    // Reserve throttle window immediately so burst packets don't spawn duplicate fetches
    this.nextAllowedNetworkAttemptMs = now + this.minPollIntervalMs;

    try {
      const result = await evaluateLandingPredictionWithBackend(
        historyPackets,
        config,
        telemetrySource,
        packetAgeSeconds,
        isStaleOverride,
        this.endpointBaseUrl,
        {
          signal: controller.signal,
          fetchImpl: this.fetchImpl,
          timeoutMs: this.requestTimeoutMs,
        }
      );

      const finishedAt = this.nowMs();
      const isSuperseded =
        requestId !== this.latestRequestId || requestSource !== this.activeSource;

      if (result.backendStatus === 'PYTHON_HTTP_ONLINE') {
        this.consecutiveFailures = 0;
        this.lastBackendStatus = 'PYTHON_HTTP_ONLINE';
        this.nextAllowedNetworkAttemptMs = finishedAt + this.minPollIntervalMs;

        return {
          response: isSuperseded ? localResponse : result.response,
          backendStatus: 'PYTHON_HTTP_ONLINE',
          requestId,
          stale: isSuperseded,
          skippedNetwork: false,
          consecutiveFailures: 0,
          nextRetryInMs: 0,
        };
      }

      if (!abortedExternally) {
        this.consecutiveFailures += 1;
        this.lastBackendStatus = 'LOCAL_FALLBACK_ACTIVE';
        const backoffMs = Math.min(
          this.maxBackoffMs,
          this.initialBackoffMs * Math.pow(2, this.consecutiveFailures - 1)
        );
        this.nextAllowedNetworkAttemptMs = finishedAt + backoffMs;
      }

      return {
        response: localResponse,
        backendStatus: this.lastBackendStatus,
        requestId,
        stale: isSuperseded,
        skippedNetwork: false,
        consecutiveFailures: this.consecutiveFailures,
        nextRetryInMs: Math.max(0, this.nextAllowedNetworkAttemptMs - finishedAt),
      };
    } finally {
      controller.signal.removeEventListener('abort', onAbort);
      if (this.inFlightController === controller) {
        this.inFlightController = null;
      }
    }
  }
}

