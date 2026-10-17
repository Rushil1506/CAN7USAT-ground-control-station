"""
Unit and Numerical Validation Tests for the CAN-7USAT Stage 1 Landing Predictor.

Covers:
1. Geodetic <-> ENU round-trip accuracy and Haversine distance/bearing checks.
2. Deterministic synthetic trajectories with known ground-truth landing coordinates:
   - Constant ground velocity + constant descent rate (exact kinematic baseline).
   - Two-stage descent rate transition: independent verification of Stage 1 and Stage 2
     time-to-landing calculations above, at, and below disreef transition altitude.
   - Parametric sensitivity studies quantifying how horizontal prediction error and OLS
     velocity standard error scale with:
     (a) GPS horizontal noise sigma (0.0 m, 0.5 m, 1.5 m, 3.0 m),
     (b) Velocity-window length W (3 s, 8 s, 15 s),
     (c) Remaining descent time t_rem (100 s, 60 s, 20 s).
   - Packet gaps and dynamic re-anchoring after pre-descent pad/ascent samples.
3. Input/Trajectory Stability diagnostic verification:
   - Confirms noisy trajectories do NOT receive inflated ~0.998 scores or `HIGH` tier at
     high/mid altitudes.
   - Confirms `is_calibrated_probability == False` and `landing_accuracy_warning` is present.
4. Strict validity gating:
   - Duplicate/out-of-order timestamps, stale telemetry, invalid GPS fixes, pad/ascent
     rejection, touchdown completion, and experimental RNN gate.
5. Configurable altitude references and HTTP server LIVE vs. SIMULATION isolation.
"""

from __future__ import annotations

import json
import math
import random
import threading
from typing import List, Tuple
from urllib.request import Request, urlopen

from predictor_service.predictor_engine import (
    LANDING_ACCURACY_DISCLAIMER,
    AltitudeSource,
    DescentPropagationMode,
    PhysicsBaselinePredictor,
    PredictorConfig,
    TelemetryPointInput,
    calculate_forward_bearing_deg,
    calculate_haversine_distance_m,
    enu_to_latlon,
    latlon_to_enu,
)
from predictor_service.server import create_predictor_http_server

LAUNCH_LAT_DEG = 13.3525000
LAUNCH_LON_DEG = 74.7928000


def generate_constant_velocity_trajectory(
    start_alt_m: float = 300.0,
    descent_rate_ms: float = 2.5,
    v_east_ms: float = 4.5,
    v_north_ms: float = -3.0,
    dt_s: float = 1.0,
) -> Tuple[List[TelemetryPointInput], float, float, float]:
    """
    Generate a deterministic synthetic descent trajectory with constant horizontal
    ground velocity (v_east_ms, v_north_ms) and constant vertical descent rate.
    """
    total_time_s = start_alt_m / descent_rate_ms
    true_east_landing_m = v_east_ms * total_time_s
    true_north_landing_m = v_north_ms * total_time_s
    true_lat, true_lon = enu_to_latlon(
        true_east_landing_m, true_north_landing_m, LAUNCH_LAT_DEG, LAUNCH_LON_DEG
    )

    points: List[TelemetryPointInput] = []
    num_steps = int(math.floor(total_time_s / dt_s)) + 1
    for step in range(num_steps):
        t_s = step * dt_s
        alt_m = max(0.0, start_alt_m - descent_rate_ms * t_s)
        east_m = v_east_ms * t_s
        north_m = v_north_ms * t_s
        lat, lon = enu_to_latlon(east_m, north_m, LAUNCH_LAT_DEG, LAUNCH_LON_DEG)
        points.append(
            TelemetryPointInput(
                timestamp_s=1000.0 + t_s,
                lat_deg=lat,
                lon_deg=lon,
                baro_altitude_m=alt_m,
                gps_altitude_amsl_m=alt_m + 55.0,
                gps_valid=True,
                vertical_speed_Telemetry_ms=-descent_rate_ms,
                source="LIVE",
            )
        )
    return (points, true_lat, true_lon, total_time_s)


def generate_two_stage_trajectory(
    apogee_alt_m: float = 840.0,
    disreef_alt_m: float = 500.0,
    v_desc_stage1_ms: float = 17.0,
    v_desc_stage2_ms: float = 2.2,
    v_east_ms: float = 3.2,
    v_north_ms: float = 1.8,
    dt_s: float = 1.0,
) -> Tuple[List[TelemetryPointInput], float, float, float]:
    """
    Generate a deterministic synthetic two-stage descent trajectory:
    - Stage 1 (apogee_alt_m down to disreef_alt_m): vertical descent rate = v_desc_stage1_ms
    - Stage 2 (disreef_alt_m down to 0 m): vertical descent rate = v_desc_stage2_ms
    """
    t_stage1_s = (apogee_alt_m - disreef_alt_m) / v_desc_stage1_ms
    t_stage2_s = disreef_alt_m / v_desc_stage2_ms
    total_time_s = t_stage1_s + t_stage2_s

    true_east_landing_m = v_east_ms * total_time_s
    true_north_landing_m = v_north_ms * total_time_s
    true_lat, true_lon = enu_to_latlon(
        true_east_landing_m, true_north_landing_m, LAUNCH_LAT_DEG, LAUNCH_LON_DEG
    )

    points: List[TelemetryPointInput] = []
    t_s = 0.0
    while t_s <= total_time_s:
        if t_s <= t_stage1_s:
            alt_m = apogee_alt_m - v_desc_stage1_ms * t_s
            vz = -v_desc_stage1_ms
        else:
            alt_m = max(0.0, disreef_alt_m - v_desc_stage2_ms * (t_s - t_stage1_s))
            vz = -v_desc_stage2_ms

        east_m = v_east_ms * t_s
        north_m = v_north_ms * t_s
        lat, lon = enu_to_latlon(east_m, north_m, LAUNCH_LAT_DEG, LAUNCH_LON_DEG)
        points.append(
            TelemetryPointInput(
                timestamp_s=2000.0 + t_s,
                lat_deg=lat,
                lon_deg=lon,
                baro_altitude_m=alt_m,
                gps_altitude_amsl_m=alt_m + 55.0,
                gps_valid=True,
                vertical_speed_Telemetry_ms=vz,
                source="LIVE",
            )
        )
        t_s += dt_s

    return (points, true_lat, true_lon, total_time_s)


class TestCoordinateTransforms:
    def test_enu_latlon_round_trip_precision(self) -> None:
        east_in_m = 425.6
        north_in_m = -318.9
        lat, lon = enu_to_latlon(east_in_m, north_in_m, LAUNCH_LAT_DEG, LAUNCH_LON_DEG)
        east_out_m, north_out_m = latlon_to_enu(
            lat, lon, LAUNCH_LAT_DEG, LAUNCH_LON_DEG
        )
        assert abs(east_out_m - east_in_m) < 1e-6
        assert abs(north_out_m - north_in_m) < 1e-6

        dist_haversine = calculate_haversine_distance_m(
            LAUNCH_LAT_DEG, LAUNCH_LON_DEG, lat, lon
        )
        expected_euclid = math.hypot(east_in_m, north_in_m)
        assert abs(dist_haversine - expected_euclid) < 0.01

    def test_forward_bearing_cardinal_directions(self) -> None:
        lat_n, lon_n = enu_to_latlon(0.0, 100.0, LAUNCH_LAT_DEG, LAUNCH_LON_DEG)
        lat_e, lon_e = enu_to_latlon(100.0, 0.0, LAUNCH_LAT_DEG, LAUNCH_LON_DEG)
        lat_s, lon_s = enu_to_latlon(0.0, -100.0, LAUNCH_LAT_DEG, LAUNCH_LON_DEG)
        lat_w, lon_w = enu_to_latlon(-100.0, 0.0, LAUNCH_LAT_DEG, LAUNCH_LON_DEG)

        assert abs(calculate_forward_bearing_deg(LAUNCH_LAT_DEG, LAUNCH_LON_DEG, lat_n, lon_n) - 0.0) < 0.05
        assert abs(calculate_forward_bearing_deg(LAUNCH_LAT_DEG, LAUNCH_LON_DEG, lat_e, lon_e) - 90.0) < 0.05
        assert abs(calculate_forward_bearing_deg(LAUNCH_LAT_DEG, LAUNCH_LON_DEG, lat_s, lon_s) - 180.0) < 0.05
        assert abs(calculate_forward_bearing_deg(LAUNCH_LAT_DEG, LAUNCH_LON_DEG, lat_w, lon_w) - 270.0) < 0.05


class TestSyntheticTrajectoriesNumericalValidation:
    def test_constant_velocity_exact_kinematic_accuracy(self) -> None:
        points, true_lat, true_lon, _ = generate_constant_velocity_trajectory()
        predictor = PhysicsBaselinePredictor(
            PredictorConfig(
                launch_lat_deg=LAUNCH_LAT_DEG,
                launch_lon_deg=LAUNCH_LON_DEG,
                target_lat_deg=true_lat,
                target_lon_deg=true_lon,
            )
        )

        for idx in (20, 60, 100):
            resp = predictor.predict_from_sequence(points[: idx + 1])
            assert resp.valid is True
            assert resp.prediction is not None
            assert resp.is_calibrated_probability is False
            assert resp.landing_accuracy_warning == LANDING_ACCURACY_DISCLAIMER
            assert resp.input_trajectory_stability_tier == "HIGH"

            horiz_error_m = calculate_haversine_distance_m(
                resp.prediction.predicted_lat_deg,
                resp.prediction.predicted_lon_deg,
                true_lat,
                true_lon,
            )
            assert horiz_error_m < 0.05

    def test_two_stage_descent_independent_transition_and_time_to_landing(self) -> None:
        """
        Independently verify:
        1. Default PredictorConfig keeps propagation_mode == OBSERVED_RATE and mission_profile_verified == False.
        2. Above disreef (t = 10 s, alt = 670 m > 500 m):
           - Stage 1 remaining time: (670 - 500) / 17.0 = 10.00 s
           - Stage 2 remaining time: 500 / 2.2 = 227.2727 s
           - Total time to landing: 237.27 s (vs. 670 / 17.0 = 39.41 s in OBSERVED_RATE)
        3. Exactly at disreef transition (t = 20 s, alt = 500 m):
           - Stage 1 remaining time is 0.0 s; total time is 500 / v_obs.
        4. Below disreef after window clears transition (t = 50 s, alt = 434 m < 500 m):
           - Stage 1 remaining time is 0.0 s, Stage 2 remaining time is 434 / 2.2 = 197.2727 s,
             and both modes agree to within < 0.05 m horizontal error.
        """
        default_cfg = PredictorConfig()
        assert default_cfg.propagation_mode == DescentPropagationMode.OBSERVED_RATE
        assert default_cfg.mission_profile_verified is False
        assert default_cfg.altitude_reference_verified is False

        points, true_lat, true_lon, _ = generate_two_stage_trajectory(
            apogee_alt_m=840.0,
            disreef_alt_m=500.0,
            v_desc_stage1_ms=17.0,
            v_desc_stage2_ms=2.2,
            v_east_ms=3.2,
            v_north_ms=1.8,
        )

        obs_predictor = PhysicsBaselinePredictor(default_cfg)
        two_stage_predictor = PhysicsBaselinePredictor(
            PredictorConfig(
                propagation_mode=DescentPropagationMode.TWO_STAGE_CONFIGURABLE,
                disreef_transition_altitude_m=500.0,
                stage1_nominal_descent_rate_ms=17.0,
                stage2_nominal_descent_rate_ms=2.2,
            )
        )

        # Case A: Above disreef (t = 10 s, alt = 670.0 m)
        resp_obs_high = obs_predictor.predict_from_sequence(points[:11])
        resp_2st_high = two_stage_predictor.predict_from_sequence(points[:11])
        assert resp_obs_high.valid and resp_obs_high.prediction is not None
        assert resp_2st_high.valid and resp_2st_high.prediction is not None

        assert abs(resp_obs_high.prediction.estimated_time_to_landing_s - (670.0 / 17.0)) < 0.05
        assert resp_2st_high.prediction.stage1_time_remaining_s is not None
        assert resp_2st_high.prediction.stage2_time_remaining_s is not None
        assert abs(resp_2st_high.prediction.stage1_time_remaining_s - 10.0) < 0.01
        assert abs(resp_2st_high.prediction.stage2_time_remaining_s - (500.0 / 2.2)) < 0.01
        assert abs(resp_2st_high.prediction.estimated_time_to_landing_s - (10.0 + 500.0 / 2.2)) < 0.02

        err_obs_high_m = calculate_haversine_distance_m(
            resp_obs_high.prediction.predicted_lat_deg,
            resp_obs_high.prediction.predicted_lon_deg,
            true_lat,
            true_lon,
        )
        err_2st_high_m = calculate_haversine_distance_m(
            resp_2st_high.prediction.predicted_lat_deg,
            resp_2st_high.prediction.predicted_lon_deg,
            true_lat,
            true_lon,
        )
        assert 720.0 <= err_obs_high_m <= 735.0
        assert err_2st_high_m < 0.05

        # Case B: Exactly at disreef boundary (t = 20 s, alt = 500.0 m)
        resp_2st_boundary = two_stage_predictor.predict_from_sequence(points[:21])
        assert resp_2st_boundary.valid and resp_2st_boundary.prediction is not None
        assert resp_2st_boundary.prediction.stage1_time_remaining_s == 0.0
        assert resp_2st_boundary.prediction.propagation_mode_used == "OBSERVED_RATE"

        # Case C: Well below disreef (t = 50 s, alt = 434.0 m)
        resp_obs_low = obs_predictor.predict_from_sequence(points[:51])
        resp_2st_low = two_stage_predictor.predict_from_sequence(points[:51])
        assert resp_obs_low.valid and resp_obs_low.prediction is not None
        assert resp_2st_low.valid and resp_2st_low.prediction is not None
        assert resp_2st_low.prediction.stage1_time_remaining_s == 0.0
        assert abs(resp_2st_low.prediction.estimated_time_to_landing_s - (434.0 / 2.2)) < 0.02

        err_obs_low_m = calculate_haversine_distance_m(
            resp_obs_low.prediction.predicted_lat_deg,
            resp_obs_low.prediction.predicted_lon_deg,
            true_lat,
            true_lon,
        )
        err_2st_low_m = calculate_haversine_distance_m(
            resp_2st_low.prediction.predicted_lat_deg,
            resp_2st_low.prediction.predicted_lon_deg,
            true_lat,
            true_lon,
        )
        assert err_obs_low_m < 0.05
        assert err_2st_low_m < 0.05

    def test_noisy_gps_sensitivity_to_noise_window_and_remaining_time(self) -> None:
        """
        Quantify and verify the mathematical relationship between horizontal landing error and:
        1. GPS horizontal noise level sigma_pos in {0.0, 0.5, 1.5, 3.0} m (at fixed W=10 s, t_rem=60 s)
        2. Velocity-window length W in {3.0, 8.0, 15.0} s (at fixed sigma_pos=1.5 m, t_rem=60 s)
        3. Remaining descent time t_rem in {100.0, 60.0, 20.0} s (at fixed sigma_pos=1.5 m, W=10 s)

        Also verify that noisy trajectories (sigma_pos >= 1.5 m at t_rem >= 60 s) do NOT
        receive `HIGH` stability tier or ~0.998 scores.
        """
        clean_points, true_lat, true_lon, _ = generate_constant_velocity_trajectory()

        def run_monte_carlo_rms_error(
            sigma_pos_m: float,
            window_s: float,
            eval_step: int,
            num_trials: int = 40,
        ) -> Tuple[float, float, float, List[str]]:
            sq_errors: List[float] = []
            vel_ses: List[float] = []
            scores: List[float] = []
            tiers: List[str] = []
            max_samples = int(window_s) + 2
            predictor = PhysicsBaselinePredictor(
                PredictorConfig(
                    velocity_window_seconds=window_s,
                    max_window_samples=max_samples,
                )
            )
            for trial in range(num_trials):
                rng = random.Random(1000 + trial)
                noisy_seq: List[TelemetryPointInput] = []
                start_idx = max(0, eval_step - max_samples - 2)
                for pt in clean_points[start_idx : eval_step + 1]:
                    e_c, n_c = latlon_to_enu(
                        pt.lat_deg, pt.lon_deg, LAUNCH_LAT_DEG, LAUNCH_LON_DEG
                    )
                    e_n = e_c + rng.gauss(0.0, sigma_pos_m)
                    n_n = n_c + rng.gauss(0.0, sigma_pos_m)
                    lat_n, lon_n = enu_to_latlon(
                        e_n, n_n, LAUNCH_LAT_DEG, LAUNCH_LON_DEG
                    )
                    noisy_seq.append(
                        TelemetryPointInput(
                            timestamp_s=pt.timestamp_s,
                            lat_deg=lat_n,
                            lon_deg=lon_n,
                            baro_altitude_m=pt.baro_altitude_m,
                            gps_valid=True,
                        )
                    )
                resp = predictor.predict_from_sequence(noisy_seq)
                assert resp.valid and resp.prediction is not None and resp.trajectory_metrics is not None
                err = calculate_haversine_distance_m(
                    resp.prediction.predicted_lat_deg,
                    resp.prediction.predicted_lon_deg,
                    true_lat,
                    true_lon,
                )
                sq_errors.append(err * err)
                vel_ses.append(resp.trajectory_metrics.velocity_std_error_ms)
                scores.append(resp.input_trajectory_stability_score)
                tiers.append(resp.input_trajectory_stability_tier)

            rms_err = math.sqrt(sum(sq_errors) / len(sq_errors))
            mean_vel_se = sum(vel_ses) / len(vel_ses)
            mean_score = sum(scores) / len(scores)
            return (rms_err, mean_vel_se, mean_score, tiers)

        # 1. Sensitivity to GPS horizontal noise sigma_pos (W = 10 s, step = 60 -> t_rem = 60 s)
        rms_00, se_00, score_00, tiers_00 = run_monte_carlo_rms_error(0.0, 10.0, 60)
        rms_05, se_05, score_05, _ = run_monte_carlo_rms_error(0.5, 10.0, 60)
        rms_15, se_15, score_15, tiers_15 = run_monte_carlo_rms_error(1.5, 10.0, 60)
        rms_30, se_30, score_30, tiers_30 = run_monte_carlo_rms_error(3.0, 10.0, 60)

        assert rms_00 < 0.02
        assert rms_00 < rms_05 < rms_15 < rms_30
        assert se_00 < se_05 < se_15 < se_30
        # Stability score monotonically decreases with noise and never labels 1.5 m or 3.0 m noise as HIGH
        assert score_00 > score_05 > score_15 > score_30
        assert all(t == "HIGH" for t in tiers_00)
        assert "HIGH" not in tiers_15
        assert "HIGH" not in tiers_30
        assert score_15 < 0.70

        # 2. Sensitivity to velocity-window length W (sigma_pos = 1.5 m, step = 60 -> t_rem = 60 s)
        rms_w3, se_w3, _, _ = run_monte_carlo_rms_error(1.5, 3.0, 60)
        rms_w8, se_w8, _, _ = run_monte_carlo_rms_error(1.5, 8.0, 60)
        rms_w15, se_w15, _, _ = run_monte_carlo_rms_error(1.5, 15.0, 60)

        # Longer OLS window reduces velocity standard error as O(N^(-3/2)) and reduces landing RMS error
        assert se_w3 > se_w8 > se_w15
        assert rms_w3 > rms_w8 > rms_w15

        # 3. Sensitivity to remaining descent time t_rem (sigma_pos = 1.5 m, W = 10 s)
        rms_t100, _, score_t100, _ = run_monte_carlo_rms_error(1.5, 10.0, 20)  # t_rem = 100 s
        rms_t60, _, score_t60, _ = run_monte_carlo_rms_error(1.5, 10.0, 60)   # t_rem = 60 s
        rms_t20, _, score_t20, _ = run_monte_carlo_rms_error(1.5, 10.0, 100)  # t_rem = 20 s

        # Shorter remaining descent time reduces the extrapolation lever arm (SE(v) * t_rem)
        assert rms_t100 > rms_t60 > rms_t20
        assert score_t100 < score_t60 < score_t20

    def test_packet_gaps_and_dynamic_reanchoring_after_pad_ascent(self) -> None:
        descent_points, true_lat, true_lon, _ = generate_constant_velocity_trajectory()

        prefix_points: List[TelemetryPointInput] = []
        for i in range(10):
            t_s = 990.0 + i
            prefix_points.append(
                TelemetryPointInput(
                    timestamp_s=t_s,
                    lat_deg=LAUNCH_LAT_DEG - 0.005,
                    lon_deg=LAUNCH_LON_DEG - 0.005,
                    baro_altitude_m=float(i * 30.0),
                    gps_valid=True,
                    source="LIVE",
                )
            )

        gapped_descent = [
            pt for idx, pt in enumerate(descent_points[:42]) if idx not in (36, 37, 38, 39)
        ]
        combined_sequence = prefix_points + gapped_descent

        predictor = PhysicsBaselinePredictor()
        resp_gapped = predictor.predict_from_sequence(combined_sequence)
        resp_clean = predictor.predict_from_sequence(descent_points[:42])

        assert resp_gapped.valid and resp_gapped.prediction is not None
        assert resp_clean.valid and resp_clean.prediction is not None

        err_gapped_m = calculate_haversine_distance_m(
            resp_gapped.prediction.predicted_lat_deg,
            resp_gapped.prediction.predicted_lon_deg,
            true_lat,
            true_lon,
        )
        assert err_gapped_m < 0.05
        assert resp_gapped.input_trajectory_stability_score < resp_clean.input_trajectory_stability_score
        assert resp_gapped.input_trajectory_stability_tier != "HIGH"


class TestValidityGatingAndAssumptions:
    def test_duplicate_and_out_of_order_timestamps_rejected(self) -> None:
        points, true_lat, true_lon, _ = generate_constant_velocity_trajectory()
        corrupted: List[TelemetryPointInput] = []
        for idx, pt in enumerate(points[:15]):
            corrupted.append(pt)
            if idx == 5:
                corrupted.append(
                    TelemetryPointInput(
                        timestamp_s=pt.timestamp_s,
                        lat_deg=pt.lat_deg + 0.5,
                        lon_deg=pt.lon_deg + 0.5,
                        baro_altitude_m=9999.0,
                        gps_valid=True,
                    )
                )
            if idx == 8:
                corrupted.append(
                    TelemetryPointInput(
                        timestamp_s=pt.timestamp_s - 2.0,
                        lat_deg=pt.lat_deg - 0.5,
                        lon_deg=pt.lon_deg - 0.5,
                        baro_altitude_m=0.0,
                        gps_valid=True,
                    )
                )

        predictor = PhysicsBaselinePredictor()
        resp = predictor.predict_from_sequence(corrupted)
        assert resp.valid is True
        assert resp.prediction is not None
        assert resp.trajectory_metrics is not None
        assert resp.trajectory_metrics.rejected_duplicate_timestamp_count == 2

        horiz_error_m = calculate_haversine_distance_m(
            resp.prediction.predicted_lat_deg,
            resp.prediction.predicted_lon_deg,
            true_lat,
            true_lon,
        )
        assert horiz_error_m < 0.05

    def test_invalid_gps_zero_zero_and_false_flag_rejected(self) -> None:
        predictor = PhysicsBaselinePredictor()
        invalid_points = [
            TelemetryPointInput(
                timestamp_s=1000.0 + i,
                lat_deg=0.0,
                lon_deg=0.0,
                baro_altitude_m=200.0 - i * 2.0,
                gps_valid=True,
            )
            for i in range(6)
        ] + [
            TelemetryPointInput(
                timestamp_s=1010.0,
                lat_deg=LAUNCH_LAT_DEG,
                lon_deg=LAUNCH_LON_DEG,
                baro_altitude_m=180.0,
                gps_valid=False,
            )
        ]
        resp = predictor.predict_from_sequence(invalid_points)
        assert resp.valid is False
        assert resp.reason_code == "NO_VALID_GPS_FIX"
        assert resp.prediction is None

    def test_stale_telemetry_gated(self) -> None:
        points, _, _, _ = generate_constant_velocity_trajectory()
        predictor = PhysicsBaselinePredictor(PredictorConfig(stale_threshold_seconds=3.0))
        latest_ts = points[10].timestamp_s
        resp = predictor.predict_from_sequence(
            points[:11], evaluation_time_s=latest_ts + 4.5
        )
        assert resp.valid is False
        assert resp.reason_code == "TELEMETRY_STALE"
        assert resp.prediction is None

    def test_pad_and_ascent_not_descending_gated(self) -> None:
        ascent_points = [
            TelemetryPointInput(
                timestamp_s=1000.0 + i,
                lat_deg=LAUNCH_LAT_DEG + i * 1e-5,
                lon_deg=LAUNCH_LON_DEG + i * 1e-5,
                baro_altitude_m=10.0 + i * 12.0,
                gps_valid=True,
            )
            for i in range(6)
        ]
        predictor = PhysicsBaselinePredictor()
        resp = predictor.predict_from_sequence(ascent_points)
        assert resp.valid is False
        assert resp.reason_code == "NOT_DESCENDING"
        assert resp.prediction is None

    def test_touchdown_complete_gated(self) -> None:
        points, _, _, _ = generate_constant_velocity_trajectory()
        predictor = PhysicsBaselinePredictor(PredictorConfig(touchdown_altitude_m=2.0))
        resp = predictor.predict_from_sequence(points)
        assert resp.valid is False
        assert resp.reason_code == "TOUCHDOWN_COMPLETE"
        assert resp.prediction is None

    def test_experimental_rnn_disabled_without_artifact(self) -> None:
        points, _, _, _ = generate_constant_velocity_trajectory()
        predictor = PhysicsBaselinePredictor(
            PredictorConfig(
                enable_experimental_rnn=True,
                rnn_artifact_path="nonexistent_model.keras",
            )
        )
        resp = predictor.predict_from_sequence(points[:15])
        assert resp.valid is False
        assert resp.reason_code == "MODEL_UNTRAINED"
        assert resp.prediction is None

    def test_altitude_reference_offset_configuration(self) -> None:
        points, _, _, _ = generate_constant_velocity_trajectory()
        predictor_offset = PhysicsBaselinePredictor(
            PredictorConfig(
                altitude_source=AltitudeSource.BARO_ONLY,
                baro_ground_offset_m=50.0,
            )
        )
        resp = predictor_offset.predict_from_sequence(points[:21])
        assert resp.valid is True
        assert resp.prediction is not None
        assert abs(resp.prediction.estimated_time_to_landing_s - 80.0) < 1e-2


class TestHttpServerAndSourceIsolation:
    def test_http_endpoints_and_live_vs_simulation_isolation(self) -> None:
        httpd, _ = create_predictor_http_server(
            host="127.0.0.1", port=0, quiet=True
        )
        host, port = httpd.server_address[:2]
        base_url = f"http://{host}:{port}"

        server_thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        server_thread.start()

        try:
            with urlopen(f"{base_url}/api/predictor/health") as res:
                health = json.loads(res.read().decode("utf-8"))
                assert health["ok"] is True
                assert health["hardware_write_capable"] is False

            live_points, true_lat, true_lon, _ = generate_constant_velocity_trajectory()
            for pt in live_points[:10]:
                req = Request(
                    f"{base_url}/api/predictor/predict",
                    data=json.dumps(
                        {
                            "point": {
                                "timestamp_s": pt.timestamp_s,
                                "lat_deg": pt.lat_deg,
                                "lon_deg": pt.lon_deg,
                                "baro_altitude_m": pt.baro_altitude_m,
                                "gps_valid": True,
                                "source": "LIVE",
                            }
                        }
                    ).encode("utf-8"),
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
                with urlopen(req) as res:
                    last_pred = json.loads(res.read().decode("utf-8"))

            assert last_pred["valid"] is True
            assert last_pred["source"] == "LIVE"
            assert last_pred["is_calibrated_probability"] is False
            assert "landing_accuracy_warning" in last_pred
            err_m = calculate_haversine_distance_m(
                last_pred["prediction"]["predicted_lat_deg"],
                last_pred["prediction"]["predicted_lon_deg"],
                true_lat,
                true_lon,
            )
            assert err_m < 0.05

            with urlopen(f"{base_url}/api/predictor/status") as res:
                status = json.loads(res.read().decode("utf-8"))
                assert status["history_counts"]["LIVE"] == 10
                assert status["history_counts"]["SIMULATION"] == 0

            with urlopen(f"{base_url}/api/predictor/current?source=SIMULATION") as res:
                sim_pred = json.loads(res.read().decode("utf-8"))
                assert sim_pred["valid"] is False
                assert sim_pred["reason_code"] == "NO_VALID_GPS_FIX"

            # Verify that if LIVE loses GPS lock on the newest packet, the old prediction is immediately suppressed
            req_lost = Request(
                f"{base_url}/api/predictor/predict",
                data=json.dumps(
                    {
                        "point": {
                            "timestamp_s": live_points[9].timestamp_s + 1.0,
                            "lat_deg": 0.0,
                            "lon_deg": 0.0,
                            "baro_altitude_m": 250.0,
                            "gps_valid": False,
                            "source": "LIVE",
                        }
                    }
                ).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urlopen(req_lost) as res:
                lost_pred = json.loads(res.read().decode("utf-8"))
                assert lost_pred["valid"] is False
                assert lost_pred["reason_code"] == "NO_VALID_GPS_FIX"
                assert lost_pred["prediction"] is None
        finally:
            httpd.shutdown()
            httpd.server_close()
