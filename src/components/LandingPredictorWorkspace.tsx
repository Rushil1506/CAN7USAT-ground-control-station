import React, { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Compass,
  Crosshair,
  Info,
  Layers,
  MapPin,
  Navigation,
  Radio,
  Satellite,
  Server,
  ShieldAlert,
  Sliders,
  Target,
  Wind,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { BASE_GPS } from '../constants';
import {
  AltitudeSourceMode,
  DEFAULT_PREDICTOR_CONFIG,
  DescentPropagationMode,
  PredictionResponsePayload,
  PredictorBackendConnection,
  PredictorConfigPayload,
  PredictorRequestCoordinator,
  computeLocalPhysicsPrediction,
  isValidCoordinateFix,
  parseAndValidateTargetCoordinates,
} from '../services/landingPredictorClient';
import { TelemetryPacket, TelemetrySource } from '../types';

interface LandingPredictorWorkspaceProps {
  latestPacket: TelemetryPacket | null;
  historyPackets: TelemetryPacket[];
  telemetrySource: TelemetrySource;
  isStale: boolean;
  packetAgeSeconds: number | null;
  config?: PredictorConfigPayload;
  onUpdateConfig?: React.Dispatch<React.SetStateAction<PredictorConfigPayload>>;
}

function isPacketGpsValid(
  p: TelemetryPacket | null | undefined
): p is TelemetryPacket & { latitude: number; longitude: number } {
  if (!p) return false;
  if (p.gpsValid === false || p.gpsFixType === 'NO_FIX') return false;
  if (typeof p.gpsSats === 'number' && p.gpsSats <= 0) return false;
  return isValidCoordinateFix(p.latitude, p.longitude, true);
}

function formatCoord(lat: number | null | undefined, lon: number | null | undefined): string {
  if (
    typeof lat !== 'number' ||
    typeof lon !== 'number' ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lon)
  ) {
    return 'UNAVAILABLE';
  }
  const latDir = lat >= 0 ? 'N' : 'S';
  const lonDir = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(6)}° ${latDir}, ${Math.abs(lon).toFixed(6)}° ${lonDir}`;
}

export const LandingPredictorWorkspace: React.FC<LandingPredictorWorkspaceProps> = ({
  latestPacket,
  historyPackets,
  telemetrySource,
  isStale,
  packetAgeSeconds,
  config: externalConfig,
  onUpdateConfig,
}) => {
  const [internalConfig, setInternalConfig] = useState<PredictorConfigPayload>(() => ({
    ...DEFAULT_PREDICTOR_CONFIG,
  }));

  const config = externalConfig ?? internalConfig;
  const setConfig = onUpdateConfig ?? setInternalConfig;

  const coordinatorRef = useRef<PredictorRequestCoordinator | null>(null);
  if (!coordinatorRef.current) {
    coordinatorRef.current = new PredictorRequestCoordinator({
      minPollIntervalMs: 1000,
      initialBackoffMs: 3000,
      maxBackoffMs: 15000,
      requestTimeoutMs: 500,
    });
  }

  const [backendStatus, setBackendStatus] =
    useState<PredictorBackendConnection>('LOCAL_FALLBACK_ACTIVE');

  // Synchronous deterministic local computation ensures zero flicker and immediate gating
  const localPrediction = useMemo<PredictionResponsePayload>(() => {
    return computeLocalPhysicsPrediction(
      historyPackets,
      config,
      telemetrySource,
      packetAgeSeconds,
      isStale
    );
  }, [historyPackets, config, telemetrySource, packetAgeSeconds, isStale]);

  const [remotePrediction, setRemotePrediction] =
    useState<PredictionResponsePayload | null>(null);

  // Immediately clear any cached remote prediction and abort in-flight requests when switching sources
  useEffect(() => {
    coordinatorRef.current?.cancelPending();
    setRemotePrediction(null);
  }, [telemetrySource]);

  // Cancel any pending network request on unmount
  useEffect(() => {
    const coordinator = coordinatorRef.current;
    return () => {
      coordinator?.cancelPending();
    };
  }, []);

  // Query Python HTTP service via bounded/backoff coordinator; ignore stale or superseded responses
  useEffect(() => {
    let cancelled = false;
    const coordinator = coordinatorRef.current;
    if (!coordinator) return;

    void coordinator
      .evaluate({
        historyPackets,
        config,
        telemetrySource,
        packetAgeSeconds,
        isStaleOverride: isStale,
      })
      .then((result) => {
        if (cancelled || result.stale) return;
        setBackendStatus(result.backendStatus);
        if (result.backendStatus === 'PYTHON_HTTP_ONLINE') {
          setRemotePrediction(result.response);
        } else {
          setRemotePrediction(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [historyPackets, config, telemetrySource, packetAgeSeconds, isStale]);

  // Use Python HTTP service response when online and source-matched, else deterministic local engine
  const activeResponse: PredictionResponsePayload = useMemo(() => {
    const expectedSrc = telemetrySource === 'LIVE_SERIAL' ? 'LIVE' : 'SIMULATION';
    if (
      backendStatus === 'PYTHON_HTTP_ONLINE' &&
      remotePrediction &&
      remotePrediction.source === expectedSrc
    ) {
      // Enforce real-time staleness gate immediately if stream becomes stale between polls
      if (isStale && remotePrediction.valid) {
        return localPrediction;
      }
      return remotePrediction;
    }
    return localPrediction;
  }, [backendStatus, remotePrediction, localPrediction, telemetrySource, isStale]);

  // Map state & refs
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const gsMarkerRef = useRef<L.Marker | null>(null);
  const canSatMarkerRef = useRef<L.Marker | null>(null);
  const predictedMarkerRef = useRef<L.Marker | null>(null);
  const predictedCircleRef = useRef<L.Circle | null>(null);
  const driftLineRef = useRef<L.Polyline | null>(null);
  const targetMarkerRef = useRef<L.Marker | null>(null);
  const targetLineRef = useRef<L.Polyline | null>(null);
  const trackPolylineRef = useRef<L.Polyline | null>(null);

  const [mapType, setMapType] = useState<'osm' | 'satellite' | 'dark'>('osm');
  const [followVehicle, setFollowVehicle] = useState<boolean>(true);
  const [targetLatInput, setTargetLatInput] = useState<string>(() =>
    config.target_lat_deg !== null ? config.target_lat_deg.toFixed(6) : ''
  );
  const [targetLonInput, setTargetLonInput] = useState<string>(() =>
    config.target_lon_deg !== null ? config.target_lon_deg.toFixed(6) : ''
  );
  const [targetError, setTargetError] = useState<string | null>(null);

  // Keep input fields synchronized when shared target is updated from Overview or map click
  useEffect(() => {
    if (config.target_lat_deg !== null && config.target_lon_deg !== null) {
      setTargetLatInput(config.target_lat_deg.toFixed(6));
      setTargetLonInput(config.target_lon_deg.toFixed(6));
    } else {
      setTargetLatInput('');
      setTargetLonInput('');
    }
  }, [config.target_lat_deg, config.target_lon_deg]);

  const isSim = telemetrySource === 'SIMULATION';
  const isGpsValid = isPacketGpsValid(latestPacket);
  const canSatLat = isGpsValid ? latestPacket.latitude : null;
  const canSatLon = isGpsValid ? latestPacket.longitude : null;

  const validTrailPoints = useMemo<[number, number][]>(() => {
    return historyPackets
      .filter(isPacketGpsValid)
      .map((p) => [p.latitude, p.longitude]);
  }, [historyPackets]);

  const cartoApiKey = (import.meta.env.VITE_CARTO_API_KEY ?? '').trim();
  const hasCartoKey = cartoApiKey.length > 0;

  const tileUrls: Record<'osm' | 'satellite' | 'dark', string> = {
    osm: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    satellite:
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    dark: hasCartoKey
      ? `https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png?key=${encodeURIComponent(
          cartoApiKey
        )}`
      : 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
  };

  const tileAttributions: Record<'osm' | 'satellite' | 'dark', string> = {
    osm: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
    satellite: 'Tiles &copy; Esri &mdash; Source: Esri, USGS, GeoEye, AeroGRID, IGN',
    dark: '&copy; OpenStreetMap contributors &copy; CARTO',
  };

  // Initialize Leaflet Map
  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container) return;

    const initialCenter: [number, number] =
      canSatLat !== null && canSatLon !== null
        ? [canSatLat, canSatLon]
        : [BASE_GPS.latitude, BASE_GPS.longitude];

    const map = L.map(container, {
      center: initialCenter,
      zoom: 16,
      zoomControl: false,
      attributionControl: true,
    });

    tileLayerRef.current = L.tileLayer(tileUrls[mapType], {
      maxZoom: 19,
      subdomains: 'abcd',
      attribution: tileAttributions[mapType],
    }).addTo(map);

    L.control.scale({ position: 'bottomleft', imperial: false }).addTo(map);

    map.on('click', (e: L.LeafletMouseEvent) => {
      const clickedLat = Number(e.latlng.lat.toFixed(6));
      const clickedLon = Number(e.latlng.lng.toFixed(6));
      if (!isValidCoordinateFix(clickedLat, clickedLon, true)) {
        setTargetError('Invalid (0.0000, 0.0000) or out-of-bounds target coordinate.');
        return;
      }
      setConfig((prev) => ({
        ...prev,
        target_lat_deg: clickedLat,
        target_lon_deg: clickedLon,
      }));
      setTargetLatInput(clickedLat.toFixed(6));
      setTargetLonInput(clickedLon.toFixed(6));
      setTargetError(null);
    });

    mapRef.current = map;

    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize();
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
      tileLayerRef.current = null;
      gsMarkerRef.current = null;
      canSatMarkerRef.current = null;
      predictedMarkerRef.current = null;
      predictedCircleRef.current = null;
      driftLineRef.current = null;
      targetMarkerRef.current = null;
      targetLineRef.current = null;
      trackPolylineRef.current = null;
    };
  }, []);

  // Switch basemap tiles
  useEffect(() => {
    if (!mapRef.current) return;
    if (tileLayerRef.current) {
      mapRef.current.removeLayer(tileLayerRef.current);
    }
    tileLayerRef.current = L.tileLayer(tileUrls[mapType], {
      maxZoom: 19,
      subdomains: 'abcd',
      attribution: tileAttributions[mapType],
    }).addTo(mapRef.current);
  }, [mapType]);

  // Synchronize Map Markers, Flight Track, and Strictly Gated Predicted Landing Overlay
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // 1. Launch / Ground Station Base Marker
    const gsHtml = `
      <div style="transform: translate(-50%, -50%); display: flex; flex-direction: column; align-items: center; pointer-events: none;">
        <div style="background: #ffffff; border: 1.5px solid #475569; color: #0f172a; font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 4px; white-space: nowrap; box-shadow: 0 1px 4px rgba(15,23,42,0.18);">
          LAUNCH / GS BASE
        </div>
        <div style="width: 9px; height: 9px; background: #475569; border: 2px solid #ffffff; transform: rotate(45deg); margin-top: 2px; box-shadow: 0 1px 3px rgba(0,0,0,0.25);"></div>
      </div>
    `;
    const gsIcon = L.divIcon({
      html: gsHtml,
      className: 'lp-gs-marker',
      iconSize: [0, 0],
    });
    if (!gsMarkerRef.current) {
      gsMarkerRef.current = L.marker([BASE_GPS.latitude, BASE_GPS.longitude], {
        icon: gsIcon,
        interactive: false,
      }).addTo(map);
    } else {
      gsMarkerRef.current.setLatLng([BASE_GPS.latitude, BASE_GPS.longitude]);
    }

    // 2. Configurable Target Marker
    if (config.target_lat_deg !== null && config.target_lon_deg !== null) {
      const targetHtml = `
        <div style="transform: translate(-50%, -50%); display: flex; flex-direction: column; align-items: center; pointer-events: none;">
          <div style="background: #ffffff; border: 1.5px solid #15803d; color: #15803d; font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 4px; white-space: nowrap; box-shadow: 0 1px 4px rgba(15,23,42,0.18);">
            TARGET
          </div>
          <div style="width: 14px; height: 14px; border: 2px solid #15803d; border-radius: 50%; margin-top: 2px; background: rgba(21,128,61,0.16); display: flex; align-items: center; justify-content: center;">
            <div style="width: 4px; height: 4px; background: #15803d; border-radius: 50%;"></div>
          </div>
        </div>
      `;
      const targetIcon = L.divIcon({
        html: targetHtml,
        className: 'lp-target-marker',
        iconSize: [0, 0],
      });
      if (!targetMarkerRef.current) {
        targetMarkerRef.current = L.marker(
          [config.target_lat_deg, config.target_lon_deg],
          { icon: targetIcon, interactive: false }
        ).addTo(map);
      } else {
        targetMarkerRef.current.setLatLng([
          config.target_lat_deg,
          config.target_lon_deg,
        ]);
        targetMarkerRef.current.setIcon(targetIcon);
      }
    } else if (targetMarkerRef.current) {
      targetMarkerRef.current.remove();
      targetMarkerRef.current = null;
    }

    // 3. Validated GPS Breadcrumb Track
    if (validTrailPoints.length > 1) {
      if (!trackPolylineRef.current) {
        trackPolylineRef.current = L.polyline(validTrailPoints, {
          color: '#1d4ed8',
          weight: 2.5,
          opacity: 0.85,
        }).addTo(map);
      } else {
        trackPolylineRef.current.setLatLngs(validTrailPoints);
      }
    } else if (trackPolylineRef.current) {
      trackPolylineRef.current.remove();
      trackPolylineRef.current = null;
    }

    // 4. Current CanSat Vehicle Position Marker
    if (canSatLat !== null && canSatLon !== null) {
      const remAlt = activeResponse.trajectory_metrics?.remaining_altitude_m;
      const altBadge =
        typeof remAlt === 'number' && Number.isFinite(remAlt)
          ? `${remAlt.toFixed(0)}m`
          : typeof latestPacket?.altitude === 'number'
          ? `${latestPacket.altitude.toFixed(0)}m`
          : '--';
      const vehicleHtml = `
        <div style="transform: translate(-50%, -100%); display: flex; flex-direction: column; align-items: center;">
          <div style="background: #1d4ed8; color: #ffffff; font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 4px; border: 1.5px solid #ffffff; white-space: nowrap; box-shadow: 0 2px 6px rgba(29,78,216,0.35);">
            CANSAT (${altBadge})
          </div>
          <div style="width: 11px; height: 11px; background: #1d4ed8; border: 2px solid #ffffff; border-radius: 50%; box-shadow: 0 0 0 2px #1d4ed8; margin-top: 2px;"></div>
        </div>
      `;
      const vehicleIcon = L.divIcon({
        html: vehicleHtml,
        className: 'lp-vehicle-marker',
        iconSize: [0, 0],
      });
      if (!canSatMarkerRef.current) {
        canSatMarkerRef.current = L.marker([canSatLat, canSatLon], {
          icon: vehicleIcon,
          zIndexOffset: 900,
        }).addTo(map);
      } else {
        canSatMarkerRef.current.setLatLng([canSatLat, canSatLon]);
        canSatMarkerRef.current.setIcon(vehicleIcon);
      }

      if (followVehicle) {
        map.panTo([canSatLat, canSatLon], { animate: true, duration: 0.25 });
      }
    } else if (canSatMarkerRef.current) {
      canSatMarkerRef.current.remove();
      canSatMarkerRef.current = null;
    }

    // 5. STRICT VALIDITY GATE: Predicted Landing Point, Drift Vector & Extrapolation Circle
    // Never display unavailable, untrained, stale, or invalid predictions as map coordinates.
    if (
      activeResponse.valid &&
      activeResponse.prediction !== null &&
      canSatLat !== null &&
      canSatLon !== null
    ) {
      const predLat = activeResponse.prediction.predicted_lat_deg;
      const predLon = activeResponse.prediction.predicted_lon_deg;
      const tRem = activeResponse.prediction.estimated_time_to_landing_s;
      const extrapSeM =
        activeResponse.trajectory_metrics?.extrapolated_position_std_error_m ??
        0;

      const predHtml = `
        <div style="transform: translate(-50%, -100%); display: flex; flex-direction: column; align-items: center;">
          <div style="background: #0f766e; color: #ffffff; font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 4px; border: 1.5px solid #ffffff; white-space: nowrap; box-shadow: 0 2px 6px rgba(15,118,110,0.35);">
            PREDICTED LANDING (T-${tRem.toFixed(0)}s)
          </div>
          <div style="width: 13px; height: 13px; background: #0f766e; border: 2px solid #ffffff; border-radius: 50%; box-shadow: 0 0 0 2px #0f766e; margin-top: 2px;"></div>
        </div>
      `;
      const predIcon = L.divIcon({
        html: predHtml,
        className: 'lp-predicted-marker',
        iconSize: [0, 0],
      });

      if (!predictedMarkerRef.current) {
        predictedMarkerRef.current = L.marker([predLat, predLon], {
          icon: predIcon,
          zIndexOffset: 1000,
        }).addTo(map);
      } else {
        predictedMarkerRef.current.setLatLng([predLat, predLon]);
        predictedMarkerRef.current.setIcon(predIcon);
      }

      // Dashed drift vector from Current CanSat Position -> Predicted Landing Point
      const driftCoords: [number, number][] = [
        [canSatLat, canSatLon],
        [predLat, predLon],
      ];
      if (!driftLineRef.current) {
        driftLineRef.current = L.polyline(driftCoords, {
          color: '#0f766e',
          weight: 2.5,
          dashArray: '6, 6',
          opacity: 0.9,
        }).addTo(map);
      } else {
        driftLineRef.current.setLatLngs(driftCoords);
      }

      // 1-sigma OLS velocity extrapolation sensitivity circle (when > 0.5 m)
      // Explicitly labeled as an approximate linear sensitivity estimate, NOT a calibrated confidence region.
      if (extrapSeM >= 0.5) {
        const circleTooltipText = `Approx. 1σ Extrapolation Sensitivity (±${extrapSeM.toFixed(1)} m) — Linear SE(v)×t_rem estimate only; NOT a calibrated confidence region or guaranteed landing boundary`;
        if (!predictedCircleRef.current) {
          predictedCircleRef.current = L.circle([predLat, predLon], {
            radius: extrapSeM,
            color: '#0f766e',
            weight: 1.5,
            fillColor: '#0f766e',
            fillOpacity: 0.12,
            dashArray: '4, 4',
          })
            .bindTooltip(circleTooltipText, {
              direction: 'top',
              sticky: true,
            })
            .addTo(map);
        } else {
          predictedCircleRef.current.setLatLng([predLat, predLon]);
          predictedCircleRef.current.setRadius(extrapSeM);
          predictedCircleRef.current.setTooltipContent(circleTooltipText);
        }
      } else if (predictedCircleRef.current) {
        predictedCircleRef.current.remove();
        predictedCircleRef.current = null;
      }

      // Optional line from Predicted Landing Point -> Configured Target
      if (config.target_lat_deg !== null && config.target_lon_deg !== null) {
        const targetCoords: [number, number][] = [
          [predLat, predLon],
          [config.target_lat_deg, config.target_lon_deg],
        ];
        if (!targetLineRef.current) {
          targetLineRef.current = L.polyline(targetCoords, {
            color: '#15803d',
            weight: 1.8,
            dashArray: '3, 5',
            opacity: 0.75,
          }).addTo(map);
        } else {
          targetLineRef.current.setLatLngs(targetCoords);
        }
      } else if (targetLineRef.current) {
        targetLineRef.current.remove();
        targetLineRef.current = null;
      }
    } else {
      // Remove all predicted landing overlays immediately when gated/invalid
      if (predictedMarkerRef.current) {
        predictedMarkerRef.current.remove();
        predictedMarkerRef.current = null;
      }
      if (driftLineRef.current) {
        driftLineRef.current.remove();
        driftLineRef.current = null;
      }
      if (predictedCircleRef.current) {
        predictedCircleRef.current.remove();
        predictedCircleRef.current = null;
      }
      if (targetLineRef.current) {
        targetLineRef.current.remove();
        targetLineRef.current = null;
      }
    }
  }, [
    canSatLat,
    canSatLon,
    validTrailPoints,
    activeResponse,
    config.target_lat_deg,
    config.target_lon_deg,
    followVehicle,
    latestPacket?.altitude,
  ]);

  const handleApplyTarget = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseAndValidateTargetCoordinates(targetLatInput, targetLonInput);
    if (!parsed.valid) {
      setTargetError(parsed.error);
      return;
    }
    setTargetError(null);
    setConfig((prev) => ({
      ...prev,
      target_lat_deg: parsed.latDeg,
      target_lon_deg: parsed.lonDeg,
    }));
  };

  const handleClearTarget = () => {
    setTargetLatInput('');
    setTargetLonInput('');
    setTargetError(null);
    setConfig((prev) => ({
      ...prev,
      target_lat_deg: null,
      target_lon_deg: null,
    }));
  };

  const pred = activeResponse.prediction;
  const metrics = activeResponse.trajectory_metrics;

  const stabilityBadgeClass =
    activeResponse.input_trajectory_stability_tier === 'HIGH'
      ? 'bg-[var(--status-nominal-bg)] text-[var(--status-nominal)] border-[var(--status-nominal)]/30'
      : activeResponse.input_trajectory_stability_tier === 'MEDIUM'
      ? 'bg-[var(--status-warning-bg)] text-[var(--status-warning)] border-[var(--status-warning)]/30'
      : 'bg-[var(--status-alert-bg)] text-[var(--status-alert)] border-[var(--status-alert)]/30';

  return (
    <div className="flex flex-col lg:flex-row gap-3 h-full w-full overflow-y-auto lg:overflow-hidden p-1.5 min-h-0 min-w-0">
      {/* LEFT / CENTER COLUMN: Map-First Geospatial Canvas (66% width on desktop) */}
      <div className="flex-1 min-w-0 flex flex-col ops-card overflow-hidden min-h-[460px] lg:min-h-0">
        {/* Top Geospatial Status & Controls Header */}
        <div className="px-4 py-2.5 bg-[var(--bg-surface-1)] border-b border-[var(--border-subtle)] flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-[var(--radius-sm)] bg-[var(--accent-teal-soft)] text-[var(--accent-teal)]">
              <Crosshair className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-[var(--text-primary)]">
                  Landing Predictor Workspace
                </h2>
                <span
                  className={`text-[11px] font-mono-data font-semibold px-2 py-0.5 rounded-[var(--radius-xs)] border ${
                    activeResponse.valid
                      ? 'bg-[var(--status-nominal-bg)] text-[var(--status-nominal)] border-[var(--status-nominal)]/30'
                      : 'bg-[var(--status-warning-bg)] text-[var(--status-warning)] border-[var(--status-warning)]/30'
                  }`}
                >
                  {activeResponse.valid
                    ? 'VALID ENU PREDICTION'
                    : `GATED: ${activeResponse.reason_code}`}
                </span>
              </div>
              <p className="text-[11px] text-[var(--text-secondary)]">
                Primary Method: Local Tangent-Plane (ENU) Physics Baseline • Receive-Only Telemetry
              </p>
            </div>
          </div>

          {/* Right Map Controls: Basemap, Follow, Zoom */}
          <div className="flex items-center gap-2">
            {/* GNSS Fix Status Pill */}
            <span
              className={`px-2 py-1 text-[11px] font-mono-data font-semibold rounded-[var(--radius-xs)] border flex items-center gap-1.5 ${
                isGpsValid
                  ? 'bg-[var(--status-nominal-bg)] text-[var(--status-nominal)] border-[var(--status-nominal)]/30'
                  : 'bg-[var(--status-alert-bg)] text-[var(--status-alert)] border-[var(--status-alert)]/30'
              }`}
            >
              <Satellite className="w-3.5 h-3.5" />
              {isGpsValid
                ? `${latestPacket.gpsFixType} FIX (${latestPacket.gpsSats ?? '--'} SATS)`
                : 'NO VALID GPS FIX'}
            </span>

            {/* Basemap Switcher */}
            <div className="flex items-center bg-[var(--bg-surface-2)] border border-[var(--border-subtle)] rounded-[var(--radius-sm)] p-0.5 text-[11px] font-medium">
              <button
                type="button"
                onClick={() => setMapType('osm')}
                className={`px-2.5 py-1 rounded-[var(--radius-xs)] cursor-pointer transition-colors ${
                  mapType === 'osm'
                    ? 'bg-[var(--bg-surface-1)] text-[var(--accent-cobalt)] font-semibold shadow-[var(--shadow-xs)]'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                Street
              </button>
              <button
                type="button"
                onClick={() => setMapType('satellite')}
                className={`px-2.5 py-1 rounded-[var(--radius-xs)] cursor-pointer transition-colors ${
                  mapType === 'satellite'
                    ? 'bg-[var(--bg-surface-1)] text-[var(--accent-cobalt)] font-semibold shadow-[var(--shadow-xs)]'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                Satellite
              </button>
              {hasCartoKey && (
                <button
                  type="button"
                  onClick={() => setMapType('dark')}
                  className={`px-2.5 py-1 rounded-[var(--radius-xs)] cursor-pointer transition-colors ${
                    mapType === 'dark'
                      ? 'bg-[var(--bg-surface-1)] text-[var(--accent-cobalt)] font-semibold shadow-[var(--shadow-xs)]'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  Dark
                </button>
              )}
            </div>

            {/* Auto-Follow CanSat */}
            <button
              type="button"
              onClick={() => setFollowVehicle(!followVehicle)}
              title={
                followVehicle
                  ? 'Auto-centering on CanSat active'
                  : 'Click to auto-center map on CanSat'
              }
              className={`px-2.5 py-1 text-xs font-medium border rounded-[var(--radius-sm)] flex items-center gap-1 cursor-pointer transition-colors ${
                followVehicle
                  ? 'bg-[var(--accent-cobalt-soft)] text-[var(--accent-cobalt)] border-[var(--accent-cobalt)]/30 font-semibold'
                  : 'bg-[var(--bg-surface-2)] text-[var(--text-secondary)] border-[var(--border-subtle)]'
              }`}
            >
              <Navigation className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Follow</span>
            </button>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => mapRef.current?.zoomIn()}
                title="Zoom In"
                className="p-1.5 bg-[var(--bg-surface-2)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border-subtle)] rounded-[var(--radius-sm)] cursor-pointer"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => mapRef.current?.zoomOut()}
                title="Zoom Out"
                className="p-1.5 bg-[var(--bg-surface-2)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border-subtle)] rounded-[var(--radius-sm)] cursor-pointer"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Prominent Status Strip: Freshness, Altitude Reference Status, and Gating Reason */}
        <div className="px-4 py-2 bg-[var(--bg-surface-2)] border-b border-[var(--border-subtle)] flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-3">
            {/* Source Provenance */}
            <span className="flex items-center gap-1.5 font-medium text-[var(--text-secondary)]">
              <span>Source:</span>
              <strong
                className={`font-mono-data px-1.5 py-0.5 rounded-[var(--radius-xs)] ${
                  isSim
                    ? 'bg-[var(--status-info-bg)] text-[var(--accent-cobalt)]'
                    : 'bg-[var(--accent-teal-soft)] text-[var(--accent-teal)]'
                }`}
              >
                {isSim ? 'SIMULATION (10 Hz)' : 'LIVE USB SERIAL'}
              </strong>
            </span>

            {/* Telemetry Freshness */}
            <span className="flex items-center gap-1.5 font-medium text-[var(--text-secondary)]">
              <Clock className="w-3.5 h-3.5 text-[var(--text-tertiary)]" />
              <span>Freshness:</span>
              <strong
                className={`font-mono-data ${
                  isStale
                    ? 'text-[var(--status-alert)]'
                    : 'text-[var(--text-primary)]'
                }`}
              >
                {isSim
                  ? latestPacket
                    ? `ACTIVE (T+${latestPacket.missionTimeSeconds.toFixed(1)}s)`
                    : 'WAITING'
                  : packetAgeSeconds !== null
                  ? `${packetAgeSeconds.toFixed(1)}s ago ${isStale ? '(STALE)' : '(FRESH)'}`
                  : 'NO PACKETS'}
              </strong>
            </span>

            {/* Altitude Reference Status */}
            <span className="flex items-center gap-1.5 font-medium text-[var(--text-secondary)]">
              <Layers className="w-3.5 h-3.5 text-[var(--text-tertiary)]" />
              <span>Altitude Ref:</span>
              <strong className="font-mono-data text-[var(--text-primary)]">
                {config.altitude_source}
              </strong>
              <span
                className={`text-[10px] font-mono-data px-1.5 py-0.5 rounded-[var(--radius-xs)] border ${
                  config.altitude_reference_verified
                    ? 'bg-[var(--status-nominal-bg)] text-[var(--status-nominal)] border-[var(--status-nominal)]/30'
                    : 'bg-[var(--status-warning-bg)] text-[var(--status-warning)] border-[var(--status-warning)]/30'
                }`}
              >
                {config.altitude_reference_verified
                  ? 'VERIFIED REF'
                  : 'UNVERIFIED ASSUMPTION'}
              </span>
            </span>
          </div>

          {/* Backend Service Status */}
          <div className="flex items-center gap-1.5 text-[11px] font-mono-data text-[var(--text-secondary)]">
            <Server className="w-3.5 h-3.5 text-[var(--accent-cobalt)]" />
            <span>
              {backendStatus === 'PYTHON_HTTP_ONLINE'
                ? 'ENGINE: PYTHON HTTP (127.0.0.1:8001)'
                : 'ENGINE: LOCAL ENU MIRROR (HTTP OFFLINE)'}
            </span>
          </div>
        </div>

        {/* Map Canvas Container */}
        <div className="flex-1 relative bg-[#e5e9f0] min-h-[360px]">
          <div ref={mapContainerRef} className="absolute inset-0 w-full h-full z-0" />

          {/* Floating Map Legend & Live Coordinate Overlay (Top-Left) */}
          <div className="absolute top-3 left-3 bg-[var(--bg-surface-1)]/95 backdrop-blur-xs border border-[var(--border-subtle)] shadow-[var(--shadow-md)] rounded-[var(--radius-md)] p-3 z-10 max-w-xs space-y-2 pointer-events-none">
            <div className="text-[11px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
              Geospatial Track Summary
            </div>
            <div className="space-y-1 font-mono-data text-xs">
              <div className="flex justify-between gap-4">
                <span className="text-[var(--text-tertiary)]">Vehicle Pos:</span>
                <span
                  className={`font-semibold ${
                    isGpsValid
                      ? 'text-[var(--text-primary)]'
                      : 'text-[var(--status-alert)]'
                  }`}
                >
                  {formatCoord(canSatLat, canSatLon)}
                </span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-[var(--text-tertiary)]">Predicted Landing:</span>
                <span
                  className={`font-semibold ${
                    activeResponse.valid && pred
                      ? 'text-[var(--accent-teal)]'
                      : 'text-[var(--status-warning)]'
                  }`}
                >
                  {activeResponse.valid && pred
                    ? formatCoord(pred.predicted_lat_deg, pred.predicted_lon_deg)
                    : `NONE (${activeResponse.reason_code})`}
                </span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-[var(--text-tertiary)]">Valid Track Fixes:</span>
                <span className="text-[var(--text-primary)] font-semibold">
                  {validTrailPoints.length} pts
                </span>
              </div>
              {activeResponse.valid && metrics && (
                <div className="pt-1.5 mt-1 border-t border-[var(--border-subtle)] text-[10px] font-sans text-[var(--text-secondary)] leading-snug">
                  <span className="font-semibold text-[var(--accent-teal)]">
                    Dashed Circle (±{metrics.extrapolated_position_std_error_m.toFixed(1)} m):
                  </span>{' '}
                  Approximate 1σ linear extrapolation sensitivity estimate (SE(v)×t_rem) —{' '}
                  <strong className="text-[var(--status-warning)]">
                    not a calibrated confidence region or guaranteed landing boundary.
                  </strong>
                </div>
              )}
            </div>
          </div>

          {/* Gated Prediction Banner on Map (When Prediction is Invalid) */}
          {!activeResponse.valid && (
            <div className="absolute bottom-8 left-1/2 -translate-x-1/2 bg-[var(--bg-surface-1)]/95 backdrop-blur-xs border border-[var(--status-warning)]/50 shadow-[var(--shadow-md)] rounded-[var(--radius-md)] px-4 py-2.5 z-10 flex items-center gap-2.5 max-w-lg">
              <AlertTriangle className="w-4 h-4 text-[var(--status-warning)] shrink-0" />
              <div className="text-xs">
                <div className="font-semibold text-[var(--text-primary)]">
                  Landing Point Suppressed — {activeResponse.status} (
                  <span className="font-mono-data">{activeResponse.reason_code}</span>)
                </div>
                <div className="text-[var(--text-secondary)] text-[11px]">
                  {activeResponse.reason_message}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* RIGHT COLUMN: Structured Inspector Rail (34% width on desktop) */}
      <div className="w-full lg:w-[430px] xl:w-[460px] shrink-0 flex flex-col gap-3 overflow-y-auto h-full pr-0.5 min-h-0">
        {/* CARD 1: Predicted Landing Coordinates & Drift Kinematics */}
        <section className="ops-card p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-2.5">
            <div className="flex items-center gap-2">
              <MapPin className="w-4 h-4 text-[var(--accent-teal)]" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-primary)]">
                Predicted Landing & Kinematics
              </h3>
            </div>
            {activeResponse.valid ? (
              <span className="flex items-center gap-1 text-[11px] font-semibold text-[var(--status-nominal)] bg-[var(--status-nominal-bg)] px-2 py-0.5 rounded-[var(--radius-xs)]">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Active
              </span>
            ) : (
              <span className="flex items-center gap-1 text-[11px] font-semibold text-[var(--status-warning)] bg-[var(--status-warning-bg)] px-2 py-0.5 rounded-[var(--radius-xs)]">
                <ShieldAlert className="w-3.5 h-3.5" />
                Gated
              </span>
            )}
          </div>

          {activeResponse.valid && pred && metrics ? (
            <div className="space-y-3">
              <div className="bg-[var(--bg-surface-2)] border border-[var(--border-subtle)] rounded-[var(--radius-sm)] p-3">
                <div className="text-[11px] text-[var(--text-secondary)] font-medium">
                  Predicted Touchdown Coordinate (WGS84)
                </div>
                <div className="font-mono-data text-sm font-bold text-[var(--accent-teal)] mt-0.5">
                  {formatCoord(pred.predicted_lat_deg, pred.predicted_lon_deg)}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 pt-2 border-t border-[var(--border-subtle)] text-[11px] font-mono-data text-[var(--text-secondary)]">
                  <span>
                    East Offset: <strong>{pred.predicted_east_offset_m.toFixed(1)} m</strong>
                  </span>
                  <span>
                    North Offset: <strong>{pred.predicted_north_offset_m.toFixed(1)} m</strong>
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5 text-xs">
                <div className="bg-[var(--bg-surface-2)] border border-[var(--border-subtle)] rounded-[var(--radius-sm)] p-2.5">
                  <div className="text-[11px] text-[var(--text-tertiary)]">
                    Est. Time to Touchdown
                  </div>
                  <div className="font-mono-data text-sm font-bold text-[var(--text-primary)] mt-0.5">
                    {pred.estimated_time_to_landing_s.toFixed(1)} s
                  </div>
                  {pred.stage1_time_remaining_s !== null &&
                    pred.stage2_time_remaining_s !== null && (
                      <div className="text-[10px] font-mono-data text-[var(--text-tertiary)] mt-0.5">
                        S1: {pred.stage1_time_remaining_s.toFixed(1)}s • S2:{' '}
                        {pred.stage2_time_remaining_s.toFixed(1)}s
                      </div>
                    )}
                </div>

                <div className="bg-[var(--bg-surface-2)] border border-[var(--border-subtle)] rounded-[var(--radius-sm)] p-2.5">
                  <div className="text-[11px] text-[var(--text-tertiary)]">
                    Remaining Descent Alt
                  </div>
                  <div className="font-mono-data text-sm font-bold text-[var(--text-primary)] mt-0.5">
                    {metrics.remaining_altitude_m.toFixed(1)} m
                  </div>
                  <div className="text-[10px] font-mono-data text-[var(--text-tertiary)] mt-0.5">
                    {metrics.altitude_source_used}
                  </div>
                </div>

                <div className="bg-[var(--bg-surface-2)] border border-[var(--border-subtle)] rounded-[var(--radius-sm)] p-2.5">
                  <div className="text-[11px] text-[var(--text-tertiary)]">
                    Horizontal Drift Vector
                  </div>
                  <div className="font-mono-data text-sm font-bold text-[var(--text-primary)] mt-0.5">
                    {pred.horizontal_drift_distance_m.toFixed(1)} m @{' '}
                    {pred.drift_bearing_deg.toFixed(0)}°
                  </div>
                  <div className="text-[10px] font-mono-data text-[var(--text-tertiary)] mt-0.5">
                    From current vehicle fix
                  </div>
                </div>

                <div className="bg-[var(--bg-surface-2)] border border-[var(--border-subtle)] rounded-[var(--radius-sm)] p-2.5">
                  <div className="text-[11px] text-[var(--text-tertiary)]">
                    Observed Ground Speed
                  </div>
                  <div className="font-mono-data text-sm font-bold text-[var(--text-primary)] mt-0.5">
                    {metrics.horizontal_ground_speed_ms.toFixed(2)} m/s
                  </div>
                  <div className="text-[10px] font-mono-data text-[var(--text-tertiary)] mt-0.5">
                    vE: {metrics.ground_velocity_east_ms.toFixed(2)} • vN:{' '}
                    {metrics.ground_velocity_north_ms.toFixed(2)} m/s
                  </div>
                </div>

                <div className="bg-[var(--bg-surface-2)] border border-[var(--border-subtle)] rounded-[var(--radius-sm)] p-2.5">
                  <div className="text-[11px] text-[var(--text-tertiary)]">
                    Vertical Descent Rate
                  </div>
                  <div className="font-mono-data text-sm font-bold text-[var(--text-primary)] mt-0.5">
                    {metrics.vertical_descent_rate_ms.toFixed(2)} m/s
                  </div>
                  <div className="text-[10px] font-mono-data text-[var(--text-tertiary)] mt-0.5">
                    Mode: {config.propagation_mode}
                  </div>
                </div>

                <div className="bg-[var(--bg-surface-2)] border border-[var(--border-subtle)] rounded-[var(--radius-sm)] p-2.5">
                  <div className="text-[11px] text-[var(--text-tertiary)]">
                    Distance from Launch
                  </div>
                  <div className="font-mono-data text-sm font-bold text-[var(--text-primary)] mt-0.5">
                    {pred.distance_from_launch_m !== null
                      ? `${pred.distance_from_launch_m.toFixed(1)} m`
                      : 'N/A'}
                  </div>
                  <div className="text-[10px] font-mono-data text-[var(--text-tertiary)] mt-0.5">
                    {pred.bearing_from_launch_deg !== null
                      ? `Bearing ${pred.bearing_from_launch_deg.toFixed(1)}°`
                      : '--'}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-[var(--status-warning-bg)] border border-[var(--status-warning)]/30 rounded-[var(--radius-sm)] p-3 text-xs space-y-1">
              <div className="font-semibold text-[var(--status-warning)]">
                No Valid Prediction Available ({activeResponse.reason_code})
              </div>
              <p className="text-[var(--text-secondary)] leading-relaxed">
                {activeResponse.reason_message}
              </p>
              {metrics && (
                <div className="pt-1.5 mt-1.5 border-t border-[var(--status-warning)]/20 font-mono-data text-[11px] text-[var(--text-secondary)] flex flex-wrap gap-3">
                  <span>Alt: {metrics.remaining_altitude_m.toFixed(1)} m</span>
                  <span>Descent Rate: {metrics.vertical_descent_rate_ms.toFixed(2)} m/s</span>
                  <span>Window Samples: {metrics.window_sample_count}</span>
                </div>
              )}
            </div>
          )}

          {/* Wind Observability Note */}
          <div className="bg-[var(--bg-surface-2)] border border-[var(--border-subtle)] rounded-[var(--radius-sm)] p-2.5 flex items-start gap-2 text-[11px] text-[var(--text-secondary)]">
            <Wind className="w-4 h-4 text-[var(--accent-cobalt)] shrink-0 mt-0.5" />
            <div>
              <strong className="text-[var(--text-primary)]">
                Wind & Ground Velocity Observability:
              </strong>{' '}
              GPS-derived horizontal velocity already measures net ground motion (
              <span className="font-mono-data">v_ground = v_air + v_wind</span>). No separate
              wind vector is added. Ambient wind vs. airspeed cannot be separated without an
              independent airspeed or wind sensor.
            </div>
          </div>
        </section>

        {/* CARD 2: Input / Trajectory Stability Diagnostic & Extrapolation Sensitivity */}
        <section className="ops-card p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-2.5">
            <div className="flex items-center gap-2">
              <Compass className="w-4 h-4 text-[var(--accent-cobalt)]" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-primary)]">
                Input / Trajectory Stability Diagnostic
              </h3>
            </div>
            <span
              className={`text-[11px] font-mono-data font-semibold px-2 py-0.5 rounded-[var(--radius-xs)] border ${stabilityBadgeClass}`}
            >
              {activeResponse.input_trajectory_stability_tier} (
              {activeResponse.input_trajectory_stability_score.toFixed(2)})
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs font-mono-data">
            <div className="bg-[var(--bg-surface-2)] border border-[var(--border-subtle)] rounded-[var(--radius-sm)] p-2">
              <div className="text-[10px] font-sans text-[var(--text-tertiary)]">
                OLS Window Fixes / Span
              </div>
              <div className="font-semibold text-[var(--text-primary)] mt-0.5">
                {metrics
                  ? `${metrics.window_sample_count} pts / ${metrics.window_duration_s.toFixed(1)}s`
                  : '0 pts / 0.0s'}
              </div>
            </div>

            <div className="bg-[var(--bg-surface-2)] border border-[var(--border-subtle)] rounded-[var(--radius-sm)] p-2">
              <div className="text-[10px] font-sans text-[var(--text-tertiary)]">
                GPS Position Jitter (RMSE)
              </div>
              <div className="font-semibold text-[var(--text-primary)] mt-0.5">
                {metrics ? `${metrics.window_position_rmse_m.toFixed(2)} m` : '--'}
              </div>
            </div>

            <div className="bg-[var(--bg-surface-2)] border border-[var(--border-subtle)] rounded-[var(--radius-sm)] p-2">
              <div className="text-[10px] font-sans text-[var(--text-tertiary)]">
                OLS Velocity Std Error SE(v)
              </div>
              <div className="font-semibold text-[var(--text-primary)] mt-0.5">
                {metrics ? `${metrics.velocity_std_error_ms.toFixed(3)} m/s` : '--'}
              </div>
            </div>

            <div className="bg-[var(--bg-surface-2)] border border-[var(--border-subtle)] rounded-[var(--radius-sm)] p-2">
              <div className="text-[10px] font-sans text-[var(--text-tertiary)]">
                1σ Extrapolation Sensitivity (Approx.)
              </div>
              <div className="font-semibold text-[var(--text-primary)] mt-0.5">
                {metrics
                  ? `±${metrics.extrapolated_position_std_error_m.toFixed(1)} m`
                  : '--'}
              </div>
              <div className="text-[9px] font-sans text-[var(--text-tertiary)] mt-0.5 leading-tight">
                Approx. SE(v)×t_rem sensitivity only — not a confidence region or landing boundary
              </div>
            </div>
          </div>

          {/* Mandatory Non-Calibrated Accuracy Warning */}
          <div className="bg-[var(--status-warning-bg)] border border-[var(--status-warning)]/30 rounded-[var(--radius-sm)] p-2.5 flex items-start gap-2 text-[11px] text-[var(--text-primary)]">
            <Info className="w-4 h-4 text-[var(--status-warning)] shrink-0 mt-0.5" />
            <div className="leading-relaxed">
              <strong className="text-[var(--status-warning)]">
                Uncalibrated Diagnostic Warning:
              </strong>{' '}
              {activeResponse.landing_accuracy_warning}
            </div>
          </div>
        </section>

        {/* CARD 3: Telemetry Timestamp & Freshness Separation */}
        <section className="ops-card p-4 space-y-2.5">
          <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-2">
            <div className="flex items-center gap-2">
              <Radio className="w-4 h-4 text-[var(--accent-cobalt)]" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-primary)]">
                Telemetry Timestamps & Quality
              </h3>
            </div>
            <span className="font-mono-data text-[11px] text-[var(--text-secondary)]">
              PKT #{latestPacket?.packetNumber ?? 'NONE'}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2 font-mono-data text-xs">
            <div className="bg-[var(--bg-surface-2)] border border-[var(--border-subtle)] rounded-[var(--radius-sm)] p-2">
              <div className="text-[10px] font-sans text-[var(--text-tertiary)]">
                GNSS UTC
              </div>
              <div className="font-semibold text-[var(--text-primary)] mt-0.5">
                {latestPacket?.timestampUtc ?? '--:--:--'}
              </div>
            </div>
            <div className="bg-[var(--bg-surface-2)] border border-[var(--border-subtle)] rounded-[var(--radius-sm)] p-2">
              <div className="text-[10px] font-sans text-[var(--text-tertiary)]">
                GNSS IST (+05:30)
              </div>
              <div className="font-semibold text-[var(--accent-cobalt)] mt-0.5">
                {latestPacket?.gnssTimeIst ?? '--:--:--'}
              </div>
            </div>
            <div className="bg-[var(--bg-surface-2)] border border-[var(--border-subtle)] rounded-[var(--radius-sm)] p-2">
              <div className="text-[10px] font-sans text-[var(--text-tertiary)]">
                Computer RX (UTC)
              </div>
              <div className="font-semibold text-[var(--text-primary)] mt-0.5">
                {latestPacket?.receivedAtTimeStr ??
                  (isSim ? 'SIM LOOP' : '--:--:--')}
              </div>
            </div>
          </div>

          <div className="flex justify-between text-[11px] font-mono-data text-[var(--text-secondary)] pt-1">
            <span>
              Rejected Invalid GPS:{' '}
              <strong>{metrics?.rejected_invalid_gps_count ?? 0}</strong>
            </span>
            <span>
              Rejected Dup Timestamps:{' '}
              <strong>{metrics?.rejected_duplicate_timestamp_count ?? 0}</strong>
            </span>
          </div>
        </section>

        {/* CARD 4: Configurable Altitude Reference, Mission Profile & Target */}
        <section className="ops-card p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-2">
            <div className="flex items-center gap-2">
              <Sliders className="w-4 h-4 text-[var(--accent-cobalt)]" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-primary)]">
                Altitude Reference & Mission Profile
              </h3>
            </div>
            <span className="text-[10px] font-mono-data text-[var(--text-tertiary)]">
              Configurable Assumptions
            </span>
          </div>

          {/* Altitude Reference Controls */}
          <div className="space-y-2 text-xs">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label
                  htmlFor="lp-alt-source"
                  className="block text-[11px] font-medium text-[var(--text-secondary)] mb-1"
                >
                  Altitude Reference Source
                </label>
                <select
                  id="lp-alt-source"
                  value={config.altitude_source}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      altitude_source: e.target.value as AltitudeSourceMode,
                    }))
                  }
                  className="w-full bg-[var(--bg-surface-2)] border border-[var(--border-subtle)] rounded-[var(--radius-xs)] px-2 py-1.5 text-xs font-mono-data text-[var(--text-primary)]"
                >
                  <option value="BARO_PREFERRED">BARO_PREFERRED</option>
                  <option value="BARO_ONLY">BARO_ONLY</option>
                  <option value="GPS_AMSL_MINUS_GROUND">GPS_AMSL_MINUS_GROUND</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="lp-window-sec"
                  className="block text-[11px] font-medium text-[var(--text-secondary)] mb-1"
                >
                  Velocity OLS Window (s)
                </label>
                <input
                  id="lp-window-sec"
                  type="number"
                  min={2}
                  max={25}
                  step={1}
                  value={config.velocity_window_seconds}
                  onChange={(e) => {
                    const val = Math.max(2, Math.min(25, Number(e.target.value) || 8));
                    setConfig((prev) => ({
                      ...prev,
                      velocity_window_seconds: val,
                      max_window_samples: Math.max(6, val + 2),
                    }));
                  }}
                  className="w-full bg-[var(--bg-surface-2)] border border-[var(--border-subtle)] rounded-[var(--radius-xs)] px-2 py-1.5 text-xs font-mono-data text-[var(--text-primary)]"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label
                  htmlFor="lp-baro-offset"
                  className="block text-[11px] font-medium text-[var(--text-secondary)] mb-1"
                >
                  Baro Ground Offset (m)
                </label>
                <input
                  id="lp-baro-offset"
                  type="number"
                  step={1}
                  value={config.baro_ground_offset_m}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      baro_ground_offset_m: Number(e.target.value) || 0,
                    }))
                  }
                  className="w-full bg-[var(--bg-surface-2)] border border-[var(--border-subtle)] rounded-[var(--radius-xs)] px-2 py-1.5 text-xs font-mono-data text-[var(--text-primary)]"
                />
              </div>

              <div>
                <label
                  htmlFor="lp-ground-amsl"
                  className="block text-[11px] font-medium text-[var(--text-secondary)] mb-1"
                >
                  Ground Elevation AMSL (m)
                </label>
                <input
                  id="lp-ground-amsl"
                  type="number"
                  step={1}
                  value={config.ground_elevation_amsl_m}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      ground_elevation_amsl_m: Number(e.target.value) || 0,
                    }))
                  }
                  className="w-full bg-[var(--bg-surface-2)] border border-[var(--border-subtle)] rounded-[var(--radius-xs)] px-2 py-1.5 text-xs font-mono-data text-[var(--text-primary)]"
                />
              </div>
            </div>

            {/* Two-Stage Descent Propagation Mode */}
            <div className="pt-2 border-t border-[var(--border-subtle)] grid grid-cols-2 gap-2">
              <div className="col-span-2">
                <label
                  htmlFor="lp-prop-mode"
                  className="block text-[11px] font-medium text-[var(--text-secondary)] mb-1"
                >
                  Descent Propagation Mode (Mission Profile Unverified)
                </label>
                <select
                  id="lp-prop-mode"
                  value={config.propagation_mode}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      propagation_mode: e.target.value as DescentPropagationMode,
                    }))
                  }
                  className="w-full bg-[var(--bg-surface-2)] border border-[var(--border-subtle)] rounded-[var(--radius-xs)] px-2 py-1.5 text-xs font-mono-data text-[var(--text-primary)]"
                >
                  <option value="OBSERVED_RATE">
                    OBSERVED_RATE (Default — Current Vertical Rate)
                  </option>
                  <option value="TWO_STAGE_CONFIGURABLE">
                    TWO_STAGE_CONFIGURABLE (Drogue -&gt; Parafoil at transition alt)
                  </option>
                </select>
              </div>

              {config.propagation_mode === 'TWO_STAGE_CONFIGURABLE' && (
                <>
                  <div>
                    <label
                      htmlFor="lp-parafoil-alt"
                      className="block text-[11px] font-medium text-[var(--text-secondary)] mb-1"
                    >
                      Parafoil Transition Alt (m)
                    </label>
                    <input
                      id="lp-parafoil-alt"
                      type="number"
                      step={10}
                      value={config.parafoil_transition_altitude_m}
                      onChange={(e) =>
                        setConfig((prev) => ({
                          ...prev,
                          parafoil_transition_altitude_m:
                            Math.max(10, Number(e.target.value) || 600),
                        }))
                      }
                      className="w-full bg-[var(--bg-surface-2)] border border-[var(--border-subtle)] rounded-[var(--radius-xs)] px-2 py-1.5 text-xs font-mono-data text-[var(--text-primary)]"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="lp-stage2-rate"
                      className="block text-[11px] font-medium text-[var(--text-secondary)] mb-1"
                    >
                      Stage 2 Descent Rate (m/s)
                    </label>
                    <input
                      id="lp-stage2-rate"
                      type="number"
                      step={0.1}
                      min={0.5}
                      value={config.stage2_nominal_descent_rate_ms}
                      onChange={(e) =>
                        setConfig((prev) => ({
                          ...prev,
                          stage2_nominal_descent_rate_ms:
                            Math.max(0.5, Number(e.target.value) || 2.2),
                        }))
                      }
                      className="w-full bg-[var(--bg-surface-2)] border border-[var(--border-subtle)] rounded-[var(--radius-xs)] px-2 py-1.5 text-xs font-mono-data text-[var(--text-primary)]"
                    />
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Target Location Configuration */}
          <div className="pt-2.5 border-t border-[var(--border-subtle)] space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-[var(--text-secondary)] flex items-center gap-1.5">
                <Target className="w-3.5 h-3.5 text-[var(--status-nominal)]" />
                Target Coordinate (Click Map or Enter)
              </span>
              {config.target_lat_deg !== null && (
                <button
                  type="button"
                  onClick={handleClearTarget}
                  className="text-[11px] text-[var(--status-alert)] hover:underline cursor-pointer"
                >
                  Clear Target
                </button>
              )}
            </div>

            <form onSubmit={handleApplyTarget} className="grid grid-cols-5 gap-1.5">
              <input
                type="text"
                placeholder="Lat (e.g. 13.3525)"
                value={targetLatInput}
                onChange={(e) => setTargetLatInput(e.target.value)}
                className="col-span-2 bg-[var(--bg-surface-2)] border border-[var(--border-subtle)] rounded-[var(--radius-xs)] px-2 py-1 text-xs font-mono-data text-[var(--text-primary)]"
              />
              <input
                type="text"
                placeholder="Lon (e.g. 74.7928)"
                value={targetLonInput}
                onChange={(e) => setTargetLonInput(e.target.value)}
                className="col-span-2 bg-[var(--bg-surface-2)] border border-[var(--border-subtle)] rounded-[var(--radius-xs)] px-2 py-1 text-xs font-mono-data text-[var(--text-primary)]"
              />
              <button
                type="submit"
                className="col-span-1 bg-[var(--accent-cobalt)] hover:bg-[var(--accent-cobalt-hover)] text-white text-xs font-semibold rounded-[var(--radius-xs)] cursor-pointer"
              >
                Set
              </button>
            </form>

            {targetError && (
              <div className="text-[11px] text-[var(--status-alert)]">{targetError}</div>
            )}

            {pred && pred.distance_to_target_m !== null && (
              <div className="bg-[var(--status-nominal-bg)] border border-[var(--status-nominal)]/30 rounded-[var(--radius-xs)] px-2.5 py-1.5 font-mono-data text-[11px] text-[var(--status-nominal)] flex justify-between">
                <span>Predicted Miss Distance to Target:</span>
                <strong>
                  {pred.distance_to_target_m.toFixed(1)} m (
                  {pred.bearing_to_target_deg?.toFixed(1)}°)
                </strong>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};
