"""
CAN-7USAT Ground Control Station — Landing Predictor Service Package.

Stage 1 implementation:
- Primary predictor: Physics-based local tangent-plane (ENU) baseline.
- Experimental notebook RNN remains disabled unless an explicit validated artifact is loaded.
- Strictly receive-only telemetry processing; never interacts with serial hardware.
"""

from .predictor_engine import (
    AltitudeSource,
    DescentPropagationMode,
    PredictorConfig,
    TelemetryPointInput,
    TrajectoryMetrics,
    HeuristicQuality,
    LandingPredictionOutput,
    PredictionResponse,
    PhysicsBaselinePredictor,
    calculate_haversine_distance_m,
    calculate_forward_bearing_deg,
    latlon_to_enu,
    enu_to_latlon,
)

__all__ = [
    "AltitudeSource",
    "DescentPropagationMode",
    "PredictorConfig",
    "TelemetryPointInput",
    "TrajectoryMetrics",
    "HeuristicQuality",
    "LandingPredictionOutput",
    "PredictionResponse",
    "PhysicsBaselinePredictor",
    "calculate_haversine_distance_m",
    "calculate_forward_bearing_deg",
    "latlon_to_enu",
    "enu_to_latlon",
]
