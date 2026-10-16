import React, { useState, useEffect, useRef } from 'react';
import L from 'leaflet';
import { MapPin, Navigation, Crosshair, ZoomIn, ZoomOut, Satellite, Target, ArrowDown, Locate, ShieldAlert, Edit3, Check, RefreshCw } from 'lucide-react';
import { TelemetryPacket } from '../types';
import { globalTelemetryEngine } from '../services/telemetrySimulator';

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
  const gsMarkerRef = useRef<L.Marker | null>(null);
  const userMarkerRef = useRef<L.Marker | null>(null);
  const userAccuracyCircleRef = useRef<L.Circle | null>(null);
  const polylineRef = useRef<L.Polyline | null>(null);
  const clickPopupRef = useRef<L.Popup | null>(null);

  const [followVehicle, setFollowVehicle] = useState<boolean>(true);
  const [mapType, setMapType] = useState<'satellite' | 'dark' | 'osm'>('satellite');
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number; accuracy?: number } | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [isLocating, setIsLocating] = useState<boolean>(false);
  const [showCoordModal, setShowCoordModal] = useState<boolean>(false);

  // Editable coordinates state
  const baseGps = globalTelemetryEngine.getBaseGps();
  const [inputLat, setInputLat] = useState<string>(baseGps.latitude.toString());
  const [inputLon, setInputLon] = useState<string>(baseGps.longitude.toString());

  // CanSat Current Coordinates from latest telemetry packet
  const canSatLat = latestPacket?.latitude ?? baseGps.latitude;
  const canSatLon = latestPacket?.longitude ?? baseGps.longitude;
  const alt = latestPacket?.altitude ?? 450.2;
  const sats = latestPacket?.gpsSats ?? 12;

  // Ground Station Coordinates
  const gsLat = baseGps.latitude;
  const gsLon = baseGps.longitude;

  // Tile Layer URLs
  const tileUrls = {
    satellite: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    osm: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  };

  const tileAttributions = {
    satellite: 'Tiles &copy; Esri World Imagery',
    dark: '&copy; OpenStreetMap &copy; CARTO',
    osm: '&copy; OpenStreetMap contributors',
  };

  // 1. Initialize Leaflet Map
  useEffect(() => {
    if (!mapContainerRef.current) return;

    if (!mapRef.current) {
      const initialMap = L.map(mapContainerRef.current, {
        center: [canSatLat, canSatLon],
        zoom: 15,
        zoomControl: false,
        attributionControl: false,
      });

      tileLayerRef.current = L.tileLayer(tileUrls[mapType], {
        maxZoom: 19,
        attribution: tileAttributions[mapType],
      }).addTo(initialMap);

      // Scale control
      L.control.scale({ position: 'bottomleft', imperial: false }).addTo(initialMap);

      // Click on map to drop a launch site marker
      initialMap.on('click', (e: L.LeafletMouseEvent) => {
        const { lat, lng } = e.latlng;
        const popupContent = document.createElement('div');
        popupContent.className = 'font-mono text-xs text-[#E1E2EB] p-1 flex flex-col gap-1.5';
        popupContent.innerHTML = `
          <div class="font-bold text-[#FFD597]">📍 Clicked Coordinates</div>
          <div class="text-[11px] text-[#9F8E78]">Lat: ${lat.toFixed(5)}°<br/>Lon: ${lng.toFixed(5)}°</div>
          <button id="set-gs-btn" class="bg-[#38FA87] text-[#001D33] font-bold px-2 py-1 text-[10px] rounded cursor-pointer hover:bg-[#2DE076]">
            Set Launch Site Here
          </button>
        `;

        if (clickPopupRef.current) {
          initialMap.closePopup(clickPopupRef.current);
        }

        const popup = L.popup()
          .setLatLng([lat, lng])
          .setContent(popupContent)
          .openOn(initialMap);

        clickPopupRef.current = popup;

        setTimeout(() => {
          const btn = document.getElementById('set-gs-btn');
          if (btn) {
            btn.onclick = () => {
              applyNewLocation(lat, lng);
              initialMap.closePopup(popup);
            };
          }
        }, 100);
      });

      mapRef.current = initialMap;

      // Auto-locate user on initial load
      handleLocateUser(false);
    }

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // 2. Change Tile Layer when mapType changes
  useEffect(() => {
    if (!mapRef.current) return;
    if (tileLayerRef.current) {
      mapRef.current.removeLayer(tileLayerRef.current);
    }
    tileLayerRef.current = L.tileLayer(tileUrls[mapType], {
      maxZoom: 19,
      attribution: tileAttributions[mapType],
    }).addTo(mapRef.current);
  }, [mapType]);

  // 3. Create/Update Markers & Polyline
  useEffect(() => {
    if (!mapRef.current) return;
    const map = mapRef.current;

    // Custom DivIcon for CanSat
    const canSatHtml = `
      <div class="relative flex flex-col items-center cursor-pointer">
        <div class="bg-[#FFB000] text-[#000] font-mono font-bold text-[10px] px-1.5 py-0.5 rounded shadow-lg border border-[#FFF] flex items-center gap-1 whitespace-nowrap animate-bounce">
          <svg class="w-3 h-3 text-[#000]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 14l-7 7m0 0l-7-7m7 7V3"></path></svg>
          CANSAT (${alt.toFixed(0)}m)
        </div>
        <div class="w-3.5 h-3.5 bg-[#FFD597] border-2 border-[#000] rounded-full shadow-lg"></div>
      </div>
    `;

    const canSatIcon = L.divIcon({
      html: canSatHtml,
      className: 'cansat-leaflet-pin',
      iconSize: [120, 40],
      iconAnchor: [60, 40],
    });

    if (!canSatMarkerRef.current) {
      canSatMarkerRef.current = L.marker([canSatLat, canSatLon], { icon: canSatIcon }).addTo(map);
    } else {
      canSatMarkerRef.current.setLatLng([canSatLat, canSatLon]);
      canSatMarkerRef.current.setIcon(canSatIcon);
    }

    // Ground Station Pin
    const gsHtml = `
      <div class="bg-[#10131A] text-[#38FA87] border border-[#38FA87] px-1.5 py-0.5 rounded text-[10px] font-mono font-bold shadow-lg flex items-center gap-1 whitespace-nowrap">
        🎯 GS BASE
      </div>
    `;
    const gsIcon = L.divIcon({
      html: gsHtml,
      className: 'gs-leaflet-pin',
      iconSize: [80, 24],
      iconAnchor: [40, 12],
    });

    if (!gsMarkerRef.current) {
      gsMarkerRef.current = L.marker([gsLat, gsLon], { icon: gsIcon }).addTo(map);
    } else {
      gsMarkerRef.current.setLatLng([gsLat, gsLon]);
    }

    // Flight Path Polyline
    const latLngs: [number, number][] =
      historyPackets.length > 0
        ? historyPackets.map((p) => [p.latitude, p.longitude])
        : [[gsLat, gsLon], [canSatLat, canSatLon]];

    if (!polylineRef.current) {
      polylineRef.current = L.polyline(latLngs, {
        color: '#FFD597',
        weight: 3,
        opacity: 0.85,
        dashArray: '6, 6',
      }).addTo(map);
    } else {
      polylineRef.current.setLatLngs(latLngs);
    }

    // Auto Follow
    if (followVehicle) {
      map.panTo([canSatLat, canSatLon], { animate: true, duration: 0.5 });
    }
  }, [canSatLat, canSatLon, alt, historyPackets, followVehicle, gsLat, gsLon]);

  // Apply new GPS origin to Telemetry Engine & Map
  const applyNewLocation = (lat: number, lon: number) => {
    globalTelemetryEngine.setBaseGps(lat, lon);
    setInputLat(lat.toString());
    setInputLon(lon.toString());

    if (mapRef.current) {
      mapRef.current.flyTo([lat, lon], 16, { duration: 1.2 });
    }

    if (onSetCustomGroundStation) {
      onSetCustomGroundStation(lat, lon);
    }
  };

  // Geolocation Handler
  const handleLocateUser = (panImmediately: boolean = true) => {
    if (!navigator.geolocation) {
      setGeoError('Geolocation is not supported by your browser.');
      return;
    }

    setIsLocating(true);
    setGeoError(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setIsLocating(false);
        const { latitude, longitude, accuracy } = position.coords;
        const uLoc = { lat: latitude, lng: longitude, accuracy };
        setUserLocation(uLoc);

        // Instantly move telemetry generator base location to user's real coordinates!
        applyNewLocation(latitude, longitude);

        if (mapRef.current) {
          const map = mapRef.current;
          if (panImmediately) {
            map.flyTo([latitude, longitude], 16, { duration: 1.2 });
          }

          // User Icon
          const userHtml = `
            <div class="relative flex items-center justify-center">
              <div class="absolute w-8 h-8 bg-[#00A2FD] opacity-30 rounded-full animate-ping"></div>
              <div class="w-4 h-4 bg-[#00A2FD] border-2 border-[#FFFFFF] rounded-full shadow-xl"></div>
            </div>
          `;
          const userIcon = L.divIcon({
            html: userHtml,
            className: 'user-location-pin',
            iconSize: [32, 32],
            iconAnchor: [16, 16],
          });

          if (!userMarkerRef.current) {
            userMarkerRef.current = L.marker([latitude, longitude], { icon: userIcon })
              .bindPopup(`<b>Your Actual GPS Location</b><br/>Lat: ${latitude.toFixed(5)}, Lon: ${longitude.toFixed(5)}<br/>Accuracy: ~${accuracy.toFixed(0)}m`)
              .addTo(map);
          } else {
            userMarkerRef.current.setLatLng([latitude, longitude]);
          }

          if (accuracy) {
            if (!userAccuracyCircleRef.current) {
              userAccuracyCircleRef.current = L.circle([latitude, longitude], {
                radius: accuracy,
                color: '#00A2FD',
                fillColor: '#00A2FD',
                fillOpacity: 0.15,
                weight: 1,
              }).addTo(map);
            } else {
              userAccuracyCircleRef.current.setLatLng([latitude, longitude]);
              userAccuracyCircleRef.current.setRadius(accuracy);
            }
          }
        }
      },
      (err) => {
        setIsLocating(false);
        console.warn('Geolocation error:', err);
        setGeoError('GPS permission or location check failed. You can manually enter or click on the map to set your location.');
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      }
    );
  };

  // Distance calculation (Haversine)
  const calculateDistanceKm = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  const distanceToGS = calculateDistanceKm(canSatLat, canSatLon, gsLat, gsLon);

  const handleManualCoordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsedLat = parseFloat(inputLat);
    const parsedLon = parseFloat(inputLon);

    if (isNaN(parsedLat) || isNaN(parsedLon)) {
      setGeoError('Please enter valid numeric latitude and longitude.');
      return;
    }

    if (parsedLat < -90 || parsedLat > 90 || parsedLon < -180 || parsedLon > 180) {
      setGeoError('Latitude must be between -90 and 90, Longitude between -180 and 180.');
      return;
    }

    setGeoError(null);
    applyNewLocation(parsedLat, parsedLon);
    setShowCoordModal(false);
  };

  return (
    <div className="telemetry-panel panel-blue-accent flex flex-col h-full select-none overflow-hidden group relative">
      {/* Header Bar */}
      <div className="p-2 sm:p-2.5 bg-[#10131A] border-b border-[#272A31] flex justify-between items-center z-10 shrink-0">
        <div className="flex items-center gap-2">
          <MapPin className="w-3.5 h-3.5 text-[#00A2FD]" />
          <span className="font-mono-data text-xs font-bold text-[#D7C4AC] uppercase tracking-wider">
            GPS TRACKING (LEAFLET MAP)
          </span>
        </div>

        <div className="flex items-center gap-2 font-mono-data text-[10px]">
          {/* Fix & Satellite Badge */}
          <span className="text-[#38FA87] bg-[#1D2026] px-1.5 py-0.5 border border-[#2A2E35] flex items-center gap-1">
            <Satellite className="w-3 h-3 text-[#38FA87]" />
            3D FIX ({sats} SAT)
          </span>

          {/* Map Layer Selector */}
          <div className="hidden sm:flex items-center bg-[#1D2026] border border-[#2A2E35] rounded-none overflow-hidden">
            <button
              onClick={() => setMapType('satellite')}
              className={`px-1.5 py-0.5 text-[9px] cursor-pointer ${
                mapType === 'satellite' ? 'bg-[#00A2FD] text-[#001D33] font-bold' : 'text-[#9F8E78] hover:text-[#E1E2EB]'
              }`}
            >
              SATELLITE
            </button>
            <button
              onClick={() => setMapType('dark')}
              className={`px-1.5 py-0.5 text-[9px] cursor-pointer ${
                mapType === 'dark' ? 'bg-[#00A2FD] text-[#001D33] font-bold' : 'text-[#9F8E78] hover:text-[#E1E2EB]'
              }`}
            >
              DARK
            </button>
            <button
              onClick={() => setMapType('osm')}
              className={`px-1.5 py-0.5 text-[9px] cursor-pointer ${
                mapType === 'osm' ? 'bg-[#00A2FD] text-[#001D33] font-bold' : 'text-[#9F8E78] hover:text-[#E1E2EB]'
              }`}
            >
              STREET
            </button>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-1">
            {/* Locate My Location Button */}
            <button
              onClick={() => handleLocateUser(true)}
              disabled={isLocating}
              title="Detect & Set My GPS Location"
              className={`px-2 py-0.5 border cursor-pointer font-bold flex items-center gap-1 transition-colors ${
                userLocation
                  ? 'bg-[#00A2FD] text-[#001D33] border-[#00A2FD]'
                  : 'bg-[#1D2026] text-[#38FA87] hover:bg-[#272A31] border-[#38FA87]/60'
              }`}
            >
              <Locate className={`w-3 h-3 ${isLocating ? 'animate-spin' : ''}`} />
              <span className="hidden md:inline">{isLocating ? 'LOCATING...' : 'MY LOCATION'}</span>
            </button>

            {/* Edit Coordinates Button */}
            <button
              onClick={() => setShowCoordModal(true)}
              title="Set Custom Latitude/Longitude"
              className="p-1 bg-[#1D2026] text-[#FFD597] hover:text-[#FFF] border border-[#FFD597]/40 cursor-pointer flex items-center gap-1"
            >
              <Edit3 className="w-3.5 h-3.5" />
            </button>

            {/* Follow Vehicle Button */}
            <button
              onClick={() => setFollowVehicle(!followVehicle)}
              title="Lock / Recenter on CanSat"
              className={`p-1 border cursor-pointer ${
                followVehicle
                  ? 'bg-[#FFD597] text-[#000] border-[#FFD597] font-bold'
                  : 'bg-[#1D2026] text-[#9F8E78] border-[#2A2E35]'
              }`}
            >
              <Crosshair className="w-3.5 h-3.5" />
            </button>

            {/* Zoom Controls */}
            <button
              onClick={() => mapRef.current?.zoomIn()}
              title="Zoom In"
              className="p-1 bg-[#1D2026] text-[#9F8E78] hover:text-[#E1E2EB] border border-[#2A2E35] cursor-pointer"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => mapRef.current?.zoomOut()}
              title="Zoom Out"
              className="p-1 bg-[#1D2026] text-[#9F8E78] hover:text-[#E1E2EB] border border-[#2A2E35] cursor-pointer"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Geolocation Alert or Error Bar */}
      {geoError && (
        <div className="bg-[#FFB4AB]/10 border-b border-[#FFB4AB] text-[#FFB4AB] px-3 py-1 font-mono-data text-[10px] flex items-center justify-between z-10">
          <div className="flex items-center gap-1.5">
            <ShieldAlert className="w-3.5 h-3.5 text-[#FFB4AB]" />
            <span>{geoError}</span>
          </div>
          <button onClick={() => setGeoError(null)} className="text-[#FFB4AB] underline cursor-pointer">
            Dismiss
          </button>
        </div>
      )}

      {/* Main Leaflet Map Viewport Container */}
      <div className="flex-1 relative bg-[#0B0E14] overflow-hidden min-h-[240px]">
        <div ref={mapContainerRef} className="absolute inset-0 w-full h-full z-0" />

        {/* Live Telemetry Overlay Card */}
        <div className="absolute top-2 left-2 bg-[#10131A]/90 border border-[#2A2E35] px-2.5 py-1.5 font-mono-data text-[10px] text-[#D7C4AC] flex flex-col gap-0.5 shadow-xl backdrop-blur-sm z-10 pointer-events-none">
          <div className="flex gap-2 items-center">
            <span className="text-[#9F8E78]">CANSAT LAT:</span>
            <span className="text-[#E1E2EB] font-bold">{canSatLat.toFixed(5)}° N</span>
          </div>
          <div className="flex gap-2 items-center">
            <span className="text-[#9F8E78]">CANSAT LON:</span>
            <span className="text-[#E1E2EB] font-bold">{canSatLon.toFixed(5)}° W</span>
          </div>
          <div className="flex gap-2 items-center">
            <span className="text-[#9F8E78]">ALTITUDE:</span>
            <span className="text-[#FFD597] font-bold">{alt.toFixed(1)} m</span>
          </div>
        </div>

        {/* Ground Station Base Coordinate Badge */}
        <div className="absolute bottom-2 left-2 bg-[#10131A]/90 border border-[#38FA87] px-2.5 py-1 font-mono-data text-[10px] text-[#38FA87] flex items-center gap-1.5 shadow-xl backdrop-blur-sm z-10">
          <Target className="w-3 h-3 text-[#38FA87]" />
          <span>GS BASE: {gsLat.toFixed(4)}°, {gsLon.toFixed(4)}°</span>
        </div>

        {/* Ground Station Distance Badge */}
        <div className="absolute bottom-2 right-2 bg-[#10131A]/90 border border-[#2A2E35] px-2.5 py-1 font-mono-data text-[10px] text-[#98CBFF] flex items-center gap-1.5 shadow-xl backdrop-blur-sm z-10 pointer-events-none">
          <Navigation className="w-3 h-3 text-[#00A2FD]" />
          <span>RANGE TO GS: {distanceToGS.toFixed(2)} km</span>
        </div>
      </div>

      {/* Manual Coordinate Entry Modal */}
      {showCoordModal && (
        <div className="fixed inset-0 bg-[#0B0E14]/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-[#10131A] border border-[#2A2E35] max-w-sm w-full p-4 font-mono-data text-xs text-[#E1E2EB] shadow-2xl space-y-3">
            <div className="flex justify-between items-center border-b border-[#272A31] pb-2">
              <span className="font-bold text-[#FFD597] uppercase tracking-wider flex items-center gap-2">
                <Edit3 className="w-4 h-4 text-[#FFD597]" />
                Set Custom Launch Coordinates
              </span>
              <button
                onClick={() => setShowCoordModal(false)}
                className="text-[#9F8E78] hover:text-[#E1E2EB] cursor-pointer"
              >
                ✕
              </button>
            </div>

            <p className="text-[#D7C4AC] text-[11px] leading-relaxed">
              Enter your exact Latitude and Longitude to center the Ground Station and CanSat descent trajectory anywhere on Earth:
            </p>

            <form onSubmit={handleManualCoordSubmit} className="space-y-3">
              <div>
                <label className="block text-[#9F8E78] text-[10px] mb-1">LATITUDE (Degrees North/South)</label>
                <input
                  type="text"
                  value={inputLat}
                  onChange={(e) => setInputLat(e.target.value)}
                  placeholder="e.g. 37.7749 or 12.9716"
                  className="w-full bg-[#0B0E14] border border-[#2A2E35] px-2.5 py-1.5 text-xs text-[#E1E2EB] focus:outline-none focus:border-[#00A2FD]"
                />
              </div>

              <div>
                <label className="block text-[#9F8E78] text-[10px] mb-1">LONGITUDE (Degrees East/West)</label>
                <input
                  type="text"
                  value={inputLon}
                  onChange={(e) => setInputLon(e.target.value)}
                  placeholder="e.g. -122.4194 or 77.5946"
                  className="w-full bg-[#0B0E14] border border-[#2A2E35] px-2.5 py-1.5 text-xs text-[#E1E2EB] focus:outline-none focus:border-[#00A2FD]"
                />
              </div>

              <div className="flex justify-between items-center pt-2">
                <button
                  type="button"
                  onClick={() => handleLocateUser(true)}
                  className="bg-[#1D2026] text-[#38FA87] border border-[#38FA87]/40 px-2.5 py-1 text-[11px] font-bold cursor-pointer hover:bg-[#272A31] flex items-center gap-1"
                >
                  <Locate className="w-3 h-3" /> Use GPS
                </button>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setShowCoordModal(false)}
                    className="bg-[#1D2026] text-[#9F8E78] px-3 py-1 text-xs cursor-pointer hover:text-[#E1E2EB]"
                  >
                    CANCEL
                  </button>
                  <button
                    type="submit"
                    className="bg-[#38FA87] text-[#001D33] font-bold px-3 py-1 text-xs cursor-pointer hover:bg-[#2DE076] flex items-center gap-1"
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
