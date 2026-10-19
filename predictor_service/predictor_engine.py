"""
CAN-7USAT Ground Control Station — Physics-Based ENU Landing Predictor Engine.

Architecture & Notebook Audit Resolutions:
1. Primary Method:
   Local tangent-plane East-North-Up (ENU) kinematic propagation anchored to the
   latest valid GPS fix (lat_n, lon_n), based on the spherical earth tangent-plane
   projection from Notebook Cell 3 (R = 6,371,000.0 m).
   Unlike Notebook Cells 17 & 18 (which anchored all sequences to gps_points[0],
   causing origin drift when pad/ascent samples or sliding windows were passed),
   this engine re-anchors the local tangent plane to the current valid fix on every
   update.

2. Wind vs. Ground Velocity Observability:
   - Observable from current 22-field CSV telemetry:
     * Horizontal ground position: (gpsLatitude, gpsLongitude) -> ENU (east_m, north_m)
     * Horizontal ground velocity vector: v_ground = (v_east_ms, v_north_ms), which is
       already the vector sum: v_ground = v_air_horizontal + v_wind_horizontal.
     * Vertical descent rate: v_descent_ms derived from altitude change over time.
   - Unobservable from current telemetry without independent sensors (e.g., pitot-static
     airspeed sensor, ultrasonic anemometer, or radiosonde wind profile):
     * Air-relative horizontal velocity (v_air_horizontal)
     * Ambient wind velocity vector (v_wind_horizontal) and altitude wind shear profile
   - Therefore, this engine NEVER adds a separate wind vector to GPS-derived ground
     velocity (preventing the wind double-counting bug present in Notebook Cell 15).

3. Altitude Reference & Two-Stage Descent Assumptions:
   - The transmitter CSV provides `altitude` (barometric, m) and `gpsAltitude` (GNSS, m).
   - Because the transmitter `.ino` firmware is not in this repository, whether
     `altitude` is zeroed at pad power-on (launch-pad-relative) or referenced to standard
     sea-level pressure (1013.25 hPa) is treated as an explicit configurable assumption
     (`baro_ground_offset_m`, `ground_elevation_amsl_m`, `altitude_reference_verified`).
   - Similarly, repository scripts (`descent_sim.py` vs `constants.ts`) disagree on
     whether the drogue-to-parafoil transition occurs at 600.0 m or 500.0 m. Two-stage descent parameters are
     therefore configurable (`propagation_mode`, `parafoil_transition_altitude_m`,
     `stage1_nominal_descent_rate_ms`, `stage2_nominal_descent_rate_ms`) and default to
     `'OBSERVED_RATE'` propagation until verified against the official mission profile.

4. Input/Trajectory Stability Diagnostic & Extrapolation Sensitivity:
   - For N samples spaced by dt over a window W = (N - 1)*dt with position noise sigma_pos,
     the ordinary least-squares (OLS) velocity slope standard error is:
       SE(v) = sigma_pos / sqrt(sum((t_i - t_mean)^2)) = sigma_pos * sqrt(12 / (N * (N^2 - 1) * dt^2))
   - When extrapolated over remaining descent time t_rem = h_rem / v_descent, any velocity
     estimation error dv is amplified by the lever arm t_rem:
       dp_landing = dp_anchor + dv_horiz * t_rem + v_horiz * dt_rem
   - Consequently, even a high linear correlation R^2 over a short window can still have
     15-30+ m of horizontal landing error at high remaining altitude when GPS noise is ~1.5 m.
   - The diagnostic output by this engine is strictly an Input/Trajectory Stability
     Diagnostic (evaluating residual GPS jitter, velocity standard error, window span, and
     packet regularity). It is NEVER a calibrated landing-accuracy probability.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from enum import Enum
import math
import os
from typing import Any, Dict, List, Literal, Optional, Sequence, Tuple

EARTH_RADIUS_M: float = 6_371_000.0

LANDING_ACCURACY_DISCLAIMER: str = (
    "Input/trajectory stability diagnostic only — NOT a calibrated landing-accuracy "
    "probability or confidence interval. True landing-position accuracy is unknown and "
    "sensitive to unmodeled wind shear below the vehicle and velocity estimation error "
    "amplified by remaining descent time."
)


class AltitudeSource(str, Enum):
    """Configurable strategy for resolving remaining descent altitude above ground."""

    BARO_PREFERRED = "BARO_PREFERRED"
    BARO_ONLY = "BARO_ONLY"
    GPS_AMSL_MINUS_GROUND = "GPS_AMSL_MINUS_GROUND"


class DescentPropagationMode(str, Enum):
    """Configurable vertical descent time-to-ground estimation mode."""

    OBSERVED_RATE = "OBSERVED_RATE"
    TWO_STAGE_CONFIGURABLE = "TWO_STAGE_CONFIGURABLE"


HeuristicQuality = Literal["LOW", "MEDIUM", "HIGH"]

PredictorReasonCode = Literal[
    "VALID",
    "NO_VALID_GPS_FIX",
    "INSUFFICIENT_GPS_HISTORY",
    "TELEMETRY_STALE",
    "NOT_DESCENDING",
    "TOUCHDOWN_COMPLETE",
    "ALTITUDE_UNAVAILABLE",
    "EXPERIMENTAL_RNN_DISABLED",
    "MODEL_UNTRAINED",
    "INVALID_OUTPUT",
]


def latlon_to_enu(
    lat_deg: float,
    lon_deg: float,
    ref_lat_deg: float,
    ref_lon_deg: float,
) -> Tuple[float, float]:
    """
    Convert geodetic (lat, lon) in degrees to local tangent-plane (east_m, north_m)
    relative to (ref_lat_deg, ref_lon_deg).

    Preserves the spherical tangent-plane projection from Notebook Cell 3.
    """
    d_lat_rad = math.radians(lat_deg - ref_lat_deg)
    d_lon_rad = math.radians(lon_deg - ref_lon_deg)
    ref_lat_rad = math.radians(ref_lat_deg)

    east_m = EARTH_RADIUS_M * d_lon_rad * math.cos(ref_lat_rad)
    north_m = EARTH_RADIUS_M * d_lat_rad
    return (east_m, north_m)


def enu_to_latlon(
    east_m: float,
    north_m: float,
    ref_lat_deg: float,
    ref_lon_deg: float,
) -> Tuple[float, float]:
    """
    Convert local tangent-plane (east_m, north_m) offsets in meters back to
    geodetic (lat_deg, lon_deg) relative to (ref_lat_deg, ref_lon_deg).

    Preserves the inverse spherical tangent-plane projection from Notebook Cell 3.
    """
    ref_lat_rad = math.radians(ref_lat_deg)
    cos_lat = math.cos(ref_lat_rad)
    if abs(cos_lat) < 1e-12:
        raise ValueError("Reference latitude too close to geographic pole for ENU conversion.")

    d_lat_deg = math.degrees(north_m / EARTH_RADIUS_M)
    d_lon_deg = math.degrees(east_m / (EARTH_RADIUS_M * cos_lat))
    return (ref_lat_deg + d_lat_deg, ref_lon_deg + d_lon_deg)


def calculate_haversine_distance_m(
    lat1_deg: float,
    lon1_deg: float,
    lat2_deg: float,
    lon2_deg: float,
) -> float:
    """Calculate great-circle horizontal distance in meters between two WGS84 coordinates."""
    lat1_rad = math.radians(lat1_deg)
    lat2_rad = math.radians(lat2_deg)
    d_lat_rad = math.radians(lat2_deg - lat1_deg)
    d_lon_rad = math.radians(lon2_deg - lon1_deg)

    sin_dlat = math.sin(d_lat_rad / 2.0)
    sin_dlon = math.sin(d_lon_rad / 2.0)
    a = (
        sin_dlat * sin_dlat
        + math.cos(lat1_rad) * math.cos(lat2_rad) * sin_dlon * sin_dlon
    )
    a = min(1.0, max(0.0, a))
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(max(0.0, 1.0 - a)))
    return EARTH_RADIUS_M * c


def calculate_forward_bearing_deg(
    lat1_deg: float,
    lon1_deg: float,
    lat2_deg: float,
    lon2_deg: float,
) -> float:
    """Calculate initial forward azimuth in degrees [0, 360) from point 1 to point 2."""
    lat1_rad = math.radians(lat1_deg)
    lat2_rad = math.radians(lat2_deg)
    d_lon_rad = math.radians(lon2_deg - lon1_deg)

    y = math.sin(d_lon_rad) * math.cos(lat2_rad)
    x = math.cos(lat1_rad) * math.sin(lat2_rad) - (
        math.sin(lat1_rad) * math.cos(lat2_rad) * math.cos(d_lon_rad)
    )
    if abs(x) < 1e-15 and abs(y) < 1e-15:
        return 0.0
    bearing_deg = math.degrees(math.atan2(y, x))
    return (bearing_deg + 360.0) % 360.0


@dataclass
class PredictorConfig:
    """
    Configuration for the physics-based ENU landing predictor.

    All mission-profile and altitude-reference parameters are explicit and configurable
    rather than hardcoded as confirmed flight constants.
    """

    # Altitude reference settings
    altitude_source: AltitudeSource = AltitudeSource.BARO_PREFERRED
    baro_ground_offset_m: float = 0.0
    ground_elevation_amsl_m: float = 0.0
    altitude_reference_verified: bool = False

    # Descent propagation mode and configurable two-stage parameters
    propagation_mode: DescentPropagationMode = DescentPropagationMode.OBSERVED_RATE
    parafoil_transition_altitude_m: float = 600.0
    stage1_nominal_descent_rate_ms: float = 17.0
    stage2_nominal_descent_rate_ms: float = 2.2
    mission_profile_verified: bool = False

    # Sliding-window regression and validity gating parameters
    velocity_window_seconds: float = 8.0
    max_window_samples: int = 12
    min_valid_points: int = 3
    min_dt_seconds: float = 0.2
    min_window_span_seconds: float = 0.8
    stale_threshold_seconds: float = 3.0
    min_descent_rate_ms: float = 0.5
    max_plausible_descent_rate_ms: float = 60.0
    max_plausible_ground_speed_ms: float = 65.0
    touchdown_altitude_m: float = 2.0

    # Optional launch / target coordinates for range & bearing calculation
    target_lat_deg: Optional[float] = None
    target_lon_deg: Optional[float] = None
    launch_lat_deg: Optional[float] = None
    launch_lon_deg: Optional[float] = None

    # Experimental RNN gate (disabled by default per Stage 1 specification)
    enable_experimental_rnn: bool = False
    rnn_artifact_path: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        data = asdict(self)
        data["altitude_source"] = self.altitude_source.value
        data["propagation_mode"] = self.propagation_mode.value
        return data

    @classmethod
    def from_dict(cls, payload: Dict[str, Any]) -> "PredictorConfig":
        kwargs: Dict[str, Any] = {}
        for key, value in payload.items():
            if not hasattr(cls, key):
                continue
            if key == "altitude_source" and value is not None:
                kwargs[key] = AltitudeSource(str(value))
            elif key == "propagation_mode" and value is not None:
                kwargs[key] = DescentPropagationMode(str(value))
            else:
                kwargs[key] = value
        return cls(**kwargs)


@dataclass(frozen=True)
class TelemetryPointInput:
    """
    Validated telemetry sample input for landing prediction.

    `timestamp_s` must be a monotonic epoch or mission elapsed timestamp in seconds.
    """

    timestamp_s: float
    lat_deg: float
    lon_deg: float
    baro_altitude_m: Optional[float] = None
    gps_altitude_amsl_m: Optional[float] = None
    gps_valid: bool = True
    vertical_speed_Telemetry_ms: Optional[float] = None
    source: Literal["LIVE", "SIMULATION"] = "LIVE"

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "TelemetryPointInput":
        raw_ts = data.get("timestamp_s", data.get("timestamp"))
        if raw_ts is None:
            raise ValueError("Telemetry sample is missing 'timestamp_s' or 'timestamp'.")
        timestamp_s = float(raw_ts)
        if timestamp_s > 1e11:
            timestamp_s = timestamp_s / 1000.0

        raw_lat = data.get("lat_deg", data.get("gpsLatitude", data.get("lat")))
        raw_lon = data.get("lon_deg", data.get("gpsLongitude", data.get("lon")))
        if raw_lat is None or raw_lon is None:
            raise ValueError("Telemetry sample is missing latitude or longitude.")

        lat_deg = float(raw_lat)
        lon_deg = float(raw_lon)

        raw_baro = data.get("baro_altitude_m", data.get("altitude"))
        baro_alt = float(raw_baro) if raw_baro is not None else None

        raw_gps_alt = data.get("gps_altitude_amsl_m", data.get("gpsAltitude"))
        gps_alt = float(raw_gps_alt) if raw_gps_alt is not None else None

        raw_valid = data.get("gps_valid", data.get("gpsValid", True))
        gps_valid = bool(raw_valid)

        raw_vs = data.get("vertical_speed_Telemetry_ms", data.get("verticalSpeed"))
        vs_ms = float(raw_vs) if raw_vs is not None else None

        raw_source = str(data.get("source", "LIVE")).upper()
        source: Literal["LIVE", "SIMULATION"] = (
            "SIMULATION" if raw_source == "SIMULATION" else "LIVE"
        )

        return cls(
            timestamp_s=timestamp_s,
            lat_deg=lat_deg,
            lon_deg=lon_deg,
            baro_altitude_m=baro_alt,
            gps_altitude_amsl_m=gps_alt,
            gps_valid=gps_valid,
            vertical_speed_Telemetry_ms=vs_ms,
            source=source,
        )


@dataclass
class TrajectoryMetrics:
    """Observable kinematic quantities and OLS estimation diagnostics from recent fixes."""

    anchor_lat_deg: float
    anchor_lon_deg: float
    remaining_altitude_m: float
    altitude_source_used: str
    ground_velocity_east_ms: float
    ground_velocity_north_ms: float
    horizontal_ground_speed_ms: float
    ground_track_heading_deg: float
    vertical_descent_rate_ms: float
    window_sample_count: int
    window_duration_s: float
    latest_sample_age_s: float
    rejected_invalid_gps_count: int
    rejected_duplicate_timestamp_count: int
    window_position_rmse_m: float = 0.0
    velocity_std_error_ms: float = 0.0
    descent_rate_std_error_ms: float = 0.0
    extrapolated_position_std_error_m: float = 0.0


@dataclass
class LandingPredictionOutput:
    """Predicted landing coordinates and propagation details when prediction is valid."""

    predicted_lat_deg: float
    predicted_lon_deg: float
    predicted_east_offset_m: float
    predicted_north_offset_m: float
    horizontal_drift_distance_m: float
    drift_bearing_deg: float
    estimated_time_to_landing_s: float
    propagation_mode_used: str
    stage1_time_remaining_s: Optional[float] = None
    stage2_time_remaining_s: Optional[float] = None
    distance_from_launch_m: Optional[float] = None
    bearing_from_launch_deg: Optional[float] = None
    distance_to_target_m: Optional[float] = None
    bearing_to_target_deg: Optional[float] = None


@dataclass
class PredictionResponse:
    """
    Complete, self-describing response from the landing predictor engine.

    Enforces strict validity gating: `prediction` is always `None` when `valid` is `False`.
    Includes explicit input/trajectory stability diagnostics and an uncalibrated-accuracy
    disclaimer so the UI or API consumer can never misinterpret the stability score as a
    landing hit probability.
    """

    valid: bool
    status: str
    reason_code: PredictorReasonCode
    reason_message: str
    method: str
    source: Literal["LIVE", "SIMULATION"]
    input_trajectory_stability_tier: HeuristicQuality
    input_trajectory_stability_score: float
    heuristic_diagnostic_quality: HeuristicQuality
    heuristic_stability_score: float
    is_calibrated_probability: bool
    landing_accuracy_warning: str
    prediction: Optional[LandingPredictionOutput]
    trajectory_metrics: Optional[TrajectoryMetrics]
    observability_notes: Dict[str, Any]
    assumptions: Dict[str, Any]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "valid": self.valid,
            "status": self.status,
            "reason_code": self.reason_code,
            "reason_message": self.reason_message,
            "method": self.method,
            "source": self.source,
            "input_trajectory_stability_tier": self.input_trajectory_stability_tier,
            "input_trajectory_stability_score": round(
                self.input_trajectory_stability_score, 4
            ),
            "heuristic_diagnostic_quality": self.heuristic_diagnostic_quality,
            "heuristic_stability_score": round(self.heuristic_stability_score, 4),
            "is_calibrated_probability": self.is_calibrated_probability,
            "landing_accuracy_warning": self.landing_accuracy_warning,
            "prediction": asdict(self.prediction) if self.prediction is not None else None,
            "trajectory_metrics": (
                asdict(self.trajectory_metrics)
                if self.trajectory_metrics is not None
                else None
            ),
            "observability_notes": self.observability_notes,
            "assumptions": self.assumptions,
        }


def is_valid_coordinate(lat_deg: float, lon_deg: float, gps_valid_flag: bool = True) -> bool:
    """
    Validate a GPS coordinate fix.

    Rejects:
    - Explicit `gps_valid_flag == False`
    - NaN or infinite floats
    - Out-of-range coordinates (|lat| > 90 or |lon| > 180)
    - Unlocked GNSS receiver default `(0.0, 0.0)` fixes (`|lat| < 1e-5` and `|lon| < 1e-5`)
    """
    if not gps_valid_flag:
        return False
    if not (math.isfinite(lat_deg) and math.isfinite(lon_deg)):
        return False
    if abs(lat_deg) > 90.0 or abs(lon_deg) > 180.0:
        return False
    if abs(lat_deg) < 1e-5 and abs(lon_deg) < 1e-5:
        return False
    return True


@dataclass(frozen=True)
class _LinearFitResult:
    """Ordinary least-squares linear fit diagnostics for y(t) = intercept + slope * t."""

    slope: float
    intercept_at_zero: float
    r_squared: float
    residual_rmse: float
    slope_std_error: float


def _linear_least_squares_fit(
    times_s: Sequence[float], values: Sequence[float]
) -> _LinearFitResult:
    """
    Compute ordinary least-squares slope, intercept at t=0, R^2, unbiased residual RMSE
    s = sqrt(SSR / max(1, N - 2)), and slope standard error SE(slope) = s / sqrt(S_tt).
    """
    n = len(times_s)
    if n < 2:
        return _LinearFitResult(0.0, 0.0, 0.0, 0.0, 0.0)
    t_mean = sum(times_s) / n
    v_mean = sum(values) / n

    ss_tt = 0.0
    ss_tv = 0.0
    ss_vv = 0.0
    for t, v in zip(times_s, values):
        dt = t - t_mean
        dv = v - v_mean
        ss_tt += dt * dt
        ss_tv += dt * dv
        ss_vv += dv * dv

    if ss_tt < 1e-12:
        return _LinearFitResult(0.0, v_mean, 0.0, 0.0, 0.0)

    slope = ss_tv / ss_tt
    intercept_at_zero = v_mean - slope * t_mean

    if ss_vv < 1e-12:
        r_squared = 1.0
        ssr = 0.0
    else:
        r_squared = max(0.0, min(1.0, (ss_tv * ss_tv) / (ss_tt * ss_vv)))
        ssr = max(0.0, ss_vv - slope * ss_tv)

    dof = max(1, n - 2)
    residual_rmse = math.sqrt(ssr / dof) if n >= 3 else 0.0
    slope_std_error = residual_rmse / math.sqrt(ss_tt) if n >= 3 else 0.0

    return _LinearFitResult(
        slope=slope,
        intercept_at_zero=intercept_at_zero,
        r_squared=r_squared,
        residual_rmse=residual_rmse,
        slope_std_error=slope_std_error,
    )


class PhysicsBaselinePredictor:
    """
    Primary Stage 1 Landing Predictor using local tangent-plane (ENU) kinematics.

    Maintains separate telemetry histories for `LIVE` and `SIMULATION` data sources so
    simulated points can never contaminate live operational predictions.
    """

    def __init__(self, config: Optional[PredictorConfig] = None) -> None:
        self.config: PredictorConfig = config or PredictorConfig()
        self._histories: Dict[str, List[TelemetryPointInput]] = {
            "LIVE": [],
            "SIMULATION": [],
        }
        self._rejected_invalid_gps: Dict[str, int] = {"LIVE": 0, "SIMULATION": 0}
        self._rejected_duplicate_ts: Dict[str, int] = {"LIVE": 0, "SIMULATION": 0}
        self._latest_fix_lost: Dict[str, bool] = {"LIVE": False, "SIMULATION": False}

    def reset(self, source: Optional[Literal["LIVE", "SIMULATION"]] = None) -> None:
        """Clear stored telemetry history for one or both sources."""
        if source is None:
            for key in ("LIVE", "SIMULATION"):
                self._histories[key].clear()
                self._rejected_invalid_gps[key] = 0
                self._rejected_duplicate_ts[key] = 0
                self._latest_fix_lost[key] = False
        else:
            self._histories[source].clear()
            self._rejected_invalid_gps[source] = 0
            self._rejected_duplicate_ts[source] = 0
            self._latest_fix_lost[source] = False

    def update_config(self, new_config: PredictorConfig) -> None:
        """Update predictor configuration without mixing source histories."""
        self.config = new_config

    def _resolve_remaining_altitude_m(
        self, point: TelemetryPointInput
    ) -> Tuple[Optional[float], str]:
        """
        Resolve estimated altitude above ground level (m) according to `config.altitude_source`.
        """
        cfg = self.config
        baro_valid = (
            point.baro_altitude_m is not None
            and math.isfinite(point.baro_altitude_m)
        )
        gps_alt_valid = (
            point.gps_altitude_amsl_m is not None
            and math.isfinite(point.gps_altitude_amsl_m)
        )

        if cfg.altitude_source == AltitudeSource.BARO_ONLY:
            if not baro_valid:
                return (None, "UNAVAILABLE")
            return (
                float(point.baro_altitude_m) - cfg.baro_ground_offset_m,
                "BARO_MINUS_OFFSET",
            )

        if cfg.altitude_source == AltitudeSource.GPS_AMSL_MINUS_GROUND:
            if not gps_alt_valid:
                return (None, "UNAVAILABLE")
            return (
                float(point.gps_altitude_amsl_m) - cfg.ground_elevation_amsl_m,
                "GPS_AMSL_MINUS_GROUND",
            )

        if baro_valid:
            return (
                float(point.baro_altitude_m) - cfg.baro_ground_offset_m,
                "BARO_MINUS_OFFSET",
            )
        if gps_alt_valid:
            return (
                float(point.gps_altitude_amsl_m) - cfg.ground_elevation_amsl_m,
                "GPS_AMSL_MINUS_GROUND",
            )
        return (None, "UNAVAILABLE")

    def ingest_point(self, point: TelemetryPointInput) -> bool:
        """
        Validate and ingest a single telemetry sample into the source-isolated history buffer.
        Returns True if the point was accepted into the valid GPS history, False if rejected.
        """
        src = point.source
        if not math.isfinite(point.timestamp_s):
            self._rejected_invalid_gps[src] += 1
            return False

        history = self._histories[src]
        if history:
            last_ts = history[-1].timestamp_s
            dt = point.timestamp_s - last_ts
            if dt < self.config.min_dt_seconds:
                self._rejected_duplicate_ts[src] += 1
                return False

        if not is_valid_coordinate(point.lat_deg, point.lon_deg, point.gps_valid):
            self._rejected_invalid_gps[src] += 1
            self._latest_fix_lost[src] = True
            return False

        self._latest_fix_lost[src] = False
        history.append(point)
        max_keep = max(120, self.config.max_window_samples * 5)
        if len(history) > max_keep:
            del history[:-max_keep]
        return True

    def predict_from_sequence(
        self,
        points: Sequence[TelemetryPointInput],
        evaluation_time_s: Optional[float] = None,
    ) -> PredictionResponse:
        """
        Stateless prediction from an explicit sequence of telemetry samples.
        Useful for batch requests and deterministic synthetic trajectory tests.
        """
        source: Literal["LIVE", "SIMULATION"] = (
            points[-1].source if points else "LIVE"
        )
        temp_predictor = PhysicsBaselinePredictor(config=self.config)
        for pt in points:
            temp_predictor.ingest_point(pt)
        return temp_predictor.predict_current(
            source=source, evaluation_time_s=evaluation_time_s
        )

    def _build_metadata(self) -> Tuple[Dict[str, Any], Dict[str, Any]]:
        cfg = self.config
        observability_notes = {
            "observable_from_telemetry": [
                "gps_horizontal_position_lat_lon",
                "gps_horizontal_ground_velocity_east_north_ms",
                "barometric_altitude_m",
                "gnss_altitude_amsl_m",
                "vertical_descent_rate_ms",
            ],
            "unobservable_without_independent_wind_sensor": [
                "air_relative_horizontal_velocity_ms",
                "ambient_wind_velocity_vector_ms",
                "altitude_dependent_wind_shear_profile",
            ],
            "wind_handling_policy": (
                "GPS-derived horizontal velocity already equals (v_air + v_wind). "
                "No separate wind vector is added to prevent double-counting wind."
            ),
            "extrapolation_error_model": (
                "Horizontal landing error scales with OLS velocity standard error "
                "SE(v_horiz) multiplied by remaining descent time t_rem, plus anchor "
                "position noise and any unmodeled wind shear below the vehicle."
            ),
        }
        assumptions = {
            "altitude_source": cfg.altitude_source.value,
            "baro_ground_offset_m": cfg.baro_ground_offset_m,
            "ground_elevation_amsl_m": cfg.ground_elevation_amsl_m,
            "altitude_reference_verified_against_firmware": cfg.altitude_reference_verified,
            "propagation_mode": cfg.propagation_mode.value,
            "parafoil_transition_altitude_m": cfg.parafoil_transition_altitude_m,
            "stage1_nominal_descent_rate_ms": cfg.stage1_nominal_descent_rate_ms,
            "stage2_nominal_descent_rate_ms": cfg.stage2_nominal_descent_rate_ms,
            "mission_profile_verified_against_official_spec": cfg.mission_profile_verified,
            "constant_ground_velocity_extrapolation": True,
        }
        return (observability_notes, assumptions)

    def _compute_input_trajectory_stability(
        self,
        window_points: Sequence[TelemetryPointInput],
        window_span_s: float,
        window_position_rmse_m: float,
        extrapolated_position_std_error_m: float,
        descent_rate_ms: float,
    ) -> Tuple[HeuristicQuality, float]:
        """
        Compute an Input/Trajectory Stability diagnostic score in [0.0, 1.0] and tier.

        Unlike R^2 (which stays near ~0.99 on noisy trajectories whenever total horizontal
        displacement across the window is much larger than the GPS noise), this diagnostic
        explicitly penalizes:
        1. Physical residual GPS position jitter (`window_position_rmse_m`)
        2. Propagated velocity-extrapolation uncertainty (`extrapolated_position_std_error_m`)
        3. Short window durations or sparse sample counts (`window_points`, `window_span_s`)
        4. Packet dropouts / irregular intervals (`max_dt`)
        """
        n = len(window_points)
        sample_factor = min(1.0, max(0.0, (n - 2) / 6.0)) * min(
            1.0, max(0.0, window_span_s / 6.0)
        )

        dts = [
            window_points[i].timestamp_s - window_points[i - 1].timestamp_s
            for i in range(1, n)
        ]
        max_dt = max(dts) if dts else 999.0
        mean_dt = (sum(dts) / len(dts)) if dts else 999.0
        if max_dt <= 1.5 * max(1.0, mean_dt) and max_dt <= 2.5:
            regularity_factor = 1.0
        elif max_dt <= 5.0:
            regularity_factor = 0.55
        else:
            regularity_factor = 0.20

        # Physical GPS residual scatter factor: 1.0 when RMSE=0 m, ~0.46 at RMSE=1.5 m, ~0.10 at RMSE=2.5 m
        jitter_factor = math.exp(-((window_position_rmse_m / 1.7) ** 2))

        # Extrapolation sensitivity factor: penalizes large SE(v)*t_rem lever-arm uncertainty
        extrap_factor = 1.0 / (1.0 + (extrapolated_position_std_error_m / 15.0) ** 2)

        descent_factor = 1.0 if 1.0 <= descent_rate_ms <= 30.0 else 0.5

        score = (
            0.35 * jitter_factor
            + 0.30 * extrap_factor
            + 0.20 * sample_factor
            + 0.10 * regularity_factor
            + 0.05 * descent_factor
        )
        score = max(0.0, min(1.0, score))

        if (
            score >= 0.80
            and n >= 5
            and max_dt <= 2.5
            and window_position_rmse_m <= 0.75
            and extrapolated_position_std_error_m <= 10.0
        ):
            quality: HeuristicQuality = "HIGH"
        elif score >= 0.45 and n >= 3 and window_position_rmse_m <= 3.5:
            quality = "MEDIUM"
        else:
            quality = "LOW"

        return (quality, round(score, 4))

    def _invalid_response(
        self,
        status: str,
        reason_code: PredictorReasonCode,
        reason_message: str,
        source: Literal["LIVE", "SIMULATION"],
        observability_notes: Dict[str, Any],
        assumptions: Dict[str, Any],
        method: str = "PHYSICS_ENU_BASELINE",
        metrics: Optional[TrajectoryMetrics] = None,
    ) -> PredictionResponse:
        return PredictionResponse(
            valid=False,
            status=status,
            reason_code=reason_code,
            reason_message=reason_message,
            method=method,
            source=source,
            input_trajectory_stability_tier="LOW",
            input_trajectory_stability_score=0.0,
            heuristic_diagnostic_quality="LOW",
            heuristic_stability_score=0.0,
            is_calibrated_probability=False,
            landing_accuracy_warning=LANDING_ACCURACY_DISCLAIMER,
            prediction=None,
            trajectory_metrics=metrics,
            observability_notes=observability_notes,
            assumptions=assumptions,
        )

    def predict_current(
        self,
        source: Literal["LIVE", "SIMULATION"] = "LIVE",
        evaluation_time_s: Optional[float] = None,
    ) -> PredictionResponse:
        """
        Compute a landing prediction from the current source-isolated telemetry history.
        """
        cfg = self.config
        observability_notes, assumptions = self._build_metadata()

        if cfg.enable_experimental_rnn:
            if not cfg.rnn_artifact_path or not os.path.isfile(cfg.rnn_artifact_path):
                return self._invalid_response(
                    status="Experimental RNN Unavailable",
                    reason_code="MODEL_UNTRAINED",
                    reason_message=(
                        "Experimental RNN mode was requested, but no validated trained "
                        "model artifact exists at the configured path."
                    ),
                    source=source,
                    observability_notes=observability_notes,
                    assumptions=assumptions,
                    method="EXPERIMENTAL_RNN_UNAVAILABLE",
                )

        history = self._histories[source]
        rej_gps = self._rejected_invalid_gps[source]
        rej_dup = self._rejected_duplicate_ts[source]

        if not history or self._latest_fix_lost[source]:
            return self._invalid_response(
                status="Waiting for valid GPS fix",
                reason_code="NO_VALID_GPS_FIX",
                reason_message=(
                    "Latest telemetry packet does not contain a valid GPS fix."
                    if self._latest_fix_lost[source]
                    else "No valid GPS coordinates have been received."
                ),
                source=source,
                observability_notes=observability_notes,
                assumptions=assumptions,
            )

        latest = history[-1]
        now_s = evaluation_time_s if evaluation_time_s is not None else latest.timestamp_s
        sample_age_s = max(0.0, now_s - latest.timestamp_s)

        remaining_alt_m, alt_source_used = self._resolve_remaining_altitude_m(latest)
        if remaining_alt_m is None:
            return self._invalid_response(
                status="Altitude Unavailable",
                reason_code="ALTITUDE_UNAVAILABLE",
                reason_message=(
                    f"Could not resolve remaining altitude using source {cfg.altitude_source.value}."
                ),
                source=source,
                observability_notes=observability_notes,
                assumptions=assumptions,
            )

        if sample_age_s > cfg.stale_threshold_seconds:
            return self._invalid_response(
                status="Telemetry Stale",
                reason_code="TELEMETRY_STALE",
                reason_message=(
                    f"Latest valid GPS fix is {sample_age_s:.2f} s old "
                    f"(threshold: {cfg.stale_threshold_seconds:.2f} s)."
                ),
                source=source,
                observability_notes=observability_notes,
                assumptions=assumptions,
            )

        if remaining_alt_m <= cfg.touchdown_altitude_m:
            metrics = TrajectoryMetrics(
                anchor_lat_deg=latest.lat_deg,
                anchor_lon_deg=latest.lon_deg,
                remaining_altitude_m=round(max(0.0, remaining_alt_m), 4),
                altitude_source_used=alt_source_used,
                ground_velocity_east_ms=0.0,
                ground_velocity_north_ms=0.0,
                horizontal_ground_speed_ms=0.0,
                ground_track_heading_deg=0.0,
                vertical_descent_rate_ms=0.0,
                window_sample_count=len(history),
                window_duration_s=0.0,
                latest_sample_age_s=round(sample_age_s, 3),
                rejected_invalid_gps_count=rej_gps,
                rejected_duplicate_timestamp_count=rej_dup,
            )
            return self._invalid_response(
                status="Touchdown Complete",
                reason_code="TOUCHDOWN_COMPLETE",
                reason_message=(
                    f"Remaining altitude ({remaining_alt_m:.2f} m) is at or below "
                    f"touchdown threshold ({cfg.touchdown_altitude_m:.2f} m)."
                ),
                source=source,
                observability_notes=observability_notes,
                assumptions=assumptions,
                metrics=metrics,
            )

        cutoff_ts = latest.timestamp_s - cfg.velocity_window_seconds
        window = [pt for pt in history if pt.timestamp_s >= cutoff_ts]
        if len(window) < cfg.min_valid_points and len(history) >= cfg.min_valid_points:
            window = history[-cfg.min_valid_points :]
        if len(window) > cfg.max_window_samples:
            window = window[-cfg.max_window_samples :]

        if len(window) < cfg.min_valid_points:
            return self._invalid_response(
                status="Insufficient GPS History",
                reason_code="INSUFFICIENT_GPS_HISTORY",
                reason_message=(
                    f"Need at least {cfg.min_valid_points} valid GPS fixes with distinct "
                    f"timestamps (currently have {len(window)})."
                ),
                source=source,
                observability_notes=observability_notes,
                assumptions=assumptions,
            )

        window_span_s = window[-1].timestamp_s - window[0].timestamp_s
        if window_span_s < cfg.min_window_span_seconds:
            return self._invalid_response(
                status="Insufficient Time Span",
                reason_code="INSUFFICIENT_GPS_HISTORY",
                reason_message=(
                    f"Valid GPS window spans {window_span_s:.2f} s; requires at least "
                    f"{cfg.min_window_span_seconds:.2f} s."
                ),
                source=source,
                observability_notes=observability_notes,
                assumptions=assumptions,
            )

        ref_lat = latest.lat_deg
        ref_lon = latest.lon_deg
        ref_t = latest.timestamp_s

        rel_times: List[float] = []
        east_positions_m: List[float] = []
        north_positions_m: List[float] = []
        altitudes_m: List[float] = []
        alt_times: List[float] = []

        for pt in window:
            e_m, n_m = latlon_to_enu(pt.lat_deg, pt.lon_deg, ref_lat, ref_lon)
            dt_rel = pt.timestamp_s - ref_t
            rel_times.append(dt_rel)
            east_positions_m.append(e_m)
            north_positions_m.append(n_m)

            pt_alt, _ = self._resolve_remaining_altitude_m(pt)
            if pt_alt is not None:
                altitudes_m.append(pt_alt)
                alt_times.append(dt_rel)

        east_fit = _linear_least_squares_fit(rel_times, east_positions_m)
        north_fit = _linear_least_squares_fit(rel_times, north_positions_m)

        v_east_ms = east_fit.slope
        v_north_ms = north_fit.slope
        horizontal_speed_ms = math.hypot(v_east_ms, v_north_ms)
        ground_heading_deg = (
            (math.degrees(math.atan2(v_east_ms, v_north_ms)) + 360.0) % 360.0
            if horizontal_speed_ms > 1e-3
            else 0.0
        )

        window_pos_rmse_m = math.hypot(
            east_fit.residual_rmse, north_fit.residual_rmse
        )
        vel_std_err_ms = math.hypot(
            east_fit.slope_std_error, north_fit.slope_std_error
        )

        if len(altitudes_m) >= 2:
            alt_fit = _linear_least_squares_fit(alt_times, altitudes_m)
            descent_rate_ms = -alt_fit.slope
            descent_rate_se_ms = alt_fit.slope_std_error
        elif latest.vertical_speed_Telemetry_ms is not None and math.isfinite(
            latest.vertical_speed_Telemetry_ms
        ):
            descent_rate_ms = -float(latest.vertical_speed_Telemetry_ms)
            descent_rate_se_ms = 0.0
        else:
            descent_rate_ms = 0.0
            descent_rate_se_ms = 0.0

        metrics = TrajectoryMetrics(
            anchor_lat_deg=ref_lat,
            anchor_lon_deg=ref_lon,
            remaining_altitude_m=round(remaining_alt_m, 4),
            altitude_source_used=alt_source_used,
            ground_velocity_east_ms=round(v_east_ms, 4),
            ground_velocity_north_ms=round(v_north_ms, 4),
            horizontal_ground_speed_ms=round(horizontal_speed_ms, 4),
            ground_track_heading_deg=round(ground_heading_deg, 2),
            vertical_descent_rate_ms=round(descent_rate_ms, 4),
            window_sample_count=len(window),
            window_duration_s=round(window_span_s, 3),
            latest_sample_age_s=round(sample_age_s, 3),
            rejected_invalid_gps_count=rej_gps,
            rejected_duplicate_timestamp_count=rej_dup,
            window_position_rmse_m=round(window_pos_rmse_m, 4),
            velocity_std_error_ms=round(vel_std_err_ms, 4),
            descent_rate_std_error_ms=round(descent_rate_se_ms, 4),
            extrapolated_position_std_error_m=0.0,
        )

        if descent_rate_ms < cfg.min_descent_rate_ms:
            return self._invalid_response(
                status="Not Actively Descending",
                reason_code="NOT_DESCENDING",
                reason_message=(
                    f"Observed vertical descent rate is {descent_rate_ms:.2f} m/s "
                    f"(minimum required for active descent: {cfg.min_descent_rate_ms:.2f} m/s)."
                ),
                source=source,
                observability_notes=observability_notes,
                assumptions=assumptions,
                metrics=metrics,
            )

        if (
            descent_rate_ms > cfg.max_plausible_descent_rate_ms
            or horizontal_speed_ms > cfg.max_plausible_ground_speed_ms
        ):
            return self._invalid_response(
                status="Implausible Telemetry Kinematics",
                reason_code="INVALID_OUTPUT",
                reason_message=(
                    f"Derived ground speed ({horizontal_speed_ms:.1f} m/s) or descent rate "
                    f"({descent_rate_ms:.1f} m/s) exceeds physical sanity bounds."
                ),
                source=source,
                observability_notes=observability_notes,
                assumptions=assumptions,
                metrics=metrics,
            )

        stage1_t_s: Optional[float] = None
        stage2_t_s: Optional[float] = None

        if (
            cfg.propagation_mode == DescentPropagationMode.TWO_STAGE_CONFIGURABLE
            and remaining_alt_m > cfg.parafoil_transition_altitude_m
        ):
            alt_stage1 = remaining_alt_m - cfg.parafoil_transition_altitude_m
            alt_stage2 = cfg.parafoil_transition_altitude_m
            v_stage1 = max(descent_rate_ms, cfg.min_descent_rate_ms)
            v_stage2 = max(cfg.stage2_nominal_descent_rate_ms, cfg.min_descent_rate_ms)
            stage1_t_s = round(alt_stage1 / v_stage1, 4)
            stage2_t_s = round(alt_stage2 / v_stage2, 4)
            t_rem_s = (alt_stage1 / v_stage1) + (alt_stage2 / v_stage2)
            prop_mode_used = (
                f"TWO_STAGE_CONFIGURABLE(h_tr={cfg.parafoil_transition_altitude_m:.0f}m,"
                f"v2={v_stage2:.2f}m/s)"
            )
        else:
            t_rem_s = remaining_alt_m / descent_rate_ms
            if cfg.propagation_mode == DescentPropagationMode.TWO_STAGE_CONFIGURABLE:
                stage1_t_s = 0.0
                stage2_t_s = round(t_rem_s, 4)
            prop_mode_used = "OBSERVED_RATE"

        # First-order horizontal extrapolation standard error from OLS velocity & descent-rate noise
        dt_rem_se_s = (
            (remaining_alt_m / (descent_rate_ms * descent_rate_ms)) * descent_rate_se_ms
            if descent_rate_ms > 1e-3
            else 0.0
        )
        extrap_pos_se_m = math.hypot(
            vel_std_err_ms * t_rem_s, horizontal_speed_ms * dt_rem_se_s
        )
        metrics.extrapolated_position_std_error_m = round(extrap_pos_se_m, 4)

        pred_east_m = v_east_ms * t_rem_s
        pred_north_m = v_north_ms * t_rem_s
        pred_lat_deg, pred_lon_deg = enu_to_latlon(
            pred_east_m, pred_north_m, ref_lat, ref_lon
        )

        if not is_valid_coordinate(pred_lat_deg, pred_lon_deg, True):
            return self._invalid_response(
                status="Invalid Predicted Coordinate",
                reason_code="INVALID_OUTPUT",
                reason_message="Propagated coordinate failed geodetic sanity validation.",
                source=source,
                observability_notes=observability_notes,
                assumptions=assumptions,
                metrics=metrics,
            )

        drift_distance_m = math.hypot(pred_east_m, pred_north_m)
        drift_bearing_deg = calculate_forward_bearing_deg(
            ref_lat, ref_lon, pred_lat_deg, pred_lon_deg
        )

        dist_launch_m: Optional[float] = None
        bear_launch_deg: Optional[float] = None
        if cfg.launch_lat_deg is not None and cfg.launch_lon_deg is not None:
            dist_launch_m = round(
                calculate_haversine_distance_m(
                    cfg.launch_lat_deg, cfg.launch_lon_deg, pred_lat_deg, pred_lon_deg
                ),
                2,
            )
            bear_launch_deg = round(
                calculate_forward_bearing_deg(
                    cfg.launch_lat_deg, cfg.launch_lon_deg, pred_lat_deg, pred_lon_deg
                ),
                2,
            )

        dist_target_m: Optional[float] = None
        bear_target_deg: Optional[float] = None
        if cfg.target_lat_deg is not None and cfg.target_lon_deg is not None:
            dist_target_m = round(
                calculate_haversine_distance_m(
                    pred_lat_deg, pred_lon_deg, cfg.target_lat_deg, cfg.target_lon_deg
                ),
                2,
            )
            bear_target_deg = round(
                calculate_forward_bearing_deg(
                    pred_lat_deg, pred_lon_deg, cfg.target_lat_deg, cfg.target_lon_deg
                ),
                2,
            )

        quality, stability_score = self._compute_input_trajectory_stability(
            window_points=window,
            window_span_s=window_span_s,
            window_position_rmse_m=window_pos_rmse_m,
            extrapolated_position_std_error_m=extrap_pos_se_m,
            descent_rate_ms=descent_rate_ms,
        )

        prediction_out = LandingPredictionOutput(
            predicted_lat_deg=round(pred_lat_deg, 7),
            predicted_lon_deg=round(pred_lon_deg, 7),
            predicted_east_offset_m=round(pred_east_m, 2),
            predicted_north_offset_m=round(pred_north_m, 2),
            horizontal_drift_distance_m=round(drift_distance_m, 2),
            drift_bearing_deg=round(drift_bearing_deg, 2),
            estimated_time_to_landing_s=round(t_rem_s, 2),
            propagation_mode_used=prop_mode_used,
            stage1_time_remaining_s=stage1_t_s,
            stage2_time_remaining_s=stage2_t_s,
            distance_from_launch_m=dist_launch_m,
            bearing_from_launch_deg=bear_launch_deg,
            distance_to_target_m=dist_target_m,
            bearing_to_target_deg=bear_target_deg,
        )

        return PredictionResponse(
            valid=True,
            status="Active Physics ENU Prediction",
            reason_code="VALID",
            reason_message="Prediction computed from observed GPS ground velocity and descent rate.",
            method="PHYSICS_ENU_BASELINE",
            source=source,
            input_trajectory_stability_tier=quality,
            input_trajectory_stability_score=stability_score,
            heuristic_diagnostic_quality=quality,
            heuristic_stability_score=stability_score,
            is_calibrated_probability=False,
            landing_accuracy_warning=LANDING_ACCURACY_DISCLAIMER,
            prediction=prediction_out,
            trajectory_metrics=metrics,
            observability_notes=observability_notes,
            assumptions=assumptions,
        )
