import React, { useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Battery,
  Check,
  CheckCircle2,
  Compass,
  Copy,
  Crosshair,
  Gauge,
  MapPin,
  Navigation,
  Pause,
  Play,
  Radio,
  RotateCcw,
  Satellite,
  ShieldAlert,
  Target,
  Thermometer,
  Usb,
  Volume2,
  Wind,
  X,
  Cloud,
} from 'lucide-react';
import {
  FlightStateCode,
  SerialConnectionState,
  SerialMetrics,
  TelemetryPacket,
  TelemetrySource,
} from '../types';
import { BASE_GPS, BAUD_RATES, FLIGHT_STATES } from '../constants';
import { OptionalTelemetrySettings } from '../services/optionalTelemetrySettings';
import {
  PredictionResponsePayload,
  parseAndValidateTargetCoordinates,
} from '../services/landingPredictorClient';
import { isPacketGpsValid } from '../services/offlineMapService';
import { describeWebSerialSupport } from '../services/serialTelemetry';

export interface MobileFieldOpsDeckProps {
  latestPacket: TelemetryPacket | null;
  historyPackets: TelemetryPacket[];
  telemetrySource: TelemetrySource;
  onSelectSource: (source: TelemetrySource) => void;
  serialState: SerialConnectionState;
  serialMetrics: SerialMetrics;
  liveBaudRate: number;
  onChangeBaudRate: (baud: number) => void;
  onConnectSerial: () => void;
  onDisconnectSerial: () => void;
  isStale: boolean;
  packetAgeSeconds: number | null;
  // Simulator controls
  isSimulating: boolean;
  onToggleSimulation: () => void;
  onResetSimulation: () => void;
  onCalibrateSensors: () => void;
  onInjectDisturbance: () => void;
  onForceState: (state: FlightStateCode | null) => void;
  // GPS Target & Predictor
  targetLat: number | null;
  targetLon: number | null;
  onUpdateTarget: (lat: number | null, lon: number | null) => void;
  landingPrediction: PredictionResponsePayload | null;
  onOpenLandingPredictor: () => void;
  optionalTelemetrySettings: OptionalTelemetrySettings;
  onOpenSyncModal?: () => void;
}

function computeRangeAndBearing(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): { distanceMeters: number; bearingDeg: number } {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const toDeg = (rad: number) => (rad * 180) / Math.PI;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distanceMeters = R * c;
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  const bearingDeg = (toDeg(Math.atan2(y, x)) + 360) % 360;
  return { distanceMeters, bearingDeg };
}

export const MobileFieldOpsDeck: React.FC<MobileFieldOpsDeckProps> = ({
  latestPacket,
  historyPackets,
  telemetrySource,
  onSelectSource,
  serialState,
  serialMetrics,
  liveBaudRate,
  onChangeBaudRate,
  onConnectSerial,
  onDisconnectSerial,
  isStale,
  packetAgeSeconds,
  isSimulating,
  onToggleSimulation,
  onResetSimulation,
  onCalibrateSensors,
  onInjectDisturbance,
  onForceState,
  targetLat,
  targetLon,
  onUpdateTarget,
  landingPrediction,
  onOpenLandingPredictor,
  optionalTelemetrySettings,
  onOpenSyncModal,
}) => {
  const isSim = telemetrySource === 'SIMULATION';
  const webSerialSupport = useMemo(() => describeWebSerialSupport(), []);

  // Two-step confirmations to prevent accidental activation on touchscreens
  const [confirmSimRestart, setConfirmSimRestart] = useState(false);
  const [confirmDisconnectUsb, setConfirmDisconnectUsb] = useState(false);
  const [calibrationStatus, setCalibrationStatus] = useState<string | null>(null);
  const [copiedGps, setCopiedGps] = useState(false);

  // Target coordinate editor state
  const [editingTarget, setEditingTarget] = useState(false);
  const [inputTargetLat, setInputTargetLat] = useState<string>(
    targetLat !== null ? targetLat.toFixed(6) : BASE_GPS.latitude.toFixed(6)
  );
  const [inputTargetLon, setInputTargetLon] = useState<string>(
    targetLon !== null ? targetLon.toFixed(6) : BASE_GPS.longitude.toFixed(6)
  );
  const [targetValidationError, setTargetValidationError] = useState<string | null>(null);

  // Resolve current vs last-known GPS fix from packet stream
  const currentFixValid = isPacketGpsValid(latestPacket);
  const lastValidGpsPacket = useMemo(() => {
    if (currentFixValid && latestPacket) return latestPacket;
    for (let i = historyPackets.length - 1; i >= 0; i--) {
      const candidate = historyPackets[i];
      if (isPacketGpsValid(candidate)) {
        return candidate;
      }
    }
    return null;
  }, [currentFixValid, latestPacket, historyPackets]);

  const gpsStatusMode: 'CURRENT_FIX' | 'LAST_KNOWN_STALE' | 'NO_FIX' = useMemo(() => {
    if (currentFixValid && !isStale) return 'CURRENT_FIX';
    if (lastValidGpsPacket !== null) return 'LAST_KNOWN_STALE';
    return 'NO_FIX';
  }, [currentFixValid, isStale, lastValidGpsPacket]);

  const activeGpsLat =
    gpsStatusMode === 'CURRENT_FIX'
      ? latestPacket!.latitude
      : gpsStatusMode === 'LAST_KNOWN_STALE'
      ? lastValidGpsPacket!.latitude
      : null;

  const activeGpsLon =
    gpsStatusMode === 'CURRENT_FIX'
      ? latestPacket!.longitude
      : gpsStatusMode === 'LAST_KNOWN_STALE'
      ? lastValidGpsPacket!.longitude
      : null;

  const activeGpsAlt =
    gpsStatusMode === 'CURRENT_FIX'
      ? latestPacket?.gpsAltitude ?? null
      : gpsStatusMode === 'LAST_KNOWN_STALE'
      ? lastValidGpsPacket?.gpsAltitude ?? null
      : null;

  const targetVector = useMemo(() => {
    if (
      activeGpsLat === null ||
      activeGpsLon === null ||
      targetLat === null ||
      targetLon === null
    ) {
      return null;
    }
    return computeRangeAndBearing(activeGpsLat, activeGpsLon, targetLat, targetLon);
  }, [activeGpsLat, activeGpsLon, targetLat, targetLon]);

  // Measurement validity helpers
  const hasPacket = latestPacket !== null;
  const hasAlt =
    hasPacket &&
    typeof latestPacket.altitude === 'number' &&
    Number.isFinite(latestPacket.altitude);
  const hasVel =
    hasPacket &&
    typeof latestPacket.velocity === 'number' &&
    Number.isFinite(latestPacket.velocity);
  const hasPress =
    hasPacket &&
    typeof latestPacket.pressure === 'number' &&
    Number.isFinite(latestPacket.pressure);
  const hasTemp =
    hasPacket &&
    typeof latestPacket.temperature === 'number' &&
    Number.isFinite(latestPacket.temperature);
  const hasBatt =
    hasPacket &&
    typeof latestPacket.batteryVoltage === 'number' &&
    Number.isFinite(latestPacket.batteryVoltage);
  const hasSoc =
    hasPacket &&
    typeof latestPacket.batterySoc === 'number' &&
    Number.isFinite(latestPacket.batterySoc);
  const hasRollPitch =
    hasPacket &&
    typeof latestPacket.roll === 'number' &&
    Number.isFinite(latestPacket.roll) &&
    typeof latestPacket.pitch === 'number' &&
    Number.isFinite(latestPacket.pitch);
  const hasSpin =
    hasPacket &&
    typeof latestPacket.spinRate === 'number' &&
    Number.isFinite(latestPacket.spinRate);

  const handleCopyCoordinates = async () => {
    if (activeGpsLat === null || activeGpsLon === null) return;
    const text = `${activeGpsLat.toFixed(6)}, ${activeGpsLon.toFixed(6)}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedGps(true);
      setTimeout(() => setCopiedGps(false), 2000);
    } catch {
      // Clipboard API may be blocked on insecure origins
    }
  };

  const handleOpenTargetEditor = () => {
    setInputTargetLat(
      targetLat !== null ? targetLat.toFixed(6) : BASE_GPS.latitude.toFixed(6)
    );
    setInputTargetLon(
      targetLon !== null ? targetLon.toFixed(6) : BASE_GPS.longitude.toFixed(6)
    );
    setTargetValidationError(null);
    setEditingTarget(true);
  };

  const handleSaveTarget = (e: React.FormEvent) => {
    e.preventDefault();
    const validation = parseAndValidateTargetCoordinates(inputTargetLat, inputTargetLon);
    if (!validation.valid) {
      setTargetValidationError(
        validation.error ?? 'Enter valid decimal latitude (-90..90) and longitude (-180..180).'
      );
      return;
    }
    onUpdateTarget(validation.latDeg, validation.lonDeg);
    setTargetValidationError(null);
    setEditingTarget(false);
  };

  const handleTriggerCalibrate = () => {
    onCalibrateSensors();
    setCalibrationStatus('Simulated barometer & IMU zeroed');
    setTimeout(() => setCalibrationStatus(null), 2600);
  };

  const handleTriggerGust = () => {
    onInjectDisturbance();
    setCalibrationStatus('1.5G aerodynamic gust impulse injected');
    setTimeout(() => setCalibrationStatus(null), 2200);
  };

  const isRecoveryPhase =
    latestPacket?.stateCode === FlightStateCode.IMPACT ||
    latestPacket?.stateCode === FlightStateCode.FAILSAFE;
  const buzzerActive =
    typeof latestPacket?.buzzerMosfet === 'boolean'
      ? latestPacket.buzzerMosfet
      : typeof latestPacket?.audioBeaconActive === 'boolean'
      ? latestPacket.audioBeaconActive
      : isSim && isRecoveryPhase;
  const burnwireActive =
    typeof latestPacket?.burnwireActive === 'boolean' ? latestPacket.burnwireActive : false;
  const hasServos =
    typeof latestPacket?.leftServoDeg === 'number' &&
    Number.isFinite(latestPacket.leftServoDeg) &&
    typeof latestPacket?.rightServoDeg === 'number' &&
    Number.isFinite(latestPacket.rightServoDeg);
  const hasContinuousSpools =
    typeof latestPacket?.leftBrakeCmd === 'number' &&
    Number.isFinite(latestPacket.leftBrakeCmd) &&
    typeof latestPacket?.rightBrakeCmd === 'number' &&
    Number.isFinite(latestPacket.rightBrakeCmd);
  const hasWheelRpm =
    typeof latestPacket?.wheelRpm === 'number' && Number.isFinite(latestPacket.wheelRpm);
  const portLabel = serialMetrics.portLabel ?? 'NO USB PORT OPEN';

  return (
    <section
      aria-label="Mobile Field Operations Priority Deck"
      data-testid="mobile-field-ops-deck"
      className="flex flex-col gap-2 lg:hidden select-none"
    >
      {/* 1. Radio Connection, Freshness & Mission Controls Card */}
      <div className="ops-card p-2.5 sm:p-3 flex flex-col gap-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] pb-2">
          <div className="flex items-center gap-2">
            {telemetrySource === 'SIMULATION' ? (
              <Activity className="w-4 h-4 text-[var(--accent-cobalt)] shrink-0" />
            ) : telemetrySource === 'REMOTE_VIEWER' ? (
              <Cloud className="w-4 h-4 text-[var(--accent-cobalt)] shrink-0" />
            ) : (
              <Radio className="w-4 h-4 text-[var(--accent-teal)] shrink-0" />
            )}
            <div>
              <div className="text-xs font-bold text-[var(--text-primary)] leading-tight flex items-center gap-1.5">
                <span>
                  {telemetrySource === 'SIMULATION'
                    ? 'Flight Simulator & Controls'
                    : telemetrySource === 'REMOTE_VIEWER'
                    ? 'Remote Spectator View'
                    : 'Live USB-Serial Telemetry Link'}
                </span>
                <span
                  className={`font-mono-data text-[10px] px-1.5 py-0.5 rounded-[var(--radius-xs)] border font-semibold ${
                    telemetrySource === 'SIMULATION'
                      ? 'bg-[var(--status-info-bg)] text-[var(--accent-cobalt)] border-[var(--accent-cobalt)]/25'
                      : telemetrySource === 'REMOTE_VIEWER'
                      ? hasPacket && !isStale
                        ? 'bg-[var(--accent-cobalt-soft)] text-[var(--accent-cobalt)] border-[var(--accent-cobalt)]/30'
                        : isStale
                        ? 'bg-[var(--status-warning-bg)] text-[var(--status-warning)] border-[var(--status-warning)]/40'
                        : 'bg-[var(--bg-surface-2)] text-[var(--text-secondary)] border-[var(--border-subtle)]'
                      : serialState === 'CONNECTED' && !isStale && hasPacket
                      ? 'bg-[var(--status-nominal-bg)] text-[var(--status-nominal)] border-[var(--status-nominal)]/30'
                      : isStale || serialState === 'ERROR'
                      ? 'bg-[var(--status-warning-bg)] text-[var(--status-warning)] border-[var(--status-warning)]/40'
                      : 'bg-[var(--bg-surface-2)] text-[var(--text-secondary)] border-[var(--border-subtle)]'
                  }`}
                >
                  {telemetrySource === 'SIMULATION'
                    ? isSimulating
                      ? 'SIM RUNNING (10Hz)'
                      : 'SIM PAUSED'
                    : telemetrySource === 'REMOTE_VIEWER'
                    ? !hasPacket
                      ? 'AWAITING SNAPSHOT'
                      : isStale
                      ? 'REMOTE STALE'
                      : 'REMOTE SYNC'
                    : serialState !== 'CONNECTED'
                    ? `USB ${serialState}`
                    : !hasPacket
                    ? 'AWAITING RX'
                    : isStale
                    ? 'LINK STALE'
                    : 'LIVE RX'}
                </span>
              </div>
              <div className="text-[10px] text-[var(--text-secondary)] font-mono-data mt-0.5">
                {telemetrySource === 'SIMULATION'
                  ? 'Isolated local 10Hz physics simulator • No hardware connected'
                  : telemetrySource === 'REMOTE_VIEWER'
                  ? 'Live cloud relay stream • Strictly read-only spectator view'
                  : `${portLabel} • ${liveBaudRate} 8N1 • Receive-Only (No Telecommands)`}
              </div>
            </div>
          </div>

          {/* Packet Freshness & Reception Summary Pill */}
          <div className="flex items-center gap-1.5 text-[10px] font-mono-data">
            <span className="px-2 py-0.5 bg-[var(--bg-surface-2)] border border-[var(--border-subtle)] rounded-[var(--radius-xs)] text-[var(--text-secondary)] tabular-nums">
              AGE:{' '}
              <strong
                className={
                  !hasPacket
                    ? 'text-[var(--text-tertiary)]'
                    : isStale
                    ? 'text-[var(--status-warning)]'
                    : 'text-[var(--status-nominal)]'
                }
              >
                {packetAgeSeconds !== null ? `${packetAgeSeconds.toFixed(1)}s` : '--'}
              </strong>
            </span>
            {!isSim && (
              <span
                className="px-2 py-0.5 bg-[var(--bg-surface-2)] border border-[var(--border-subtle)] rounded-[var(--radius-xs)] text-[var(--text-secondary)] tabular-nums"
                title="Valid vs Malformed CSV Frames"
              >
                OK:{' '}
                <strong className="text-[var(--status-nominal)]">
                  {serialMetrics.validPacketsReceived}
                </strong>{' '}
                / ERR:{' '}
                <strong className="text-[var(--status-alert)]">
                  {serialMetrics.malformedPacketsReceived}
                </strong>
              </span>
            )}
          </div>
        </div>

        {/* Mode-Specific Controls: REMOTE_VIEWER vs LIVE_SERIAL vs SIMULATION */}
        {telemetrySource === 'REMOTE_VIEWER' ? (
          <div className="flex flex-col gap-2 p-2.5 bg-[var(--bg-surface-2)] border border-[var(--border-subtle)] rounded-[var(--radius-sm)] text-[11px] font-mono-data text-[var(--text-secondary)]">
            <div className="flex items-center gap-2 text-[var(--accent-cobalt)] font-semibold">
              <Cloud className="w-4 h-4 shrink-0" />
              <span>REMOTE SPECTATOR MODE (READ-ONLY)</span>
            </div>
            <p className="text-[10px] text-[var(--text-tertiary)] leading-snug">
              Connected to Cloudflare relay. You are viewing live telemetry in real-time. Hardware telecommands, target adjustments, and USB serial links are strictly locked on remote devices.
            </p>
            {onOpenSyncModal && (
              <button
                type="button"
                onClick={onOpenSyncModal}
                className="mt-1 px-3 py-1.5 bg-[var(--accent-cobalt)] text-white text-xs font-semibold rounded-[var(--radius-xs)] hover:bg-[var(--accent-cobalt-hover)] flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Cloud className="w-3.5 h-3.5" />
                <span>Configure Relay / Connection</span>
              </button>
            )}
          </div>
        ) : !isSim ? (
          <div className="flex flex-col gap-2">
            {/* Browser Web Serial Compatibility Banner (Truthful on Mobile) */}
            {!webSerialSupport.supported && (
              <div
                role="status"
                data-testid="mobile-webserial-unsupported-banner"
                className="p-2.5 bg-[var(--status-warning-bg)] border border-[var(--status-warning)]/40 rounded-[var(--radius-sm)] text-[11px] text-[var(--text-primary)] space-y-1.5"
              >
                <div className="flex items-center gap-1.5 font-bold text-[var(--status-warning)]">
                  <ShieldAlert className="w-4 h-4 shrink-0" />
                  <span>{webSerialSupport.statusSummary}</span>
                </div>
                <p className="text-[11px] text-[var(--text-secondary)] leading-snug">
                  {webSerialSupport.guidanceMessage}
                </p>
                <div className="pt-0.5">
                  <button
                    type="button"
                    onClick={() => onSelectSource('SIMULATION')}
                    className="min-h-[34px] px-3 py-1 bg-[var(--accent-cobalt)] text-white text-[11px] font-semibold rounded-[var(--radius-xs)] cursor-pointer"
                  >
                    Switch to Local Flight Simulator
                  </button>
                </div>
              </div>
            )}

            {/* Serial Error Banner */}
            {serialMetrics.lastError && (
              <div
                role="alert"
                className="p-2 bg-[var(--status-alert-bg)] border border-[var(--status-alert)]/40 rounded-[var(--radius-xs)] text-[11px] text-[var(--status-alert)] flex items-start gap-1.5"
              >
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{serialMetrics.lastError}</span>
              </div>
            )}

            {/* USB Serial Connect / Disconnect + Baud Rate */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <label
                  htmlFor="mobile-baud-select"
                  className="text-[10px] font-semibold uppercase text-[var(--text-secondary)]"
                >
                  Baud:
                </label>
                <select
                  id="mobile-baud-select"
                  value={liveBaudRate}
                  disabled={serialState === 'CONNECTED' || serialState === 'CONNECTING'}
                  onChange={(e) => onChangeBaudRate(Number(e.target.value))}
                  className="min-h-[36px] bg-[var(--bg-surface-2)] border border-[var(--border-subtle)] text-[var(--text-primary)] text-xs font-mono-data px-2 py-1 rounded-[var(--radius-xs)] disabled:opacity-50"
                >
                  {BAUD_RATES.map((rate) => (
                    <option key={rate} value={rate}>
                      {rate === 115200 ? '115200 (Default)' : rate}
                    </option>
                  ))}
                </select>
              </div>

              {serialState === 'CONNECTED' ? (
                confirmDisconnectUsb ? (
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        onDisconnectSerial();
                        setConfirmDisconnectUsb(false);
                      }}
                      className="min-h-[36px] px-3 py-1.5 bg-[var(--status-alert)] text-white text-xs font-semibold rounded-[var(--radius-xs)] cursor-pointer"
                    >
                      Confirm Disconnect
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDisconnectUsb(false)}
                      className="min-h-[36px] px-2.5 py-1.5 bg-[var(--bg-surface-2)] text-[var(--text-secondary)] border border-[var(--border-subtle)] text-xs font-medium rounded-[var(--radius-xs)] cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmDisconnectUsb(true)}
                    className="min-h-[36px] px-3 py-1.5 bg-[var(--status-alert-bg)] text-[var(--status-alert)] border border-[var(--status-alert)]/40 text-xs font-semibold rounded-[var(--radius-xs)] flex items-center gap-1.5 cursor-pointer"
                  >
                    <Usb className="w-3.5 h-3.5" />
                    <span>Disconnect USB</span>
                  </button>
                )
              ) : (
                <button
                  type="button"
                  disabled={!webSerialSupport.supported || serialState === 'CONNECTING'}
                  onClick={onConnectSerial}
                  className="min-h-[36px] px-3.5 py-1.5 bg-[var(--accent-teal)] text-white text-xs font-semibold rounded-[var(--radius-xs)] flex items-center gap-1.5 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
                >
                  <Usb className="w-3.5 h-3.5" />
                  <span>
                    {serialState === 'CONNECTING'
                      ? 'Opening USB Port...'
                      : 'Connect USB Serial'}
                  </span>
                </button>
              )}
            </div>

            {/* Dual Timestamp Provenance Bar */}
            <div className="grid grid-cols-2 gap-1.5 pt-1 text-[10px] font-mono-data text-[var(--text-secondary)]">
              <div className="bg-[var(--bg-surface-2)] px-2 py-1 rounded-[var(--radius-xs)] border border-[var(--border-subtle)] truncate">
                <span className="text-[var(--text-tertiary)]">PC RX UTC: </span>
                <strong className="text-[var(--text-primary)] tabular-nums">
                  {serialMetrics.lastValidPacketRxTime ?? 'NONE'}
                </strong>
              </div>
              <div className="bg-[var(--bg-surface-2)] px-2 py-1 rounded-[var(--radius-xs)] border border-[var(--border-subtle)] truncate">
                <span className="text-[var(--text-tertiary)]">GNSS: </span>
                <strong className="text-[var(--text-primary)] tabular-nums">
                  {serialMetrics.lastValidPacketIst ??
                    serialMetrics.lastValidPacketUtc ??
                    latestPacket?.gnssTimeIst ??
                    latestPacket?.timestampUtc ??
                    'UNAVAIL'}
                </strong>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {/* Simulator Touch Controls Row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
              <button
                type="button"
                onClick={onToggleSimulation}
                className={`min-h-[38px] px-2.5 py-1.5 text-xs font-semibold rounded-[var(--radius-xs)] border flex items-center justify-center gap-1.5 cursor-pointer transition-colors ${
                  isSimulating
                    ? 'bg-[var(--status-warning-bg)] text-[var(--status-warning)] border-[var(--status-warning)]/40'
                    : 'bg-[var(--status-nominal-bg)] text-[var(--status-nominal)] border-[var(--status-nominal)]/40'
                }`}
              >
                {isSimulating ? (
                  <>
                    <Pause className="w-3.5 h-3.5 shrink-0" />
                    <span>Pause Sim</span>
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5 shrink-0" />
                    <span>Start Sim</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handleTriggerCalibrate}
                className="min-h-[38px] px-2.5 py-1.5 bg-[var(--bg-surface-2)] hover:bg-[var(--bg-surface-elevated)] text-[var(--text-primary)] border border-[var(--border-subtle)] text-xs font-semibold rounded-[var(--radius-xs)] flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Compass className="w-3.5 h-3.5 text-[var(--accent-cobalt)] shrink-0" />
                <span>Calibrate</span>
              </button>

              <button
                type="button"
                onClick={handleTriggerGust}
                className="min-h-[38px] px-2.5 py-1.5 bg-[var(--bg-surface-2)] hover:bg-[var(--bg-surface-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border-subtle)] text-xs font-semibold rounded-[var(--radius-xs)] flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Wind className="w-3.5 h-3.5 shrink-0" />
                <span>Inject Gust</span>
              </button>

              {confirmSimRestart ? (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      onResetSimulation();
                      setConfirmSimRestart(false);
                    }}
                    className="flex-1 min-h-[38px] px-2 py-1 bg-[var(--status-alert)] text-white text-[11px] font-bold rounded-[var(--radius-xs)] cursor-pointer"
                  >
                    Confirm
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmSimRestart(false)}
                    className="min-h-[38px] px-2 py-1 bg-[var(--bg-surface-2)] text-[var(--text-secondary)] border border-[var(--border-subtle)] text-[11px] font-medium rounded-[var(--radius-xs)] cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmSimRestart(true)}
                  className="min-h-[38px] px-2.5 py-1.5 bg-[var(--bg-surface-2)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border-subtle)] text-xs font-semibold rounded-[var(--radius-xs)] flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5 shrink-0" />
                  <span>Restart Sim</span>
                </button>
              )}
            </div>

            {/* Simulator Phase Quick-Jump Selector */}
            <div className="flex items-center justify-between gap-2 pt-0.5">
              <label
                htmlFor="mobile-sim-phase-select"
                className="text-[10px] font-semibold uppercase text-[var(--text-secondary)] whitespace-nowrap"
              >
                Sim Flight Phase:
              </label>
              <select
                id="mobile-sim-phase-select"
                value={latestPacket?.stateCode ?? FlightStateCode.ASCENT}
                onChange={(e) => onForceState(Number(e.target.value) as FlightStateCode)}
                className="flex-1 min-h-[34px] bg-[var(--bg-surface-2)] border border-[var(--border-subtle)] text-[var(--text-primary)] text-xs font-mono-data px-2 py-1 rounded-[var(--radius-xs)]"
              >
                {Object.values(FLIGHT_STATES).map((stateInfo) => (
                  <option key={stateInfo.code} value={stateInfo.code}>
                    {stateInfo.label}
                  </option>
                ))}
              </select>
            </div>

            {calibrationStatus && (
              <div className="text-[11px] font-mono-data text-[var(--status-nominal)] bg-[var(--status-nominal-bg)] border border-[var(--status-nominal)]/30 px-2.5 py-1 rounded-[var(--radius-xs)] flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                <span>{calibrationStatus}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 3. Primary Flight Measurements Grid (Truthful Valid / Stale / Unavailable States) */}
      <div className="ops-card p-2.5 sm:p-3 flex flex-col gap-2">
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-1.5">
          <div className="flex items-center gap-1.5">
            <Gauge className="w-4 h-4 text-[var(--accent-cobalt)]" />
            <span className="text-xs font-bold text-[var(--text-primary)]">
              Primary Flight Measurements
            </span>
          </div>
          <span
            className={`font-mono-data text-[10px] font-bold px-1.5 py-0.5 rounded-[var(--radius-xs)] border ${
              !hasPacket
                ? 'bg-[var(--bg-surface-2)] text-[var(--text-tertiary)] border-[var(--border-subtle)]'
                : isStale || latestPacket.stateCode === null
                ? 'bg-[var(--status-warning-bg)] text-[var(--status-warning)] border-[var(--status-warning)]/40'
                : 'bg-[var(--status-nominal-bg)] text-[var(--status-nominal)] border-[var(--status-nominal)]/30'
            }`}
          >
            {!hasPacket
              ? 'NO TELEMETRY'
              : isStale
              ? 'STALE TELEMETRY'
              : latestPacket.stateCode === null
              ? `UNMAPPED: ${latestPacket.fswStateName}`
              : `STATE ${latestPacket.fswStateIndex ?? latestPacket.stateCode}: ${latestPacket.fswStateName}`}
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
          {/* Baro Altitude */}
          <div className="bg-[var(--bg-surface-2)] border border-[var(--border-subtle)] rounded-[var(--radius-xs)] p-2">
            <div className="flex items-center justify-between text-[10px] text-[var(--text-secondary)]">
              <span className="font-semibold uppercase">Baro Alt</span>
              <span className="font-mono-data text-[9px] text-[var(--text-tertiary)]">
                {!hasAlt ? 'UNAVAIL' : isStale ? 'STALE' : 'AGL'}
              </span>
            </div>
            <div className="font-mono-data text-sm sm:text-base font-bold text-[var(--text-primary)] tabular-nums mt-0.5">
              {hasAlt ? `${latestPacket!.altitude!.toFixed(1)} m` : '-- m'}
            </div>
          </div>

          {/* Vertical Speed */}
          <div className="bg-[var(--bg-surface-2)] border border-[var(--border-subtle)] rounded-[var(--radius-xs)] p-2">
            <div className="flex items-center justify-between text-[10px] text-[var(--text-secondary)]">
              <span className="font-semibold uppercase">Vert Speed</span>
              <span className="font-mono-data text-[9px] text-[var(--text-tertiary)]">
                {!hasVel ? 'AWAITING Δz/Δt' : isStale ? 'STALE' : 'DERIVED'}
              </span>
            </div>
            <div className="font-mono-data text-sm sm:text-base font-bold text-[var(--text-primary)] tabular-nums mt-0.5">
              {hasVel
                ? `${latestPacket!.velocity! >= 0 ? '+' : ''}${latestPacket!.velocity!.toFixed(1)} m/s`
                : '-- m/s'}
            </div>
          </div>

          {/* 2S Battery */}
          <div className="bg-[var(--bg-surface-2)] border border-[var(--border-subtle)] rounded-[var(--radius-xs)] p-2">
            <div className="flex items-center justify-between text-[10px] text-[var(--text-secondary)]">
              <span className="font-semibold uppercase flex items-center gap-1">
                <Battery className="w-3 h-3 text-[var(--accent-teal)]" />
                2S Battery
              </span>
              <span className="font-mono-data text-[9px] text-[var(--text-tertiary)]">
                {!optionalTelemetrySettings.enableBatteryVoltage
                  ? 'DISABLED'
                  : !hasBatt
                  ? 'UNAVAIL'
                  : hasSoc
                  ? `${latestPacket!.batterySoc!.toFixed(0)}%`
                  : 'VALID'}
              </span>
            </div>
            <div
              className={`font-mono-data text-sm sm:text-base font-bold tabular-nums mt-0.5 ${
                !optionalTelemetrySettings.enableBatteryVoltage || !hasBatt
                  ? 'text-[var(--text-tertiary)]'
                  : latestPacket!.batteryVoltage! >= 6.4
                  ? 'text-[var(--status-nominal)]'
                  : 'text-[var(--status-warning)]'
              }`}
            >
              {!optionalTelemetrySettings.enableBatteryVoltage
                ? 'DISABLED'
                : hasBatt
                ? `${latestPacket!.batteryVoltage!.toFixed(2)} V`
                : '-- V'}
            </div>
          </div>

          {/* Baro Pressure */}
          <div className="bg-[var(--bg-surface-2)] border border-[var(--border-subtle)] rounded-[var(--radius-xs)] p-2">
            <div className="flex items-center justify-between text-[10px] text-[var(--text-secondary)]">
              <span className="font-semibold uppercase">Pressure</span>
              <span className="font-mono-data text-[9px] text-[var(--text-tertiary)]">
                {!hasPress ? 'UNAVAIL' : 'MS5611'}
              </span>
            </div>
            <div className="font-mono-data text-sm font-bold text-[var(--text-primary)] tabular-nums mt-0.5">
              {hasPress ? `${latestPacket!.pressure!.toFixed(1)} hPa` : '-- hPa'}
            </div>
          </div>

          {/* Temperature */}
          <div className="bg-[var(--bg-surface-2)] border border-[var(--border-subtle)] rounded-[var(--radius-xs)] p-2">
            <div className="flex items-center justify-between text-[10px] text-[var(--text-secondary)]">
              <span className="font-semibold uppercase flex items-center gap-0.5">
                <Thermometer className="w-3 h-3 text-[var(--accent-amber)]" />
                Temp
              </span>
              <span className="font-mono-data text-[9px] text-[var(--text-tertiary)]">
                {!hasTemp ? 'UNAVAIL' : 'MS5611'}
              </span>
            </div>
            <div className="font-mono-data text-sm font-bold text-[var(--text-primary)] tabular-nums mt-0.5">
              {hasTemp ? `${latestPacket!.temperature!.toFixed(1)} °C` : '-- °C'}
            </div>
          </div>

          {/* Attitude Roll / Pitch / Spin */}
          <div className="bg-[var(--bg-surface-2)] border border-[var(--border-subtle)] rounded-[var(--radius-xs)] p-2">
            <div className="flex items-center justify-between text-[10px] text-[var(--text-secondary)]">
              <span className="font-semibold uppercase">Roll / Pitch</span>
              <span className="font-mono-data text-[9px] text-[var(--text-tertiary)]">
                {hasSpin ? `${latestPacket!.spinRate!.toFixed(1)} °/s` : 'IMU'}
              </span>
            </div>
            <div className="font-mono-data text-xs sm:text-sm font-bold text-[var(--text-primary)] tabular-nums mt-0.5">
              {hasRollPitch
                ? `${latestPacket!.roll!.toFixed(1)}° / ${latestPacket!.pitch!.toFixed(1)}°`
                : '--° / --°'}
            </div>
          </div>
        </div>
      </div>

      {/* 4. GPS Coordinates, Target Landing Point & Recovery Status Card */}
      <div className="ops-card p-2.5 sm:p-3 flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-1.5 border-b border-[var(--border-subtle)] pb-1.5">
          <div className="flex items-center gap-1.5">
            <Satellite className="w-4 h-4 text-[var(--accent-cobalt)]" />
            <span className="text-xs font-bold text-[var(--text-primary)]">
              GPS Position, Target &amp; Recovery
            </span>
          </div>

          <div className="flex items-center gap-1.5 text-[10px] font-mono-data">
            <span
              className={`px-1.5 py-0.5 rounded-[var(--radius-xs)] border font-semibold ${
                gpsStatusMode === 'CURRENT_FIX'
                  ? 'bg-[var(--status-nominal-bg)] text-[var(--status-nominal)] border-[var(--status-nominal)]/30'
                  : gpsStatusMode === 'LAST_KNOWN_STALE'
                  ? 'bg-[var(--status-warning-bg)] text-[var(--status-warning)] border-[var(--status-warning)]/40'
                  : 'bg-[var(--bg-surface-2)] text-[var(--text-tertiary)] border-[var(--border-subtle)]'
              }`}
            >
              {gpsStatusMode === 'CURRENT_FIX'
                ? '3D GPS FIX'
                : gpsStatusMode === 'LAST_KNOWN_STALE'
                ? 'LAST KNOWN (STALE)'
                : 'NO GPS FIX'}
            </span>
            <span className="px-1.5 py-0.5 bg-[var(--bg-surface-2)] border border-[var(--border-subtle)] rounded-[var(--radius-xs)] text-[var(--text-secondary)]">
              SATS: <strong>{latestPacket?.gpsSats ?? '--'}</strong>
            </span>
          </div>
        </div>

        {/* Vehicle GPS + Target Coordinates Split */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {/* Vehicle GPS Readout */}
          <div className="bg-[var(--bg-surface-2)] border border-[var(--border-subtle)] rounded-[var(--radius-xs)] p-2 flex flex-col justify-between gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase text-[var(--text-secondary)] flex items-center gap-1">
                <MapPin className="w-3 h-3 text-[var(--accent-cobalt)]" />
                CanSat Coordinates
              </span>
              {activeGpsLat !== null && activeGpsLon !== null && (
                <button
                  type="button"
                  onClick={handleCopyCoordinates}
                  className="min-h-[26px] px-2 py-0.5 bg-[var(--bg-surface-1)] hover:bg-[var(--bg-surface-elevated)] text-[var(--text-primary)] border border-[var(--border-subtle)] rounded-[var(--radius-xs)] text-[10px] font-semibold flex items-center gap-1 cursor-pointer"
                >
                  {copiedGps ? (
                    <>
                      <Check className="w-3 h-3 text-[var(--status-nominal)]" />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      <span>Copy GPS</span>
                    </>
                  )}
                </button>
              )}
            </div>

            <div className="font-mono-data text-xs font-bold text-[var(--text-primary)] tabular-nums">
              {activeGpsLat !== null && activeGpsLon !== null
                ? `${activeGpsLat.toFixed(6)}° N, ${activeGpsLon.toFixed(6)}° E`
                : 'UNAVAILABLE (Awaiting 3D Fix)'}
            </div>

            <div className="text-[10px] font-mono-data text-[var(--text-secondary)] flex items-center justify-between">
              <span>
                GPS Alt:{' '}
                <strong className="text-[var(--text-primary)]">
                  {activeGpsAlt !== null ? `${activeGpsAlt.toFixed(1)} m` : '--'}
                </strong>
              </span>
              <span>
                Status:{' '}
                <strong className="text-[var(--text-primary)]">
                  {gpsStatusMode === 'CURRENT_FIX'
                    ? 'LIVE'
                    : gpsStatusMode === 'LAST_KNOWN_STALE'
                    ? 'CACHED'
                    : 'NONE'}
                </strong>
              </span>
            </div>
          </div>

          {/* Target Landing Point Readout & Editor Toggle */}
          <div className="bg-[var(--bg-surface-2)] border border-[var(--border-subtle)] rounded-[var(--radius-xs)] p-2 flex flex-col justify-between gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase text-[var(--text-secondary)] flex items-center gap-1">
                <Target className="w-3 h-3 text-[var(--accent-amber)]" />
                Target Landing Point
              </span>
              {telemetrySource !== 'REMOTE_VIEWER' ? (
                <button
                  type="button"
                  onClick={handleOpenTargetEditor}
                  data-testid="mobile-edit-target-btn"
                  className="min-h-[26px] px-2 py-0.5 bg-[var(--bg-surface-1)] hover:bg-[var(--bg-surface-elevated)] text-[var(--accent-cobalt)] border border-[var(--border-subtle)] rounded-[var(--radius-xs)] text-[10px] font-semibold cursor-pointer"
                >
                  {targetLat !== null ? 'Edit Target' : 'Set Target'}
                </button>
              ) : (
                <span className="text-[10px] font-mono-data text-[var(--text-tertiary)] italic px-1">
                  Target Locked
                </span>
              )}
            </div>

            <div className="font-mono-data text-xs font-bold text-[var(--text-primary)] tabular-nums">
              {targetLat !== null && targetLon !== null
                ? `${targetLat.toFixed(6)}° N, ${targetLon.toFixed(6)}° E`
                : 'NOT SET'}
            </div>

            <div className="text-[10px] font-mono-data text-[var(--text-secondary)] flex items-center justify-between">
              <span>
                Range:{' '}
                <strong className="text-[var(--text-primary)]">
                  {targetVector ? `${targetVector.distanceMeters.toFixed(0)} m` : '--'}
                </strong>
              </span>
              <span>
                Bearing:{' '}
                <strong className="text-[var(--text-primary)]">
                  {targetVector ? `${targetVector.bearingDeg.toFixed(0)}°` : '--'}
                </strong>
              </span>
            </div>
          </div>
        </div>

        {/* Inline Target Coordinate Validation Form */}
        {editingTarget && (
          <form
            onSubmit={handleSaveTarget}
            data-testid="mobile-target-form"
            className="bg-[var(--bg-surface-2)] border border-[var(--accent-cobalt)]/40 rounded-[var(--radius-sm)] p-2.5 flex flex-col gap-2"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-[var(--text-primary)]">
                Set Target Landing Coordinates (WGS84)
              </span>
              <button
                type="button"
                onClick={() => setEditingTarget(false)}
                className="p-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {targetValidationError && (
              <div
                role="alert"
                className="p-2 bg-[var(--status-alert-bg)] border border-[var(--status-alert)]/40 rounded-[var(--radius-xs)] text-[11px] text-[var(--status-alert)]"
              >
                {targetValidationError}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <label
                  htmlFor="mobile-target-lat"
                  className="block text-[10px] font-semibold uppercase text-[var(--text-secondary)] mb-0.5"
                >
                  Target Latitude (-90° to +90°)
                </label>
                <input
                  id="mobile-target-lat"
                  type="text"
                  inputMode="decimal"
                  value={inputTargetLat}
                  onChange={(e) => setInputTargetLat(e.target.value)}
                  placeholder="e.g. 13.349000"
                  className="w-full min-h-[36px] bg-[var(--bg-surface-1)] border border-[var(--border-subtle)] px-2.5 py-1 text-xs font-mono-data text-[var(--text-primary)] rounded-[var(--radius-xs)]"
                />
              </div>
              <div>
                <label
                  htmlFor="mobile-target-lon"
                  className="block text-[10px] font-semibold uppercase text-[var(--text-secondary)] mb-0.5"
                >
                  Target Longitude (-180° to +180°)
                </label>
                <input
                  id="mobile-target-lon"
                  type="text"
                  inputMode="decimal"
                  value={inputTargetLon}
                  onChange={(e) => setInputTargetLon(e.target.value)}
                  placeholder="e.g. 74.792800"
                  className="w-full min-h-[36px] bg-[var(--bg-surface-1)] border border-[var(--border-subtle)] px-2.5 py-1 text-xs font-mono-data text-[var(--text-primary)] rounded-[var(--radius-xs)]"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <div className="flex items-center gap-2 text-[11px]">
                <button
                  type="button"
                  onClick={() => {
                    setInputTargetLat(BASE_GPS.latitude.toFixed(6));
                    setInputTargetLon(BASE_GPS.longitude.toFixed(6));
                    setTargetValidationError(null);
                  }}
                  className="text-[var(--accent-cobalt)] underline cursor-pointer"
                >
                  Use Launch Pad
                </button>
                {targetLat !== null && (
                  <button
                    type="button"
                    onClick={() => {
                      onUpdateTarget(null, null);
                      setEditingTarget(false);
                    }}
                    className="text-[var(--status-alert)] underline cursor-pointer"
                  >
                    Clear Target
                  </button>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setEditingTarget(false)}
                  className="min-h-[34px] px-3 py-1 bg-[var(--bg-surface-1)] text-[var(--text-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-xs)] text-xs font-medium cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="min-h-[34px] px-3 py-1 bg-[var(--accent-cobalt)] text-white rounded-[var(--radius-xs)] text-xs font-semibold flex items-center gap-1 cursor-pointer"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Save Target</span>
                </button>
              </div>
            </div>
          </form>
        )}

        {/* Gated ENU Landing Predictor Status + Recovery Subsystems Strip */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-[var(--border-subtle)] text-[10px] font-mono-data">
          <div className="flex items-center gap-1.5 min-w-0">
            <Crosshair className="w-3.5 h-3.5 text-[var(--accent-cobalt)] shrink-0" />
            {landingPrediction?.valid && landingPrediction.prediction ? (
              <span className="truncate text-[var(--status-nominal)] font-semibold">
                PREDICTED IMPACT: {landingPrediction.prediction.predicted_lat_deg.toFixed(5)}°,{' '}
                {landingPrediction.prediction.predicted_lon_deg.toFixed(5)}° (T-
                {landingPrediction.prediction.estimated_time_to_landing_s.toFixed(0)}s)
              </span>
            ) : (
              <span className="truncate text-[var(--text-secondary)]">
                PREDICTOR:{' '}
                {landingPrediction?.reason_code ?? 'Gated until descending with 3D fix'}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
            {hasContinuousSpools ? (
              <span
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[var(--radius-xs)] border bg-[var(--bg-surface-2)] text-[var(--text-secondary)] border-[var(--border-subtle)] font-semibold"
                title="Left / Right Continuous-Rotation Parafoil Brake Spool Commands (LEFT_BRAKE_CMD / RIGHT_BRAKE_CMD)"
              >
                <Navigation className="w-3 h-3 text-[var(--accent-cobalt)]" />
                <span>
                  SPOOL: {(latestPacket!.leftBrakeCmd! * 100).toFixed(0)}%/{(latestPacket!.rightBrakeCmd! * 100).toFixed(0)}%
                  {latestPacket!.actuatorCalStatus === 'UNCAL_LOCKED' ? ' (UNCAL)' : ''}
                </span>
              </span>
            ) : hasServos ? (
              <span
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[var(--radius-xs)] border bg-[var(--bg-surface-2)] text-[var(--text-secondary)] border-[var(--border-subtle)] font-semibold"
                title="Left / Right Parafoil Brake Servo Angles (LEFT_SERVO_DEG / RIGHT_SERVO_DEG)"
              >
                <Navigation className="w-3 h-3 text-[var(--accent-cobalt)]" />
                <span>
                  SRV: {latestPacket!.leftServoDeg!.toFixed(0)}°/{latestPacket!.rightServoDeg!.toFixed(0)}°
                </span>
              </span>
            ) : null}
            {hasWheelRpm && (
              <span
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[var(--radius-xs)] border bg-[var(--bg-surface-2)] text-[var(--text-secondary)] border-[var(--border-subtle)] font-semibold"
                title="Flywheel Target RPM (FLYWHEEL_RPM)"
              >
                <span>RPM: {Math.round(latestPacket!.wheelRpm!)}</span>
              </span>
            )}
            <span
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[var(--radius-xs)] border font-semibold ${
                burnwireActive
                  ? 'bg-[var(--status-warning-bg)] text-[var(--status-warning)] border-[var(--status-warning)]/40'
                  : 'bg-[var(--bg-surface-2)] text-[var(--text-tertiary)] border-[var(--border-subtle)]'
              }`}
              title="Pin 4 XY-MOS Thermal Reefing Cutter (BURNWIRE_MOSFET)"
            >
              <span>BW: {burnwireActive ? 'ON (1)' : 'OFF'}</span>
            </span>
            <span
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[var(--radius-xs)] border font-semibold ${
                buzzerActive
                  ? 'bg-[var(--status-nominal-bg)] text-[var(--status-nominal)] border-[var(--status-nominal)]/30'
                  : 'bg-[var(--bg-surface-2)] text-[var(--text-tertiary)] border-[var(--border-subtle)]'
              }`}
              title="Pin 5 XY-MOS Recovery Buzzer (BUZZER_MOSFET)"
            >
              <Volume2 className="w-3 h-3" />
              <span>BUZZER: {buzzerActive ? 'ACTIVE' : 'STBY'}</span>
            </span>
            <button
              type="button"
              onClick={onOpenLandingPredictor}
              className="px-2 py-0.5 bg-[var(--accent-cobalt-soft)] text-[var(--accent-cobalt)] border border-[var(--accent-cobalt)]/30 rounded-[var(--radius-xs)] font-semibold cursor-pointer"
            >
              Predictor →
            </button>
          </div>
        </div>
      </div>
    </section>
  );
};
