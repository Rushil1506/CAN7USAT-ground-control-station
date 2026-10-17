"""
CAN-7USAT Ground Control Station — Minimal Receive-Only HTTP Landing Predictor Service.

Uses Python standard library `http.server` (`ThreadingHTTPServer`) with zero third-party
web framework dependencies.

Safety & Hardware Isolation:
- This service NEVER opens, configures, or writes to any USB/Serial hardware port.
- It operates strictly on validated JSON telemetry snapshots posted by the GCS client
  and maintains strict separation between `LIVE` and `SIMULATION` telemetry histories.
"""

from __future__ import annotations

import argparse
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import threading
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import parse_qs, urlparse

from .predictor_engine import (
    PhysicsBaselinePredictor,
    PredictorConfig,
    TelemetryPointInput,
)


class PredictorServiceState:
    """Thread-safe container for the predictor instance."""

    def __init__(self, config: Optional[PredictorConfig] = None) -> None:
        self.lock = threading.Lock()
        self.predictor = PhysicsBaselinePredictor(config=config)

    def get_status_dict(self) -> Dict[str, Any]:
        with self.lock:
            cfg = self.predictor.config
            return {
                "service": "CAN-7USAT Landing Predictor Service",
                "stage": "STAGE_1_PHYSICS_BASELINE",
                "primary_method": "PHYSICS_ENU_BASELINE",
                "experimental_rnn_status": (
                    "ENABLED"
                    if (
                        cfg.enable_experimental_rnn
                        and cfg.rnn_artifact_path
                    )
                    else "DISABLED_NO_VALIDATED_ARTIFACT"
                ),
                "hardware_access": "NONE_RECEIVE_ONLY_HTTP",
                "config": cfg.to_dict(),
                "history_counts": {
                    "LIVE": len(self.predictor._histories["LIVE"]),
                    "SIMULATION": len(self.predictor._histories["SIMULATION"]),
                },
            }


class PredictorRequestHandler(BaseHTTPRequestHandler):
    """HTTP request handler for the CAN-7USAT Landing Predictor API."""

    server_version = "CAN7USATPredictorHTTP/1.0"

    @property
    def state(self) -> PredictorServiceState:
        return getattr(self.server, "predictor_state")

    def log_message(self, format: str, *args: Any) -> None:
        # Suppress noisy stdout logging during automated test runs if quiet mode is set
        if getattr(self.server, "quiet", False):
            return
        super().log_message(format, *args)

    def _send_cors_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Accept")

    def _send_json(self, status_code: int, payload: Dict[str, Any]) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._send_cors_headers()
        self.end_headers()
        self.wfile.write(body)

    def _read_json_body(self) -> Dict[str, Any]:
        content_length_str = self.headers.get("Content-Length", "0")
        try:
            content_length = int(content_length_str)
        except ValueError:
            content_length = 0
        if content_length <= 0:
            return {}
        raw_bytes = self.rfile.read(content_length)
        return json.loads(raw_bytes.decode("utf-8"))

    def do_OPTIONS(self) -> None:
        self.send_response(HTTPStatus.NO_CONTENT)
        self._send_cors_headers()
        self.end_headers()

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/")

        if path == "/api/predictor/health":
            self._send_json(
                HTTPStatus.OK,
                {
                    "ok": True,
                    "service": "can7usat-landing-predictor",
                    "primary_method": "PHYSICS_ENU_BASELINE",
                    "hardware_write_capable": False,
                },
            )
            return

        if path == "/api/predictor/status":
            self._send_json(HTTPStatus.OK, self.state.get_status_dict())
            return

        if path == "/api/predictor/current":
            query = parse_qs(parsed.query)
            raw_source = query.get("source", ["LIVE"])[0].upper()
            source = "SIMULATION" if raw_source == "SIMULATION" else "LIVE"
            with self.state.lock:
                response = self.state.predictor.predict_current(source=source)  # type: ignore[arg-type]
            self._send_json(HTTPStatus.OK, response.to_dict())
            return

        self._send_json(
            HTTPStatus.NOT_FOUND,
            {"error": f"Unknown endpoint: {parsed.path}"},
        )

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/")

        try:
            payload = self._read_json_body()
        except Exception as exc:
            self._send_json(
                HTTPStatus.BAD_REQUEST,
                {"error": f"Invalid JSON request body: {exc}"},
            )
            return

        if path == "/api/predictor/config":
            try:
                with self.state.lock:
                    current_dict = self.state.predictor.config.to_dict()
                    current_dict.update(payload)
                    new_cfg = PredictorConfig.from_dict(current_dict)
                    self.state.predictor.update_config(new_cfg)
                self._send_json(HTTPStatus.OK, self.state.get_status_dict())
            except Exception as exc:
                self._send_json(
                    HTTPStatus.BAD_REQUEST,
                    {"error": f"Invalid configuration parameters: {exc}"},
                )
            return

        if path == "/api/predictor/reset":
            raw_src = payload.get("source")
            src: Optional[str] = None
            if raw_src in ("LIVE", "SIMULATION"):
                src = raw_src
            with self.state.lock:
                self.state.predictor.reset(source=src)  # type: ignore[arg-type]
            self._send_json(HTTPStatus.OK, self.state.get_status_dict())
            return

        if path == "/api/predictor/predict":
            try:
                eval_time_raw = payload.get("evaluation_time_s")
                eval_time_s = (
                    float(eval_time_raw) if eval_time_raw is not None else None
                )
                if eval_time_s is not None and eval_time_s > 1e11:
                    eval_time_s = eval_time_s / 1000.0

                # Support optional per-request config override without mutating global state
                override_cfg_dict = payload.get("config")

                if "points" in payload and isinstance(payload["points"], list):
                    points: List[TelemetryPointInput] = [
                        TelemetryPointInput.from_dict(item)
                        for item in payload["points"]
                    ]
                    with self.state.lock:
                        base_cfg_dict = self.state.predictor.config.to_dict()
                    if isinstance(override_cfg_dict, dict):
                        base_cfg_dict.update(override_cfg_dict)
                    active_cfg = PredictorConfig.from_dict(base_cfg_dict)
                    temp_engine = PhysicsBaselinePredictor(config=active_cfg)
                    result = temp_engine.predict_from_sequence(
                        points=points, evaluation_time_s=eval_time_s
                    )
                    self._send_json(HTTPStatus.OK, result.to_dict())
                    return

                if "point" in payload and isinstance(payload["point"], dict):
                    pt = TelemetryPointInput.from_dict(payload["point"])
                    with self.state.lock:
                        self.state.predictor.ingest_point(pt)
                        result = self.state.predictor.predict_current(
                            source=pt.source, evaluation_time_s=eval_time_s
                        )
                    self._send_json(HTTPStatus.OK, result.to_dict())
                    return

                self._send_json(
                    HTTPStatus.BAD_REQUEST,
                    {
                        "error": (
                            "Request body must include either 'points' (list of samples) "
                            "or 'point' (single sample)."
                        )
                    },
                )
            except Exception as exc:
                self._send_json(
                    HTTPStatus.BAD_REQUEST,
                    {"error": f"Failed to process telemetry prediction request: {exc}"},
                )
            return

        self._send_json(
            HTTPStatus.NOT_FOUND,
            {"error": f"Unknown endpoint: {parsed.path}"},
        )


def create_predictor_http_server(
    host: str = "127.0.0.1",
    port: int = 8001,
    config: Optional[PredictorConfig] = None,
    quiet: bool = False,
) -> Tuple[ThreadingHTTPServer, PredictorServiceState]:
    """Create and configure a ThreadingHTTPServer instance for the predictor service."""
    state = PredictorServiceState(config=config)
    httpd = ThreadingHTTPServer((host, port), PredictorRequestHandler)
    setattr(httpd, "predictor_state", state)
    setattr(httpd, "quiet", quiet)
    return (httpd, state)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="CAN-7USAT Ground Control Station — Stage 1 Landing Predictor HTTP Service"
    )
    parser.add_argument("--host", default="127.0.0.1", help="Bind host (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8001, help="Bind port (default: 8001)")
    args = parser.parse_args()

    httpd, _ = create_predictor_http_server(host=args.host, port=args.port, quiet=False)
    actual_host, actual_port = httpd.server_address[:2]
    print(
        f"[CAN-7USAT Predictor] Listening on http://{actual_host}:{actual_port} "
        f"(Method: PHYSICS_ENU_BASELINE, Receive-Only HTTP)"
    )
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[CAN-7USAT Predictor] Shutting down.")
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
