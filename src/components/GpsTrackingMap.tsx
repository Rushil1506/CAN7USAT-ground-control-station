import React, { useState, useEffect, useRef, useMemo } from 'react';
import L from 'leaflet';
import { MapPin, Navigation, Crosshair, ZoomIn, ZoomOut, Satellite, Target, ShieldAlert, Edit3, Check, X, Compass, Radio } from 'lucide-react';
import { TelemetryPacket } from '../types';
import { BASE_GPS } from '../constants';

interface GpsTrackingMapProps {
  latestPacket: TelemetryPacket | null;
  historyPackets?: TelemetryPacket[];
  onSetCustomGroundStation?: (lat: number, lon: number) => void;
}

export const GpsTrackingMap: React.FC<GpsTrackingMapProps> = ({
  latestPacket,
  historyPackets = [],
  onSetCustomGroundStation,
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const canSatMarkerRef = useRef<L.Marker | null>(null);
  const targetMarkerRef = useRef<L.Marker | null>(null);
  const gsMarkerRef = useRef<L.Marker | null>(null);
  const polylineRef = useRef<L.Polyline | null>(null);
  const targetVectorRef = useRef<L.Polyline | null>(null);

  const [followVehicle, setFollowVehicle] = useState<boolean>(true);
  const [mapType, setMapType] = useState<'osm' | 'satellite' | 'dark'>('osm');
  const [showTargetModal, setShowTargetModal] = useState<boolean>(false);
  const [geoError, setGeoError] = useState<string | null>(null);

  // Configurable Landing Target (strictly distinct from Ground Station Base)
  // Null by default until operator explicitly designates a target
  const [targetLat, setTargetLat] = useState<number | null>(null);
  const [targetLon, setTargetLon] = useState<number | null>(null);

  // Target input form state
  const [inputTargetLat, setInputTargetLat] = useState<string>('');
  const [inputTargetLon, setInputTargetLon] = useState<string>('');

  // Ground Station base coordinates (Fixed Base reference)
  const gsLat = BASE_GPS.latitude;
  const gsLon = BASE_GPS.longitude;

  // Validate live GPS telemetry
  const isGpsValid =
    latestPacket !== null &&
    typeof latestPacket.latitude === 'number' &&
    typeof latestPacket.longitude === 'number' &&
    !isNaN(latestPacket.latitude) &&
    !isNaN(latestPacket.longitude) &&
    latestPacket.latitude >= -90 &&
    latestPacket.latitude <= 90 &&
    latestPacket.longitude >= -180 &&
    latestPacket.longitude <= 180 &&
    latestPacket.gpsFixType !== 'NO_FIX';

  const canSatLat = isGpsValid ? latestPacket!.latitude : null;
  const canSatLon = isGpsValid ? latestPacket!.longitude : null;
  const alt = latestPacket?.altitude;
  const sats = latestPacket?.gpsSats ?? 0;
  const fixType = latestPacket?.gpsFixType ?? 'NO_FIX';

  // Read CARTO API key from environment variable (VITE_CARTO_API_KEY)
  const cartoApiKey = (import.meta.env.VITE_CARTO_API_KEY ?? '').trim();
  const hasCartoKey = cartoApiKey.length > 0;

  // Tile Layer URLs
  const tileUrls: Record<'osm' | 'satellite' | 'dark', string> = {
    osm: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    satellite: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    dark: hasCartoKey
      ? `https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png?key=${encodeURIComponent(cartoApiKey)}`
      : 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
  };

  const tileAttributions: Record<'osm' | 'satellite' | 'dark', string> = {
    osm: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
    satellite: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
    dark: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener noreferrer">CARTO</a>',
  };

  // Great-circle distance calculation (Haversine formula in meters)
  const calculateDistanceMeters = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const R = 6371000; // Earth radius in meters
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  // Forward azimuth / bearing calculation (0° to 360°)
  const calculateBearing = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const phi1 = (lat1 * Math.PI) / 180;
    const phi2 = (lat2 * Math.PI) / 180;
    const dLambda = ((lon2 - lon1) * Math.PI) / 180;
    const y = Math.sin(dLambda) * Math.cos(phi2);
    const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
    const theta = Math.atan2(y, x);
    return (theta * 180 / Math.PI + 360) % 360;
  };

  // Distance to landing target (only when CanSat position and target are both explicitly valid)
  const distanceToTargetMeters = useMemo(() => {
    if (canSatLat === null || canSatLon === null || targetLat === null || targetLon === null) return null;
    return calculateDistanceMeters(canSatLat, canSatLon, targetLat, targetLon);
  }, [canSatLat, canSatLon, targetLat, targetLon]);

  // Bearing to landing target (only when CanSat position and target are both explicitly valid)
  const bearingToTargetDeg = useMemo(() => {
    if (canSatLat === null || canSatLon === null || targetLat === null || targetLon === null) return null;
    return calculateBearing(canSatLat, canSatLon, targetLat, targetLon);
  }, [canSatLat, canSatLon, targetLat, targetLon]);

  // Distance from CanSat to Ground Station base
  const distanceToGsMeters = useMemo(() => {
    if (canSatLat === null || canSatLon === null) return null;
    return calculateDistanceMeters(canSatLat, canSatLon, gsLat, gsLon);
  }, [canSatLat, canSatLon, gsLat, gsLon]);

  // Format latitude/longitude for display (e.g., "13.35250° N, 74.79280° E")
  const formatCoordinates = (lat: number | null, lon: number | null) => {
    if (lat === null || lon === null || isNaN(lat) || isNaN(lon)) return 'UNAVAILABLE';
    const latDir = lat >= 0 ? 'N' : 'S';
    const lonDir = lon >= 0 ? 'E' : 'W';
    return `${Math.abs(lat).toFixed(5)}° ${latDir}, ${Math.abs(lon).toFixed(5)}° ${lonDir}`;
  };

  // 1. Initialize Leaflet Map
  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container) return;

    const initialCenter: [number, number] = canSatLat !== null && canSatLon !== null
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

    // Scale control (metric)
    L.control.scale({ position: 'bottomleft', imperial: false }).addTo(map);

    // Map click: allow operator to set landing target coordinates interactively
    map.on('click', (e: L.LeafletMouseEvent) => {
      const { lat, lng } = e.latlng;
      setTargetLat(Number(lat.toFixed(6)));
      setTargetLon(Number(lng.toFixed(6)));
      setInputTargetLat(lat.toFixed(6));
      setInputTargetLon(lng.toFixed(6));
    });

    mapRef.current = map;

    // Resize observer to ensure tiles invalidate properly when tabs switch or container resizes
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
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // 2. Change Tile Layer on mapType toggle
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

  // 3. Update Markers, Target, and Trajectory Trails
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // --- Marker A: Configurable Landing Target (Only rendered if target is explicitly set) ---
    if (targetLat !== null && targetLon !== null) {
      const targetHtml = `
        <div style="transform: translate(-50%, -50%); display: flex; flex-direction: column; align-items: center; pointer-events: none;">
          <div style="background: rgba(14, 20, 27, 0.95); border: 1px solid #28C76F; color: #28C76F; font-family: monospace; font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 2px; white-space: nowrap; box-shadow: 0 2px 6px rgba(0,0,0,0.6);">
            TARGET
          </div>
          <div style="width: 14px; height: 14px; border: 2px solid #28C76F; border-radius: 50%; margin-top: 2px; position: relative; background: rgba(40, 199, 111, 0.2);">
            <div style="position: absolute; width: 4px; height: 4px; background: #28C76F; border-radius: 50%; top: 3px; left: 3px;"></div>
          </div>
        </div>
      `;
      const targetIcon = L.divIcon({
        html: targetHtml,
        className: 'target-marker-icon',
        iconSize: [0, 0],
      });

      if (!targetMarkerRef.current) {
        targetMarkerRef.current = L.marker([targetLat, targetLon], { icon: targetIcon, interactive: false }).addTo(map);
      } else {
        targetMarkerRef.current.setLatLng([targetLat, targetLon]);
        targetMarkerRef.current.setIcon(targetIcon);
      }
    } else {
      if (targetMarkerRef.current) {
        targetMarkerRef.current.remove();
        targetMarkerRef.current = null;
      }
    }

    // --- Marker B: Ground Station Base (Fixed Reference) ---
    const gsHtml = `
      <div style="transform: translate(-50%, -50%); display: flex; flex-direction: column; align-items: center; pointer-events: none;">
        <div style="background: rgba(14, 20, 27, 0.9); border: 1px solid #388BFD; color: #388BFD; font-family: monospace; font-size: 9px; font-weight: 600; padding: 1px 4px; border-radius: 2px; white-space: nowrap;">
          GS BASE
        </div>
        <div style="width: 8px; height: 8px; background: #388BFD; border: 1px solid #FFF; transform: rotate(45deg); margin-top: 2px;"></div>
      </div>
    `;
    const gsIcon = L.divIcon({
      html: gsHtml,
      className: 'gs-marker-icon',
      iconSize: [0, 0],
    });

    if (!gsMarkerRef.current) {
      gsMarkerRef.current = L.marker([gsLat, gsLon], { icon: gsIcon, interactive: false }).addTo(map);
    } else {
      gsMarkerRef.current.setLatLng([gsLat, gsLon]);
    }

    // --- Marker C: Live/Simulated CanSat Position ---
    if (canSatLat !== null && canSatLon !== null) {
      const altStr = typeof alt === 'number' ? `${alt.toFixed(0)}m` : '--';
      const canSatHtml = `
        <div style="transform: translate(-50%, -100%); display: flex; flex-direction: column; align-items: center; cursor: pointer;">
          <div style="background: #E5A93C; color: #0E141B; font-family: monospace; font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 2px; border: 1px solid #0E141B; white-space: nowrap; box-shadow: 0 2px 8px rgba(0,0,0,0.7); display: flex; align-items: center; gap: 4px;">
            <span>CANSAT</span>
            <span style="opacity: 0.85;">(${altStr})</span>
          </div>
          <div style="width: 10px; height: 10px; background: #E5A93C; border: 2px solid #0E141B; border-radius: 50%; box-shadow: 0 0 0 2px #E5A93C; margin-top: 1px;"></div>
        </div>
      `;
      const canSatIcon = L.divIcon({
        html: canSatHtml,
        className: 'cansat-marker-icon',
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      });

      if (!canSatMarkerRef.current) {
        canSatMarkerRef.current = L.marker([canSatLat, canSatLon], { icon: canSatIcon, zIndexOffset: 1000 }).addTo(map);
      } else {
        canSatMarkerRef.current.setLatLng([canSatLat, canSatLon]);
        canSatMarkerRef.current.setIcon(canSatIcon);
      }

      // Auto-follow vehicle
      if (followVehicle) {
        map.panTo([canSatLat, canSatLon], { animate: true, duration: 0.25 });
      }

      // Range Vector to Landing Target (only if target is configured)
      if (targetLat !== null && targetLon !== null) {
        const vectorCoords: [number, number][] = [
          [canSatLat, canSatLon],
          [targetLat, targetLon],
        ];
        if (!targetVectorRef.current) {
          targetVectorRef.current = L.polyline(vectorCoords, {
            color: '#28C76F',
            weight: 1.5,
            dashArray: '4, 4',
            opacity: 0.7,
          }).addTo(map);
        } else {
          targetVectorRef.current.setLatLngs(vectorCoords);
        }
      } else if (targetVectorRef.current) {
        targetVectorRef.current.remove();
        targetVectorRef.current = null;
      }
    } else {
      // Remove marker if position became unavailable
      if (canSatMarkerRef.current) {
        canSatMarkerRef.current.remove();
        canSatMarkerRef.current = null;
      }
      if (targetVectorRef.current) {
        targetVectorRef.current.remove();
        targetVectorRef.current = null;
      }
    }

    // --- Trail: Historical GPS Breadcrumbs ---
    const validHistory: [number, number][] = historyPackets
      .filter((p) => typeof p.latitude === 'number' && typeof p.longitude === 'number' && !isNaN(p.latitude) && !isNaN(p.longitude))
      .map((p) => [p.latitude, p.longitude]);

    if (validHistory.length > 1) {
      if (!polylineRef.current) {
        polylineRef.current = L.polyline(validHistory, {
          color: '#E5A93C',
          weight: 2,
          opacity: 0.8,
          dashArray: '3, 4',
        }).addTo(map);
      } else {
        polylineRef.current.setLatLngs(validHistory);
      }
    }
  }, [canSatLat, canSatLon, alt, targetLat, targetLon, gsLat, gsLon, historyPackets, followVehicle]);

  // Handle manual target coordinate submission
  const handleTargetSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsedLat = parseFloat(inputTargetLat);
    const parsedLon = parseFloat(inputTargetLon);

    if (isNaN(parsedLat) || isNaN(parsedLon)) {
      setGeoError('Enter valid decimal degrees (numbers only).');
      return;
    }

    if (parsedLat < -90 || parsedLat > 90) {
      setGeoError('Latitude must be between -90.0° and +90.0°.');
      return;
    }

    if (parsedLon < -180 || parsedLon > 180) {
      setGeoError('Longitude must be between -180.0° and +180.0°.');
      return;
    }

    setGeoError(null);
    setTargetLat(parsedLat);
    setTargetLon(parsedLon);
    setShowTargetModal(false);

    if (mapRef.current) {
      mapRef.current.flyTo([parsedLat, parsedLon], 16, { duration: 0.8 });
    }
  };

  return (
    <div className="bg-[var(--bg-surface-1)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] flex flex-col h-full select-none overflow-hidden relative">
      {/* Top HUD Header Bar */}
      <div className="p-2 sm:p-2.5 bg-[var(--bg-surface-1)] border-b border-[var(--border-subtle)] flex justify-between items-center z-10 shrink-0">
        <div className="flex items-center gap-2">
          <MapPin className="w-3.5 h-3.5 text-[var(--status-info)]" />
          <span className="font-mono-data text-xs font-bold text-[var(--text-primary)] uppercase tracking-tight">
            GPS RECOVERY & TARGET TRACKING
          </span>
          {/* Transparent Simulation Source Indicator */}
          <span className="hidden sm:inline-block font-mono-data text-[9px] px-1.5 py-0.2 bg-[var(--bg-surface-2)] text-[var(--status-info)] border border-[var(--border-subtle)] rounded-[var(--radius-xs)]">
            SIMULATED NEO-M9N
          </span>
        </div>

        <div className="flex items-center gap-2 font-mono-data text-[10px]">
          {/* GNSS Fix Badge */}
          <span
            className={`px-1.5 py-0.5 border flex items-center gap-1 rounded-[var(--radius-xs)] ${
              fixType === '3D'
                ? 'text-[var(--status-nominal)] bg-[var(--status-nominal-bg)] border-[var(--status-nominal)]/40 font-semibold'
                : fixType === '2D'
                ? 'text-[var(--status-warning)] bg-[var(--status-warning-bg)] border-[var(--status-warning)]/40'
                : 'text-[var(--status-alert)] bg-[var(--status-alert-bg)] border-[var(--status-alert)]/40'
            }`}
          >
            <Satellite className="w-3 h-3" />
            {fixType} ({sats} SATS)
          </span>

          {/* Map Layer Switcher */}
          <div className="hidden md:flex items-center bg-[var(--bg-surface-2)] border border-[var(--border-subtle)] rounded-[var(--radius-xs)] overflow-hidden">
            <button
              type="button"
              onClick={() => setMapType('osm')}
              title="OpenStreetMap Standard Street Layer (Default)"
              className={`px-2 py-0.5 text-[9px] cursor-pointer transition-colors ${
                mapType === 'osm'
                  ? 'bg-[var(--bg-surface-elevated)] text-[var(--action-amber)] font-bold border-r border-[var(--border-subtle)]'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] border-r border-[var(--border-subtle)]'
              }`}
            >
              STREET (OSM)
            </button>
            <button
              type="button"
              onClick={() => setMapType('satellite')}
              title="Esri World Imagery Satellite Layer"
              className={`px-2 py-0.5 text-[9px] cursor-pointer transition-colors ${
                mapType === 'satellite'
                  ? 'bg-[var(--bg-surface-elevated)] text-[var(--action-amber)] font-bold border-r border-[var(--border-subtle)]'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] border-r border-[var(--border-subtle)]'
              }`}
            >
              SATELLITE
            </button>
            {hasCartoKey ? (
              <button
                type="button"
                onClick={() => setMapType('dark')}
                title="CARTO Dark Matter Basemap"
                className={`px-2 py-0.5 text-[9px] cursor-pointer transition-colors ${
                  mapType === 'dark'
                    ? 'bg-[var(--bg-surface-elevated)] text-[var(--action-amber)] font-bold'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                DARK
              </button>
            ) : (
              <button
                type="button"
                disabled
                title="CARTO Dark Basemap requires VITE_CARTO_API_KEY in environment and is not configured."
                className="px-2 py-0.5 text-[9px] text-[var(--text-tertiary)] opacity-60 cursor-not-allowed bg-[var(--bg-surface-1)] flex items-center gap-1"
              >
                <span>DARK</span>
                <span className="text-[8px] px-1 py-0.2 bg-[var(--bg-surface-2)] text-[var(--status-alert)] border border-[var(--border-subtle)] rounded-[var(--radius-xs)]">
                  NO KEY
                </span>
              </button>
            )}
          </div>

          {/* Target Coordinates Configuration Button */}
          <button
            onClick={() => {
              setInputTargetLat(targetLat !== null ? targetLat.toFixed(6) : '');
              setInputTargetLon(targetLon !== null ? targetLon.toFixed(6) : '');
              setShowTargetModal(true);
            }}
            title="Configure Target Landing Coordinates"
            className={`px-2 py-0.5 border cursor-pointer flex items-center gap-1 rounded-[var(--radius-xs)] font-medium transition-colors ${
              targetLat !== null
                ? 'bg-[var(--bg-surface-2)] text-[var(--status-nominal)] border-[var(--status-nominal)]/40 hover:text-[var(--text-primary)]'
                : 'bg-[var(--bg-surface-2)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:text-[var(--text-primary)]'
            }`}
          >
            <Target className="w-3 h-3 text-[var(--status-nominal)]" />
            <span className="hidden sm:inline">{targetLat !== null ? 'TARGET SET' : 'SET TARGET'}</span>
          </button>

          {/* Follow CanSat Toggle */}
          <button
            onClick={() => setFollowVehicle(!followVehicle)}
            title={followVehicle ? 'Recenter Locked: Auto-following CanSat' : 'Click to Lock Recenter on CanSat'}
            className={`p-1 border cursor-pointer rounded-[var(--radius-xs)] transition-colors ${
              followVehicle
                ? 'bg-[var(--bg-surface-elevated)] text-[var(--action-amber)] border-[var(--border-amber)]'
                : 'bg-[var(--bg-surface-2)] text-[var(--text-tertiary)] border-[var(--border-subtle)]'
            }`}
          >
            <Crosshair className="w-3.5 h-3.5" />
          </button>

          {/* Zoom In / Out Controls */}
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => mapRef.current?.zoomIn()}
              title="Zoom In"
              className="p-1 bg-[var(--bg-surface-2)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border-subtle)] cursor-pointer rounded-[var(--radius-xs)]"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => mapRef.current?.zoomOut()}
              title="Zoom Out"
              className="p-1 bg-[var(--bg-surface-2)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border-subtle)] cursor-pointer rounded-[var(--radius-xs)]"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Geolocation / Target Validation Alert */}
      {geoError && (
        <div className="bg-[var(--status-alert-bg)] border-b border-[var(--status-alert)] text-[var(--status-alert)] px-3 py-1 font-mono-data text-[10px] flex items-center justify-between z-10">
          <div className="flex items-center gap-1.5">
            <ShieldAlert className="w-3.5 h-3.5 text-[var(--status-alert)]" />
            <span>{geoError}</span>
          </div>
          <button onClick={() => setGeoError(null)} className="underline cursor-pointer">
            Dismiss
          </button>
        </div>
      )}

      {/* Main Map Viewport */}
      <div className="flex-1 relative bg-[var(--bg-base)] overflow-hidden min-h-[240px]">
        <div ref={mapContainerRef} className="absolute inset-0 w-full h-full z-0" />

        {/* Tactical HUD Overlay - Top-Left: CanSat Live Coordinates */}
        <div className="absolute top-2 left-2 bg-[var(--bg-surface-1)]/95 border border-[var(--border-subtle)] px-2.5 py-1.5 font-mono-data text-[10px] text-[var(--text-secondary)] flex flex-col gap-0.5 shadow-lg backdrop-blur-sm z-10 pointer-events-none rounded-[var(--radius-xs)]">
          <div className="flex gap-2 items-center">
            <span className="text-[var(--text-tertiary)]">CANSAT POS:</span>
            <span className={`font-bold tabular-nums ${isGpsValid ? 'text-[var(--action-amber)]' : 'text-[var(--status-alert)]'}`}>
              {formatCoordinates(canSatLat, canSatLon)}
            </span>
          </div>
          <div className="flex gap-2 items-center">
            <span className="text-[var(--text-tertiary)]">ALTITUDE:</span>
            <span className="text-[var(--text-primary)] font-bold tabular-nums">
              {typeof alt === 'number' ? `${alt.toFixed(1)} m AGL` : 'UNAVAILABLE'}
            </span>
          </div>
          <div className="flex gap-2 items-center text-[9px] text-[var(--text-tertiary)] pt-0.5 border-t border-[var(--border-subtle)]">
            <span>TRAIL POINTS:</span>
            <span className="text-[var(--text-secondary)] tabular-nums">{historyPackets.length}</span>
          </div>
        </div>

        {/* Tactical HUD Overlay - Top-Right: Target Guidance or Unset Indicator */}
        <div className="absolute top-2 right-2 bg-[var(--bg-surface-1)]/95 border border-[var(--border-subtle)] px-2.5 py-1.5 font-mono-data text-[10px] text-[var(--text-secondary)] flex flex-col gap-0.5 shadow-lg backdrop-blur-sm z-10 pointer-events-none rounded-[var(--radius-xs)]">
          {targetLat !== null && targetLon !== null ? (
            <>
              <div className="flex gap-2 items-center">
                <Navigation className="w-3 h-3 text-[var(--status-nominal)]" />
                <span className="text-[var(--text-tertiary)]">RANGE TO TARGET:</span>
                <span className="text-[var(--status-nominal)] font-bold tabular-nums">
                  {distanceToTargetMeters !== null
                    ? distanceToTargetMeters < 1000
                      ? `${distanceToTargetMeters.toFixed(1)} m`
                      : `${(distanceToTargetMeters / 1000).toFixed(2)} km`
                    : 'AWAITING GPS'}
                </span>
              </div>
              <div className="flex gap-2 items-center">
                <Compass className="w-3 h-3 text-[var(--text-secondary)]" />
                <span className="text-[var(--text-tertiary)]">BEARING TO TARGET:</span>
                <span className="text-[var(--text-primary)] font-bold tabular-nums">
                  {bearingToTargetDeg !== null ? `${bearingToTargetDeg.toFixed(1)}°` : 'AWAITING GPS'}
                </span>
              </div>
            </>
          ) : (
            <div className="flex flex-col gap-0.5">
              <div className="flex gap-2 items-center">
                <Target className="w-3 h-3 text-[var(--text-tertiary)]" />
                <span className="text-[var(--text-tertiary)]">TARGET STATUS:</span>
                <span className="text-[var(--text-secondary)] font-bold">TARGET NOT SET</span>
              </div>
              <span className="text-[9px] text-[var(--text-tertiary)] opacity-80">
                Click map or use SET TARGET to assign
              </span>
            </div>
          )}
        </div>

        {/* Tactical HUD Overlay - Bottom-Left: Target Coordinates Badge */}
        <div className="absolute bottom-6 left-2 bg-[var(--bg-surface-1)]/90 border border-[var(--border-subtle)] px-2 py-1 font-mono-data text-[10px] flex items-center gap-1.5 shadow-lg backdrop-blur-sm z-10 rounded-[var(--radius-xs)]">
          <Target className={`w-3 h-3 ${targetLat !== null ? 'text-[var(--status-nominal)]' : 'text-[var(--text-tertiary)]'}`} />
          {targetLat !== null && targetLon !== null ? (
            <span className="text-[var(--status-nominal)]">TARGET: {formatCoordinates(targetLat, targetLon)}</span>
          ) : (
            <span className="text-[var(--text-tertiary)]">TARGET: <strong className="font-semibold text-[var(--text-secondary)]">TARGET NOT SET</strong></span>
          )}
        </div>

        {/* Tactical HUD Overlay - Bottom-Right: Ground Station Reference */}
        <div className="absolute bottom-6 right-2 bg-[var(--bg-surface-1)]/90 border border-[var(--border-subtle)] px-2 py-1 font-mono-data text-[10px] text-[var(--status-info)] flex items-center gap-1.5 shadow-lg backdrop-blur-sm z-10 pointer-events-none rounded-[var(--radius-xs)]">
          <Radio className="w-3 h-3 text-[var(--status-info)]" />
          <span>GS BASE: {formatCoordinates(gsLat, gsLon)}</span>
          {distanceToGsMeters !== null && (
            <span className="text-[var(--text-secondary)] tabular-nums">
              ({distanceToGsMeters < 1000 ? `${distanceToGsMeters.toFixed(0)}m` : `${(distanceToGsMeters / 1000).toFixed(2)}km`})
            </span>
          )}
        </div>
      </div>

      {/* Target Landing Coordinate Configuration Modal */}
      {showTargetModal && (
        <div className="fixed inset-0 bg-[#000000]/70 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-[var(--bg-surface-1)] border border-[var(--border-focus)] max-w-sm w-full p-4 font-mono-data text-xs text-[var(--text-primary)] shadow-2xl space-y-3 rounded-[var(--radius-md)]">
            <div className="flex justify-between items-center border-b border-[var(--border-subtle)] pb-2">
              <span className="font-bold text-[var(--text-primary)] uppercase tracking-tight flex items-center gap-1.5">
                <Target className="w-4 h-4 text-[var(--status-nominal)]" />
                Configure Landing Target
              </span>
              <button
                onClick={() => setShowTargetModal(false)}
                className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-[var(--text-secondary)] text-[11px] leading-relaxed">
              Enter target landing coordinates in decimal degrees, or click anywhere directly on the map surface to place the target marker:
            </p>

            <form onSubmit={handleTargetSubmit} className="space-y-3">
              <div>
                <label className="block text-[var(--text-secondary)] text-[10px] mb-1">
                  TARGET LATITUDE (-90.0° to +90.0°)
                </label>
                <input
                  type="text"
                  value={inputTargetLat}
                  onChange={(e) => setInputTargetLat(e.target.value)}
                  placeholder="e.g. 13.35250"
                  className="w-full bg-[var(--bg-base)] border border-[var(--border-subtle)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] font-mono-data tabular-nums focus:outline-none focus:border-[var(--status-nominal)] rounded-[var(--radius-xs)]"
                />
              </div>

              <div>
                <label className="block text-[var(--text-secondary)] text-[10px] mb-1">
                  TARGET LONGITUDE (-180.0° to +180.0°)
                </label>
                <input
                  type="text"
                  value={inputTargetLon}
                  onChange={(e) => setInputTargetLon(e.target.value)}
                  placeholder="e.g. 74.79280"
                  className="w-full bg-[var(--bg-base)] border border-[var(--border-subtle)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] font-mono-data tabular-nums focus:outline-none focus:border-[var(--status-nominal)] rounded-[var(--radius-xs)]"
                />
              </div>

              <div className="flex justify-between items-center pt-2">
                <div className="flex items-center gap-2">
                  {targetLat !== null && (
                    <button
                      type="button"
                      onClick={() => {
                        setTargetLat(null);
                        setTargetLon(null);
                        setInputTargetLat('');
                        setInputTargetLon('');
                        setShowTargetModal(false);
                      }}
                      className="text-[10px] text-[var(--status-alert)] hover:underline cursor-pointer"
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
                    className="text-[10px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] underline cursor-pointer"
                  >
                    Fill GS Base
                  </button>
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setShowTargetModal(false)}
                    className="bg-[var(--bg-surface-2)] text-[var(--text-secondary)] px-3 py-1 text-xs cursor-pointer hover:text-[var(--text-primary)] rounded-[var(--radius-xs)]"
                  >
                    CANCEL
                  </button>
                  <button
                    type="submit"
                    className="bg-[var(--status-nominal)] text-[#001D33] font-bold px-3 py-1 text-xs cursor-pointer hover:opacity-90 flex items-center gap-1 rounded-[var(--radius-xs)]"
                  >
                    <Check className="w-3.5 h-3.5" /> APPLY
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
