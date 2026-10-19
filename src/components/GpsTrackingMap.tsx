import React, { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import {
  Check,
  Compass,
  Crosshair,
  ExternalLink,
  MapPin,
  Navigation,
  Radio,
  Satellite,
  ShieldAlert,
  Target,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { TelemetryPacket, TelemetrySource } from '../types';
import { BASE_GPS } from '../constants';
import {
  PredictionResponsePayload,
  isValidCoordinateFix,
  parseAndValidateTargetCoordinates,
} from '../services/landingPredictorClient';

interface GpsTrackingMapProps {
  latestPacket: TelemetryPacket | null;
  historyPackets?: TelemetryPacket[];
  telemetrySource?: TelemetrySource;
  isStale?: boolean;
  prediction?: PredictionResponsePayload | null;
  targetLat?: number | null;
  targetLon?: number | null;
  onUpdateTarget?: (lat: number | null, lon: number | null) => void;
  onOpenLandingPredictor?: () => void;
}

export function isPacketGpsValid(
  p: TelemetryPacket | null | undefined
): p is TelemetryPacket & { latitude: number; longitude: number } {
  if (!p) return false;
  if (p.gpsValid === false || p.gpsFixType === 'NO_FIX') return false;
  if (typeof p.gpsSats === 'number' && p.gpsSats <= 0) return false;
  return isValidCoordinateFix(p.latitude, p.longitude, true);
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

export const GpsTrackingMap: React.FC<GpsTrackingMapProps> = ({
  latestPacket,
  historyPackets = [],
  telemetrySource = 'SIMULATION',
  isStale = false,
  prediction = null,
  targetLat: externalTargetLat,
  targetLon: externalTargetLon,
  onUpdateTarget,
  onOpenLandingPredictor,
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const canSatMarkerRef = useRef<L.Marker | null>(null);
  const targetMarkerRef = useRef<L.Marker | null>(null);
  const gsMarkerRef = useRef<L.Marker | null>(null);
  const polylineRef = useRef<L.Polyline | null>(null);
  const targetVectorRef = useRef<L.Polyline | null>(null);
  const predictedMarkerRef = useRef<L.Marker | null>(null);
  const predictedDriftLineRef = useRef<L.Polyline | null>(null);

  const [followVehicle, setFollowVehicle] = useState<boolean>(true);
  const [mapType, setMapType] = useState<'osm' | 'satellite' | 'dark'>('osm');
  const [showTargetModal, setShowTargetModal] = useState<boolean>(false);
  const [geoError, setGeoError] = useState<string | null>(null);

  const [internalTargetLat, setInternalTargetLat] = useState<number | null>(null);
  const [internalTargetLon, setInternalTargetLon] = useState<number | null>(null);
  const [inputTargetLat, setInputTargetLat] = useState<string>('');
  const [inputTargetLon, setInputTargetLon] = useState<string>('');

  const targetLat =
    externalTargetLat !== undefined ? externalTargetLat : internalTargetLat;
  const targetLon =
    externalTargetLon !== undefined ? externalTargetLon : internalTargetLon;

  const updateTargetCoordinates = (lat: number | null, lon: number | null) => {
    if (onUpdateTarget) {
      onUpdateTarget(lat, lon);
    } else {
      setInternalTargetLat(lat);
      setInternalTargetLon(lon);
    }
  };

  const updateTargetRef = useRef(updateTargetCoordinates);
  updateTargetRef.current = updateTargetCoordinates;

  const isSim = telemetrySource === 'SIMULATION';

  const gsLat = BASE_GPS.latitude;
  const gsLon = BASE_GPS.longitude;

  const isGpsValid = isPacketGpsValid(latestPacket);

  const canSatLat = isGpsValid ? latestPacket.latitude : null;
  const canSatLon = isGpsValid ? latestPacket.longitude : null;
  const alt = latestPacket?.altitude ?? null;
  const gpsAlt =
    isGpsValid && typeof latestPacket.gpsAltitude === 'number'
      ? latestPacket.gpsAltitude
      : null;
  const sats = latestPacket?.gpsSats ?? null;
  const fixType = isGpsValid ? latestPacket.gpsFixType : 'NO_FIX';

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
    satellite:
      'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP',
    dark: '&copy; OpenStreetMap contributors &copy; CARTO',
  };

  const calculateDistanceMeters = (
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
  ): number => {
    const R = 6371000;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  const calculateBearing = (
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
  ): number => {
    const phi1 = (lat1 * Math.PI) / 180;
    const phi2 = (lat2 * Math.PI) / 180;
    const dLambda = ((lon2 - lon1) * Math.PI) / 180;
    const y = Math.sin(dLambda) * Math.cos(phi2);
    const x =
      Math.cos(phi1) * Math.sin(phi2) -
      Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
    const theta = Math.atan2(y, x);
    return ((theta * 180) / Math.PI + 360) % 360;
  };

  const distanceToTargetMeters = useMemo(() => {
    if (
      canSatLat === null ||
      canSatLon === null ||
      targetLat === null ||
      targetLon === null
    )
      return null;
    return calculateDistanceMeters(canSatLat, canSatLon, targetLat, targetLon);
  }, [canSatLat, canSatLon, targetLat, targetLon]);

  const bearingToTargetDeg = useMemo(() => {
    if (
      canSatLat === null ||
      canSatLon === null ||
      targetLat === null ||
      targetLon === null
    )
      return null;
    return calculateBearing(canSatLat, canSatLon, targetLat, targetLon);
  }, [canSatLat, canSatLon, targetLat, targetLon]);

  const distanceToGsMeters = useMemo(() => {
    if (canSatLat === null || canSatLon === null) return null;
    return calculateDistanceMeters(canSatLat, canSatLon, gsLat, gsLon);
  }, [canSatLat, canSatLon, gsLat, gsLon]);

  const validTrailPoints = useMemo<[number, number][]>(() => {
    return historyPackets
      .filter(isPacketGpsValid)
      .map((p) => [p.latitude, p.longitude]);
  }, [historyPackets]);

  const formatCoordinates = (lat: number | null, lon: number | null) => {
    if (lat === null || lon === null || isNaN(lat) || isNaN(lon))
      return 'UNAVAILABLE (NO FIX)';
    const latDir = lat >= 0 ? 'N' : 'S';
    const lonDir = lon >= 0 ? 'E' : 'W';
    return `${Math.abs(lat).toFixed(5)}° ${latDir}, ${Math.abs(lon).toFixed(
      5
    )}° ${lonDir}`;
  };

  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container) return;

    const initialCenter: [number, number] =
      canSatLat !== null && canSatLon !== null
        ? [canSatLat, canSatLon]
        : [gsLat, gsLon];

    const map = L.map(container, {
      center: initialCenter,
      zoom: 16,
      zoomControl: false,
      attributionControl: true,
    });

    const tileLayer = L.tileLayer(tileUrls[mapType], {
      maxZoom: 19,
      subdomains: 'abcd',
      attribution: tileAttributions[mapType],
    }).addTo(map);

    tileLayerRef.current = tileLayer;

    L.control.scale({ position: 'bottomleft', imperial: false }).addTo(map);

    map.on('click', (e: L.LeafletMouseEvent) => {
      const clickedLat = Number(e.latlng.lat.toFixed(6));
      const clickedLon = Number(e.latlng.lng.toFixed(6));
      if (!isValidCoordinateFix(clickedLat, clickedLon, true)) {
        setGeoError('Invalid (0.0000, 0.0000) or out-of-bounds target coordinate rejected.');
        return;
      }
      setGeoError(null);
      updateTargetRef.current(clickedLat, clickedLon);
      setInputTargetLat(clickedLat.toFixed(6));
      setInputTargetLon(clickedLon.toFixed(6));
    });

    mapRef.current = map;

    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize();
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      if (canSatMarkerRef.current) {
        canSatMarkerRef.current.remove();
        canSatMarkerRef.current = null;
      }
      if (targetMarkerRef.current) {
        targetMarkerRef.current.remove();
        targetMarkerRef.current = null;
      }
      if (gsMarkerRef.current) {
        gsMarkerRef.current.remove();
        gsMarkerRef.current = null;
      }
      if (polylineRef.current) {
        polylineRef.current.remove();
        polylineRef.current = null;
      }
      if (targetVectorRef.current) {
        targetVectorRef.current.remove();
        targetVectorRef.current = null;
      }
      if (predictedMarkerRef.current) {
        predictedMarkerRef.current.remove();
        predictedMarkerRef.current = null;
      }
      if (predictedDriftLineRef.current) {
        predictedDriftLineRef.current.remove();
        predictedDriftLineRef.current = null;
      }
      map.remove();
      mapRef.current = null;
    };
  }, []);

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

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Marker A: Configurable Landing Target (only if valid non-Null-Island coordinate)
    if (
      targetLat !== null &&
      targetLon !== null &&
      isValidCoordinateFix(targetLat, targetLon, true)
    ) {
      const targetHtml = `
        <div style="transform: translate(-50%, -50%); display: flex; flex-direction: column; align-items: center; pointer-events: none;">
          <div style="background: #ffffff; border: 1.5px solid #15803d; color: #15803d; font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 4px; white-space: nowrap; box-shadow: 0 1px 4px rgba(15,23,42,0.18);">
            TARGET
          </div>
          <div style="width: 14px; height: 14px; border: 2px solid #15803d; border-radius: 50%; margin-top: 2px; position: relative; background: rgba(21, 128, 61, 0.16);">
            <div style="position: absolute; width: 4px; height: 4px; background: #15803d; border-radius: 50%; top: 3px; left: 3px;"></div>
          </div>
        </div>
      `;
      const targetIcon = L.divIcon({
        html: targetHtml,
        className: 'target-marker-icon',
        iconSize: [0, 0],
      });

      if (!targetMarkerRef.current) {
        targetMarkerRef.current = L.marker([targetLat, targetLon], {
          icon: targetIcon,
          interactive: false,
        }).addTo(map);
      } else {
        targetMarkerRef.current.setLatLng([targetLat, targetLon]);
        targetMarkerRef.current.setIcon(targetIcon);
      }
    } else if (targetMarkerRef.current) {
      targetMarkerRef.current.remove();
      targetMarkerRef.current = null;
    }

    // Marker B: Ground Station Base
    const gsHtml = `
      <div style="transform: translate(-50%, -50%); display: flex; flex-direction: column; align-items: center; pointer-events: none;">
        <div style="background: #ffffff; border: 1.5px solid #475569; color: #0f172a; font-family: 'JetBrains Mono', monospace; font-size: 9px; font-weight: 700; padding: 1px 5px; border-radius: 4px; white-space: nowrap; box-shadow: 0 1px 4px rgba(15,23,42,0.18);">
          GS BASE
        </div>
        <div style="width: 8px; height: 8px; background: #475569; border: 1.5px solid #ffffff; transform: rotate(45deg); margin-top: 2px;"></div>
      </div>
    `;
    const gsIcon = L.divIcon({
      html: gsHtml,
      className: 'gs-marker-icon',
      iconSize: [0, 0],
    });

    if (!gsMarkerRef.current) {
      gsMarkerRef.current = L.marker([gsLat, gsLon], {
        icon: gsIcon,
        interactive: false,
      }).addTo(map);
    } else {
      gsMarkerRef.current.setLatLng([gsLat, gsLon]);
    }

    // Marker C: Validated CanSat Position
    if (canSatLat !== null && canSatLon !== null) {
      const altStr =
        typeof alt === 'number' && Number.isFinite(alt)
          ? `${alt.toFixed(0)}m`
          : '--';
      const canSatHtml = `
        <div style="transform: translate(-50%, -100%); display: flex; flex-direction: column; align-items: center; cursor: pointer;">
          <div style="background: #1d4ed8; color: #ffffff; font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 4px; border: 1.5px solid #ffffff; white-space: nowrap; box-shadow: 0 2px 6px rgba(29,78,216,0.35); display: flex; align-items: center; gap: 4px;">
            <span>CANSAT</span>
            <span style="opacity: 0.9;">(${altStr})</span>
          </div>
          <div style="width: 10px; height: 10px; background: #1d4ed8; border: 2px solid #ffffff; border-radius: 50%; box-shadow: 0 0 0 2px #1d4ed8; margin-top: 2px;"></div>
        </div>
      `;
      const canSatIcon = L.divIcon({
        html: canSatHtml,
        className: 'cansat-marker-icon',
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      });

      if (!canSatMarkerRef.current) {
        canSatMarkerRef.current = L.marker([canSatLat, canSatLon], {
          icon: canSatIcon,
          zIndexOffset: 1000,
        }).addTo(map);
      } else {
        canSatMarkerRef.current.setLatLng([canSatLat, canSatLon]);
        canSatMarkerRef.current.setIcon(canSatIcon);
      }

      if (followVehicle) {
        map.panTo([canSatLat, canSatLon], { animate: true, duration: 0.25 });
      }

      if (
        targetLat !== null &&
        targetLon !== null &&
        isValidCoordinateFix(targetLat, targetLon, true)
      ) {
        const vectorCoords: [number, number][] = [
          [canSatLat, canSatLon],
          [targetLat, targetLon],
        ];
        if (!targetVectorRef.current) {
          targetVectorRef.current = L.polyline(vectorCoords, {
            color: '#15803d',
            weight: 1.8,
            dashArray: '4, 4',
            opacity: 0.8,
          }).addTo(map);
        } else {
          targetVectorRef.current.setLatLngs(vectorCoords);
        }
      } else if (targetVectorRef.current) {
        targetVectorRef.current.remove();
        targetVectorRef.current = null;
      }
    } else {
      if (canSatMarkerRef.current) {
        canSatMarkerRef.current.remove();
        canSatMarkerRef.current = null;
      }
      if (targetVectorRef.current) {
        targetVectorRef.current.remove();
        targetVectorRef.current = null;
      }
    }

    // Marker D: Gated Predicted Landing Point & Drift Vector
    if (
      shouldDisplayPredictedOverlay(prediction, isStale, canSatLat, canSatLon) &&
      prediction?.prediction &&
      canSatLat !== null &&
      canSatLon !== null
    ) {
      const predLat = prediction.prediction.predicted_lat_deg;
      const predLon = prediction.prediction.predicted_lon_deg;
      const tRemStr = `${prediction.prediction.estimated_time_to_landing_s.toFixed(0)}s`;

      const predHtml = `
        <div style="transform: translate(-50%, -100%); display: flex; flex-direction: column; align-items: center; pointer-events: none;">
          <div style="background: #0f766e; color: #ffffff; font-family: 'JetBrains Mono', monospace; font-size: 9px; font-weight: 700; padding: 2px 6px; border-radius: 4px; border: 1.5px solid #ffffff; white-space: nowrap; box-shadow: 0 2px 6px rgba(15,118,110,0.35);">
            EST. LANDING (${tRemStr})
          </div>
          <div style="width: 10px; height: 10px; background: #0f766e; border: 2px solid #ffffff; border-radius: 50%; box-shadow: 0 0 0 2px #0f766e; margin-top: 2px;"></div>
        </div>
      `;
      const predIcon = L.divIcon({
        html: predHtml,
        className: 'overview-predicted-landing-icon',
        iconSize: [0, 0],
      });

      if (!predictedMarkerRef.current) {
        predictedMarkerRef.current = L.marker([predLat, predLon], {
          icon: predIcon,
          zIndexOffset: 900,
          interactive: false,
        }).addTo(map);
      } else {
        predictedMarkerRef.current.setLatLng([predLat, predLon]);
        predictedMarkerRef.current.setIcon(predIcon);
      }

      const driftCoords: [number, number][] = [
        [canSatLat, canSatLon],
        [predLat, predLon],
      ];
      if (!predictedDriftLineRef.current) {
        predictedDriftLineRef.current = L.polyline(driftCoords, {
          color: '#0f766e',
          weight: 2.0,
          dashArray: '5, 5',
          opacity: 0.9,
        }).addTo(map);
      } else {
        predictedDriftLineRef.current.setLatLngs(driftCoords);
      }
    } else {
      if (predictedMarkerRef.current) {
        predictedMarkerRef.current.remove();
        predictedMarkerRef.current = null;
      }
      if (predictedDriftLineRef.current) {
        predictedDriftLineRef.current.remove();
        predictedDriftLineRef.current = null;
      }
    }

    // Trail: Historical Valid GPS Breadcrumbs Only
    if (validTrailPoints.length > 1) {
      if (!polylineRef.current) {
        polylineRef.current = L.polyline(validTrailPoints, {
          color: '#1d4ed8',
          weight: 2.2,
          opacity: 0.85,
        }).addTo(map);
      } else {
        polylineRef.current.setLatLngs(validTrailPoints);
      }
    } else if (polylineRef.current) {
      polylineRef.current.remove();
      polylineRef.current = null;
    }
  }, [
    canSatLat,
    canSatLon,
    alt,
    targetLat,
    targetLon,
    gsLat,
    gsLon,
    validTrailPoints,
    followVehicle,
    prediction,
    isStale,
  ]);

  const handleTargetSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseAndValidateTargetCoordinates(inputTargetLat, inputTargetLon);
    if (!parsed.valid) {
      setGeoError(parsed.error);
      return;
    }

    setGeoError(null);
    updateTargetCoordinates(parsed.latDeg, parsed.lonDeg);
    setShowTargetModal(false);

    if (mapRef.current) {
      mapRef.current.flyTo([parsed.latDeg, parsed.lonDeg], 16, { duration: 0.8 });
    }
  };

  return (
    <div className="ops-card flex flex-col h-full select-none overflow-hidden relative">
      {/* Top Header Bar */}
      <div className="px-3 py-2 bg-[var(--bg-surface-1)] border-b border-[var(--border-subtle)] flex justify-between items-center z-10 shrink-0 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <MapPin className="w-4 h-4 text-[var(--accent-cobalt)] shrink-0" />
          <span className="text-xs font-bold text-[var(--text-primary)] tracking-tight truncate">
            GNSS Spatial Track
          </span>
          <span
            className={`px-1.5 py-0.5 border flex items-center gap-1 rounded-[var(--radius-xs)] font-mono-data text-[10px] font-semibold shrink-0 ${
              fixType === '3D'
                ? 'text-[var(--status-nominal)] bg-[var(--status-nominal-bg)] border-[var(--status-nominal)]/30'
                : fixType === '2D'
                ? 'text-[var(--status-warning)] bg-[var(--status-warning-bg)] border-[var(--status-warning)]/30'
                : 'text-[var(--status-alert)] bg-[var(--status-alert-bg)] border-[var(--status-alert)]/30'
            }`}
          >
            <Satellite className="w-3 h-3" />
            {fixType} ({sats !== null ? `${sats}` : '0'})
          </span>
        </div>

        <div className="flex items-center gap-1.5 text-[11px] shrink-0">
          {/* Map Layer Switcher */}
          <div className="hidden md:flex items-center bg-[var(--bg-surface-2)] border border-[var(--border-subtle)] rounded-[var(--radius-xs)] p-0.5 text-[10px] font-medium">
            <button
              type="button"
              onClick={() => setMapType('osm')}
              className={`px-2 py-0.5 rounded-[var(--radius-xs)] cursor-pointer transition-colors ${
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
              className={`px-2 py-0.5 rounded-[var(--radius-xs)] cursor-pointer transition-colors ${
                mapType === 'satellite'
                  ? 'bg-[var(--bg-surface-1)] text-[var(--accent-cobalt)] font-semibold shadow-[var(--shadow-xs)]'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              Sat
            </button>
            {hasCartoKey && (
              <button
                type="button"
                onClick={() => setMapType('dark')}
                className={`px-2 py-0.5 rounded-[var(--radius-xs)] cursor-pointer transition-colors ${
                  mapType === 'dark'
                    ? 'bg-[var(--bg-surface-1)] text-[var(--accent-cobalt)] font-semibold shadow-[var(--shadow-xs)]'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                Dark
              </button>
            )}
          </div>

          {onOpenLandingPredictor && (
            <button
              type="button"
              onClick={onOpenLandingPredictor}
              title="Open Full Landing Predictor Workspace"
              className="px-2 py-0.5 bg-[var(--accent-teal-soft)] text-[var(--accent-teal)] border border-[var(--accent-teal)]/30 hover:bg-[var(--accent-teal)] hover:text-white rounded-[var(--radius-xs)] font-semibold text-[10px] cursor-pointer flex items-center gap-1 transition-colors"
            >
              <ExternalLink className="w-3 h-3" />
              <span className="hidden xl:inline">Predictor</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              setInputTargetLat(targetLat !== null ? targetLat.toFixed(6) : '');
              setInputTargetLon(targetLon !== null ? targetLon.toFixed(6) : '');
              setShowTargetModal(true);
            }}
            title="Configure Target Landing Coordinates"
            className={`px-2 py-0.5 border cursor-pointer flex items-center gap-1 rounded-[var(--radius-xs)] font-medium text-[10px] transition-colors ${
              targetLat !== null
                ? 'bg-[var(--status-nominal-bg)] text-[var(--status-nominal)] border-[var(--status-nominal)]/30 font-semibold'
                : 'bg-[var(--bg-surface-2)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:text-[var(--text-primary)]'
            }`}
          >
            <Target className="w-3 h-3" />
            <span className="hidden sm:inline">Target</span>
          </button>

          <button
            type="button"
            onClick={() => setFollowVehicle(!followVehicle)}
            title={
              followVehicle
                ? 'Recenter Locked: Auto-following CanSat'
                : 'Click to Lock Recenter on CanSat'
            }
            className={`p-1 border cursor-pointer rounded-[var(--radius-xs)] transition-colors ${
              followVehicle
                ? 'bg-[var(--accent-cobalt-soft)] text-[var(--accent-cobalt)] border-[var(--accent-cobalt)]/30'
                : 'bg-[var(--bg-surface-2)] text-[var(--text-tertiary)] border-[var(--border-subtle)]'
            }`}
          >
            <Crosshair className="w-3.5 h-3.5" />
          </button>

          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => mapRef.current?.zoomIn()}
              title="Zoom In"
              className="p-1 bg-[var(--bg-surface-2)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border-subtle)] cursor-pointer rounded-[var(--radius-xs)]"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => mapRef.current?.zoomOut()}
              title="Zoom Out"
              className="p-1 bg-[var(--bg-surface-2)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border-subtle)] cursor-pointer rounded-[var(--radius-xs)]"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {geoError && (
        <div className="bg-[var(--status-alert-bg)] border-b border-[var(--status-alert)]/40 text-[var(--status-alert)] px-3 py-1 font-mono-data text-[10px] flex items-center justify-between z-10">
          <div className="flex items-center gap-1.5">
            <ShieldAlert className="w-3.5 h-3.5 text-[var(--status-alert)]" />
            <span>{geoError}</span>
          </div>
          <button
            type="button"
            onClick={() => setGeoError(null)}
            className="underline cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Main Map Viewport */}
      <div className="flex-1 relative bg-[#e5e9f0] overflow-hidden min-h-[180px]">
        <div
          ref={mapContainerRef}
          className="absolute inset-0 w-full h-full z-0"
        />

        {/* Top-Left Overlay: CanSat Live Coordinates & Gated Predicted Landing */}
        <div className="absolute top-2.5 left-2.5 bg-[var(--bg-surface-1)]/95 border border-[var(--border-subtle)] px-2.5 py-1.5 font-mono-data text-[10px] text-[var(--text-secondary)] flex flex-col gap-0.5 shadow-[var(--shadow-sm)] backdrop-blur-xs z-10 pointer-events-none rounded-[var(--radius-sm)]">
          <div className="flex gap-2 items-center">
            <span className="text-[var(--text-tertiary)]">Vehicle Pos:</span>
            <span
              className={`font-bold tabular-nums ${
                isGpsValid
                  ? 'text-[var(--accent-cobalt)]'
                  : 'text-[var(--status-alert)]'
              }`}
            >
              {formatCoordinates(canSatLat, canSatLon)}
            </span>
          </div>
          <div className="flex gap-2 items-center">
            <span className="text-[var(--text-tertiary)]">Est. Landing:</span>
            <span
              className={`font-bold tabular-nums ${
                shouldDisplayPredictedOverlay(prediction, isStale, canSatLat, canSatLon)
                  ? 'text-[var(--accent-teal)]'
                  : 'text-[var(--status-warning)]'
              }`}
            >
              {shouldDisplayPredictedOverlay(prediction, isStale, canSatLat, canSatLon) &&
              prediction?.prediction
                ? formatCoordinates(
                    prediction.prediction.predicted_lat_deg,
                    prediction.prediction.predicted_lon_deg
                  )
                : `GATED (${isStale ? 'STALE_TELEMETRY' : prediction?.reason_code ?? 'NO_DATA'})`}
            </span>
          </div>
          <div className="flex gap-2 items-center">
            <span className="text-[var(--text-tertiary)]">Baro / GNSS Alt:</span>
            <span className="text-[var(--text-primary)] font-bold tabular-nums">
              {typeof alt === 'number' && Number.isFinite(alt)
                ? `${alt.toFixed(1)}m`
                : '--'}{' '}
              / {gpsAlt !== null ? `${gpsAlt.toFixed(1)}m` : 'NO FIX'}
            </span>
          </div>
          <div className="flex justify-between items-center text-[9px] text-[var(--text-tertiary)] pt-0.5 border-t border-[var(--border-subtle)]">
            <span>Valid Track Fixes:</span>
            <span className="text-[var(--text-primary)] font-semibold tabular-nums">
              {validTrailPoints.length}
            </span>
          </div>
        </div>

        {/* Top-Right Overlay: Target Range & Bearing */}
        {targetLat !== null && targetLon !== null && (
          <div className="absolute top-2.5 right-2.5 bg-[var(--bg-surface-1)]/95 border border-[var(--border-subtle)] px-2.5 py-1.5 font-mono-data text-[10px] text-[var(--text-secondary)] flex flex-col gap-0.5 shadow-[var(--shadow-sm)] backdrop-blur-xs z-10 pointer-events-none rounded-[var(--radius-sm)]">
            <div className="flex gap-2 items-center">
              <Navigation className="w-3 h-3 text-[var(--status-nominal)]" />
              <span className="text-[var(--text-tertiary)]">Range:</span>
              <span className="text-[var(--status-nominal)] font-bold tabular-nums">
                {distanceToTargetMeters !== null
                  ? distanceToTargetMeters < 1000
                    ? `${distanceToTargetMeters.toFixed(1)} m`
                    : `${(distanceToTargetMeters / 1000).toFixed(2)} km`
                  : 'AWAITING FIX'}
              </span>
            </div>
            <div className="flex gap-2 items-center">
              <Compass className="w-3 h-3 text-[var(--text-secondary)]" />
              <span className="text-[var(--text-tertiary)]">Bearing:</span>
              <span className="text-[var(--text-primary)] font-bold tabular-nums">
                {bearingToTargetDeg !== null
                  ? `${bearingToTargetDeg.toFixed(1)}°`
                  : '--'}
              </span>
            </div>
          </div>
        )}

        {/* Bottom-Right Overlay: Ground Station Reference */}
        <div className="absolute bottom-6 right-2.5 bg-[var(--bg-surface-1)]/95 border border-[var(--border-subtle)] px-2.5 py-1 font-mono-data text-[10px] text-[var(--text-secondary)] flex items-center gap-1.5 shadow-[var(--shadow-xs)] backdrop-blur-xs z-10 pointer-events-none rounded-[var(--radius-xs)]">
          <Radio className="w-3 h-3 text-[var(--accent-cobalt)]" />
          <span>GS Base: {formatCoordinates(gsLat, gsLon)}</span>
          {distanceToGsMeters !== null && (
            <span className="text-[var(--text-primary)] font-semibold tabular-nums">
              (
              {distanceToGsMeters < 1000
                ? `${distanceToGsMeters.toFixed(0)}m`
                : `${(distanceToGsMeters / 1000).toFixed(2)}km`}
              )
            </span>
          )}
        </div>
      </div>

      {/* Target Landing Coordinate Configuration Modal */}
      {showTargetModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-[var(--bg-surface-1)] border border-[var(--border-strong)] max-w-sm w-full p-4 text-xs text-[var(--text-primary)] shadow-[var(--shadow-lg)] space-y-3 rounded-[var(--radius-md)]">
            <div className="flex justify-between items-center border-b border-[var(--border-subtle)] pb-2">
              <span className="font-bold text-[var(--text-primary)] uppercase tracking-tight flex items-center gap-1.5">
                <Target className="w-4 h-4 text-[var(--status-nominal)]" />
                Configure Reference Target
              </span>
              <button
                type="button"
                onClick={() => setShowTargetModal(false)}
                className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-[var(--text-secondary)] text-[11px] leading-relaxed">
              Enter target landing coordinates in decimal degrees, or click
              anywhere directly on the map surface to place the target marker:
            </p>

            <form onSubmit={handleTargetSubmit} className="space-y-3">
              <div>
                <label className="block text-[var(--text-secondary)] text-[10px] font-semibold uppercase mb-1">
                  Target Latitude (-90.0° to +90.0°)
                </label>
                <input
                  type="text"
                  value={inputTargetLat}
                  onChange={(e) => setInputTargetLat(e.target.value)}
                  placeholder="e.g. 13.35250"
                  className="w-full bg-[var(--bg-surface-2)] border border-[var(--border-subtle)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] font-mono-data tabular-nums focus:outline-none focus:border-[var(--accent-cobalt)] rounded-[var(--radius-xs)]"
                />
              </div>

              <div>
                <label className="block text-[var(--text-secondary)] text-[10px] font-semibold uppercase mb-1">
                  Target Longitude (-180.0° to +180.0°)
                </label>
                <input
                  type="text"
                  value={inputTargetLon}
                  onChange={(e) => setInputTargetLon(e.target.value)}
                  placeholder="e.g. 74.79280"
                  className="w-full bg-[var(--bg-surface-2)] border border-[var(--border-subtle)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] font-mono-data tabular-nums focus:outline-none focus:border-[var(--accent-cobalt)] rounded-[var(--radius-xs)]"
                />
              </div>

              <div className="flex justify-between items-center pt-2">
                <div className="flex items-center gap-2">
                  {targetLat !== null && (
                    <button
                      type="button"
                      onClick={() => {
                        updateTargetCoordinates(null, null);
                        setInputTargetLat('');
                        setInputTargetLon('');
                        setShowTargetModal(false);
                      }}
                      className="text-[11px] text-[var(--status-alert)] hover:underline cursor-pointer"
                    >
                      Clear
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setInputTargetLat(BASE_GPS.latitude.toFixed(6));
                      setInputTargetLon(BASE_GPS.longitude.toFixed(6));
                    }}
                    className="text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] underline cursor-pointer"
                  >
                    Fill GS Base
                  </button>
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setShowTargetModal(false)}
                    className="bg-[var(--bg-surface-2)] text-[var(--text-secondary)] px-3 py-1.5 text-xs font-medium cursor-pointer hover:text-[var(--text-primary)] rounded-[var(--radius-xs)] border border-[var(--border-subtle)]"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="bg-[var(--accent-cobalt)] text-white font-semibold px-3 py-1.5 text-xs cursor-pointer hover:bg-[var(--accent-cobalt-hover)] flex items-center gap-1 rounded-[var(--radius-xs)]"
                  >
                    <Check className="w-3.5 h-3.5" /> Apply
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
