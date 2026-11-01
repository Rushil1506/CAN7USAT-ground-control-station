import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  Terminal,
  Download,
  Trash2,
  Send,
  X,
  Copy,
  Check,
  ArrowDownCircle,
  AlertCircle,
  Play,
  Square,
  RotateCcw,
  Compass,
  Crosshair,
  Search,
  List,
  Layers,
  ZoomIn,
  ZoomOut,
  Radio,
} from 'lucide-react';
import { RawLogEntry, TelemetryPacket, TelemetrySource } from '../types';
import {
  exportTelemetryPacketsToCsv,
  exportOfficialFlightCsv,
  OFFICIAL_FLIGHT_CSV_FILENAME,
} from '../services/telemetryExport';
import { TEAM_INFO } from '../constants';

export interface TerminalDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  telemetrySource: TelemetrySource;
  rawLogEntries: RawLogEntry[];
  historyPackets: TelemetryPacket[];
  latestPacket?: TelemetryPacket | null;
  onSendCommand: (cmd: string) => void | Promise<void>;
  onClearLogs: () => void;
  isDockedDesktop?: boolean;
  targetLat?: number | null;
  targetLon?: number | null;
}

export function getLogBadgeLabel(
  log: RawLogEntry,
  fallbackSource: TelemetrySource = 'SIMULATION'
): string {
  const entrySource = log.source ?? fallbackSource;
  const entryIsSim = entrySource === 'SIMULATION';
  if (log.type === 'err') return entryIsSim ? 'SIM-ERR' : 'LIVE-ERR';
  if (log.type === 'sys') return entryIsSim ? 'SIM-SYS' : 'LIVE-SYS';
  if (entryIsSim) {
    if (log.type === 'tx') return 'SIM-TX';
    if (log.type === 'rx' && log.text.includes('ACK]')) return 'SIM-ACK';
    return 'SIM-RX';
  }
  return log.type === 'tx' ? 'LIVE-TX' : 'LIVE-RX';
}

export function getTerminalFilterTabs(
  telemetrySource: TelemetrySource
): { key: 'all' | 'rx' | 'tx' | 'sys' | 'err'; label: string }[] {
  if (telemetrySource === 'SIMULATION') {
    return [
      { key: 'all', label: 'ALL' },
      { key: 'rx', label: 'SIM RX' },
      { key: 'err', label: 'ERR' },
      { key: 'tx', label: 'SIM TX' },
      { key: 'sys', label: 'SYS' },
    ];
  }
  return [
    { key: 'all', label: 'ALL' },
    { key: 'rx', label: 'LIVE RX' },
    { key: 'err', label: 'ERR' },
    { key: 'sys', label: 'SYS' },
  ];
}

export function filterLogsBySource(
  rawLogEntries: RawLogEntry[],
  telemetrySource: TelemetrySource,
  filterType: 'all' | 'rx' | 'tx' | 'sys' | 'err' = 'all'
): RawLogEntry[] {
  const effectiveFilter =
    telemetrySource === 'LIVE_SERIAL' && filterType === 'tx' ? 'all' : filterType;

  return rawLogEntries.filter((entry) => {
    const entrySource = entry.source ?? 'SIMULATION';
    if (entrySource !== telemetrySource) return false;
    if (effectiveFilter === 'all') return true;
    return entry.type === effectiveFilter;
  });
}

type FontSizeOption = 'sm' | 'md' | 'lg' | 'xl';

export const TerminalDrawer: React.FC<TerminalDrawerProps> = ({
  isOpen,
  onClose,
  telemetrySource,
  rawLogEntries,
  historyPackets,
  latestPacket = null,
  onSendCommand,
  onClearLogs,
  isDockedDesktop = false,
  targetLat = null,
  targetLon = null,
}) => {
  const [inputCommand, setInputCommand] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'rx' | 'tx' | 'sys' | 'err'>('all');
  const [viewMode, setViewMode] = useState<'raw' | 'decoded'>('raw');
  const [fontSize, setFontSize] = useState<FontSizeOption>('md');
  const [autoScroll, setAutoScroll] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [txPending, setTxPending] = useState<string | null>(null);

  const consoleContainerRef = useRef<HTMLDivElement | null>(null);
  const copyTimerRef = useRef<number | null>(null);

  const isSim = telemetrySource === 'SIMULATION';

  // Extract latest telecommand ACK status from raw logs
  const telemetryStatusInfo = useMemo(() => {
    const relevantLogs = rawLogEntries.filter(
      (l) => (l.source ?? 'SIMULATION') === telemetrySource
    );
    let state: 'ACTIVE' | 'STOPPED' | 'UNKNOWN' = 'UNKNOWN';
    let lastAckText: string | null = null;
    let lastAckTime: string | null = null;

    for (let i = relevantLogs.length - 1; i >= 0; i--) {
      const text = relevantLogs[i].text.toUpperCase();
      if (text.includes('ACK:CX=ON')) {
        state = 'ACTIVE';
        lastAckText = relevantLogs[i].text;
        lastAckTime = relevantLogs[i].time;
        break;
      }
      if (text.includes('ACK:CX=OFF')) {
        state = 'STOPPED';
        lastAckText = relevantLogs[i].text;
        lastAckTime = relevantLogs[i].time;
        break;
      }
      if (text.includes('ACK:') || text.includes('SIM_ACK')) {
        if (!lastAckText) {
          lastAckText = relevantLogs[i].text;
          lastAckTime = relevantLogs[i].time;
        }
      }
    }

    return { state, lastAckText, lastAckTime };
  }, [rawLogEntries, telemetrySource]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  const sourceScopedLogs = filterLogsBySource(rawLogEntries, telemetrySource, 'all');
  const filteredLogs = useMemo(() => {
    let logs = filterLogsBySource(rawLogEntries, telemetrySource, filterType);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      logs = logs.filter((l) => l.text.toLowerCase().includes(q) || l.time.includes(q));
    }
    return logs;
  }, [rawLogEntries, telemetrySource, filterType, searchQuery]);

  useEffect(() => {
    if (isOpen && autoScroll && consoleContainerRef.current && viewMode === 'raw') {
      consoleContainerRef.current.scrollTop = consoleContainerRef.current.scrollHeight;
    }
  }, [filteredLogs.length, isOpen, autoScroll, filterType, telemetrySource, viewMode]);

  if (!isOpen) return null;

  const handleSend = async (cmdToSend: string) => {
    const trimmed = cmdToSend.trim();
    if (!trimmed) return;
    setTxPending(trimmed);
    try {
      await onSendCommand(trimmed);
    } finally {
      setTimeout(() => setTxPending(null), 600);
    }
    setInputCommand('');
  };

  const downloadCsvLog = () => {
    if (historyPackets.length === 0) return;
    exportTelemetryPacketsToCsv(historyPackets, telemetrySource);
  };

  const copyToClipboard = () => {
    if (sourceScopedLogs.length === 0) return;
    const text = sourceScopedLogs
      .map((l) => `[${l.time}] [${getLogBadgeLabel(l, telemetrySource)}] ${l.text}`)
      .join('\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    if (copyTimerRef.current !== null) {
      window.clearTimeout(copyTimerRef.current);
    }
    copyTimerRef.current = window.setTimeout(() => setCopied(false), 2000);
  };

  const cycleFontSize = (direction: 'up' | 'down') => {
    const sizes: FontSizeOption[] = ['sm', 'md', 'lg', 'xl'];
    const currentIdx = sizes.indexOf(fontSize);
    if (direction === 'up') {
      if (currentIdx < sizes.length - 1) setFontSize(sizes[currentIdx + 1]);
    } else {
      if (currentIdx > 0) setFontSize(sizes[currentIdx - 1]);
    }
  };

  const getFontSizeClasses = () => {
    switch (fontSize) {
      case 'sm':
        return 'text-[11px] leading-tight';
      case 'lg':
        return 'text-[14px] leading-normal';
      case 'xl':
        return 'text-[16px] leading-relaxed';
      case 'md':
      default:
        return 'text-[12.5px] leading-snug';
    }
  };

  const filterLabels = getTerminalFilterTabs(telemetrySource);

  // Decoded fields table items with explicit measurement classifications
  const decodedFields = latestPacket
    ? [
        { idx: 0, field: 'TEAM_ID', value: latestPacket.teamId, unit: '', source: 'HEADER', nature: 'METADATA' },
        { idx: 1, field: 'TIME_STAMPING', value: `${latestPacket.missionTimeSeconds}s`, unit: 's', source: 'ARDUINO MILLIS', nature: 'MEASURED CLOCK' },
        { idx: 2, field: 'PACKET_COUNT', value: `#${latestPacket.packetNumber}`, unit: '', source: 'PACKET COUNTER', nature: 'METADATA' },
        { idx: 3, field: 'ALTITUDE', value: latestPacket.altitude !== null ? latestPacket.altitude.toFixed(2) : 'N/A', unit: 'm', source: 'MS5611 BARO', nature: 'MEASURED' },
        { idx: 4, field: 'PRESSURE', value: latestPacket.pressure !== null ? latestPacket.pressure.toFixed(2) : 'N/A', unit: 'hPa', source: 'MS5611 BARO', nature: 'MEASURED' },
        { idx: 5, field: 'TEMP', value: latestPacket.temperature !== null ? latestPacket.temperature.toFixed(2) : 'N/A', unit: '°C', source: 'MS5611 BARO', nature: 'MEASURED' },
        { idx: 6, field: 'VOLTAGE', value: latestPacket.batteryVoltage !== null ? latestPacket.batteryVoltage.toFixed(2) : 'N/A', unit: 'V', source: 'A0 ADC (150k/47k)', nature: 'MEASURED' },
        { idx: 7, field: 'GNSS_TIME', value: latestPacket.timestampUtc || 'NO FIX', unit: 'UTC', source: 'NEO-M9N GNSS', nature: 'MEASURED' },
        { idx: 8, field: 'GNSS_LATITUDE', value: latestPacket.latitude !== null ? latestPacket.latitude.toFixed(6) : 'N/A', unit: '°N', source: latestPacket.gpsValid ? 'NEO-M9N (3D FIX)' : 'NEO-M9N (NO FIX)', nature: 'MEASURED' },
        { idx: 9, field: 'GNSS_LONGITUDE', value: latestPacket.longitude !== null ? latestPacket.longitude.toFixed(6) : 'N/A', unit: '°E', source: latestPacket.gpsValid ? 'NEO-M9N (3D FIX)' : 'NEO-M9N (NO FIX)', nature: 'MEASURED' },
        { idx: 10, field: 'GNSS_ALTITUDE', value: latestPacket.gpsAltitude !== null ? latestPacket.gpsAltitude.toFixed(1) : 'N/A', unit: 'm AMSL', source: latestPacket.gpsValid ? 'NEO-M9N (3D FIX)' : 'NEO-M9N (NO FIX)', nature: 'MEASURED' },
        { idx: 11, field: 'GNSS_SATS', value: latestPacket.gpsSats !== null ? `${latestPacket.gpsSats} (${latestPacket.gpsFixType})` : '0', unit: 'SVs', source: 'NEO-M9N GNSS', nature: 'MEASURED' },
        { idx: 12, field: 'ACCELEROMETER_DATA', value: latestPacket.acceleration !== null ? latestPacket.acceleration.toFixed(2) : 'N/A', unit: 'G', source: 'MPU6050 REGISTERS', nature: 'MEASURED' },
        { idx: 13, field: 'GYRO_SPIN_RATE', value: latestPacket.spinRate !== null ? latestPacket.spinRate.toFixed(2) : 'N/A', unit: 'deg/s', source: 'MPU6050 REGISTERS', nature: 'MEASURED' },
        { idx: 14, field: 'FLIGHT_SOFTWARE_STATE', value: latestPacket.fswStateName || `STATE_${latestPacket.stateCode}`, unit: '', source: 'FSW FSM', nature: 'INTERNAL STATE' },
        { idx: 15, field: 'PITCH', value: latestPacket.pitch !== null ? `${latestPacket.pitch.toFixed(1)}°` : 'N/A', unit: 'deg', source: 'ACCEL atan2(-ax, az)', nature: 'DERIVED TILT' },
        { idx: 16, field: 'ROLL', value: latestPacket.roll !== null ? `${latestPacket.roll.toFixed(1)}°` : 'N/A', unit: 'deg', source: 'ACCEL atan2(ay, az)', nature: 'DERIVED TILT' },
        { idx: 17, field: 'YAW', value: latestPacket.yaw !== null ? `${latestPacket.yaw.toFixed(1)}°` : 'N/A', unit: 'deg', source: '100Hz GYRO INTEGRAL', nature: 'DEAD-RECKONING' },
      ]
    : [];

  const containerClasses = isDockedDesktop
    ? 'flex flex-col h-full w-full bg-[var(--bg-surface-1)] select-none overflow-hidden'
    : 'fixed inset-x-0 bottom-0 z-50 bg-[var(--bg-surface-1)] border-t-2 border-[var(--border-amber)] shadow-2xl flex flex-col h-96 sm:h-[460px] max-h-[85vh] select-none';

  return (
    <div role="region" aria-label="Telemetry and Command Log Console" className={containerClasses}>
      {/* Top Console Controls Header */}
      <div className="flex flex-wrap justify-between items-center gap-2 px-3 py-2 bg-[var(--bg-surface-2)] border-b border-[var(--border-subtle)] shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Terminal className="w-4 h-4 text-[var(--action-amber)] shrink-0" />
          <span className="font-mono-data text-xs font-bold text-[var(--text-primary)] uppercase tracking-wider truncate">
            TELEMETRY &amp; COMMAND CONSOLE
          </span>
          <span
            className={`font-mono-data text-[9px] px-1.5 py-0.5 border rounded-[var(--radius-xs)] uppercase shrink-0 font-bold ${
              isSim
                ? 'text-[var(--status-info)] bg-[var(--bg-surface-1)] border-[var(--border-subtle)]'
                : 'text-[var(--status-nominal)] bg-[var(--status-nominal-bg)] border-[var(--status-nominal)]/40'
            }`}
          >
            {isSim ? 'SIMULATOR LOOPBACK' : 'LIVE SERIAL (BIDIRECTIONAL)'}
          </span>

          {/* Telemetry Downlink State Pill */}
          <span
            className={`hidden sm:inline-flex items-center gap-1 font-mono-data text-[9px] px-2 py-0.5 border rounded-[var(--radius-xs)] font-bold shrink-0 ${
              telemetryStatusInfo.state === 'ACTIVE'
                ? 'text-[var(--status-nominal)] bg-[var(--status-nominal-bg)] border-[var(--status-nominal)]/50'
                : telemetryStatusInfo.state === 'STOPPED'
                ? 'text-[var(--status-alert)] bg-[var(--status-alert-bg)] border-[var(--status-alert)]/50'
                : 'text-[var(--text-secondary)] bg-[var(--bg-surface-1)] border-[var(--border-subtle)]'
            }`}
            title={
              telemetryStatusInfo.lastAckText
                ? `Last Firmware ACK: ${telemetryStatusInfo.lastAckText} @ ${telemetryStatusInfo.lastAckTime}`
                : 'Awaiting telemetry start acknowledgement'
            }
          >
            <Radio className="w-3 h-3" />
            <span>
              {telemetryStatusInfo.state === 'ACTIVE'
                ? 'DOWNLINK ACTIVE (CX=ON)'
                : telemetryStatusInfo.state === 'STOPPED'
                ? 'DOWNLINK STOPPED (CX=OFF)'
                : 'DOWNLINK STATUS UNKNOWN'}
            </span>
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 font-mono-data text-xs">
          {/* View Mode Toggle: RAW vs DECODED */}
          <div className="flex bg-[var(--bg-base)] border border-[var(--border-subtle)] p-0.5 rounded-[var(--radius-xs)] text-[10px] font-semibold">
            <button
              type="button"
              onClick={() => setViewMode('raw')}
              className={`px-2 py-0.5 cursor-pointer rounded-[var(--radius-xs)] transition-colors flex items-center gap-1 ${
                viewMode === 'raw'
                  ? 'bg-[var(--action-amber)] text-black font-bold'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              <List className="w-3 h-3" />
              <span>RAW STREAM</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('decoded')}
              className={`px-2 py-0.5 cursor-pointer rounded-[var(--radius-xs)] transition-colors flex items-center gap-1 ${
                viewMode === 'decoded'
                  ? 'bg-[var(--accent-teal)] text-black font-bold'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              <Layers className="w-3 h-3" />
              <span>DECODED FIELDS ({decodedFields.length})</span>
            </button>
          </div>

          {/* Font Size Adjustment */}
          <div className="flex items-center bg-[var(--bg-base)] border border-[var(--border-subtle)] p-0.5 rounded-[var(--radius-xs)]">
            <button
              type="button"
              onClick={() => cycleFontSize('down')}
              title="Decrease Font Size"
              className="p-1 hover:bg-[var(--bg-surface-2)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded-[var(--radius-xs)] cursor-pointer"
            >
              <ZoomOut className="w-3 h-3" />
            </button>
            <span className="px-1.5 text-[9px] font-mono-data uppercase text-[var(--text-secondary)]">
              {fontSize}
            </span>
            <button
              type="button"
              onClick={() => cycleFontSize('up')}
              title="Increase Font Size"
              className="p-1 hover:bg-[var(--bg-surface-2)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded-[var(--radius-xs)] cursor-pointer"
            >
              <ZoomIn className="w-3 h-3" />
            </button>
          </div>

          {/* Copy Logs */}
          <button
            type="button"
            onClick={copyToClipboard}
            disabled={sourceScopedLogs.length === 0}
            title="Copy Telemetry Logs"
            aria-label="Copy Telemetry Logs"
            className="p-1.5 bg-[var(--bg-base)] hover:bg-[var(--bg-surface-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border-subtle)] rounded-[var(--radius-xs)] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-[var(--status-nominal)]" /> : <Copy className="w-3.5 h-3.5" />}
          </button>

          {/* Official CSV Export */}
          <button
            type="button"
            onClick={() => exportOfficialFlightCsv(historyPackets, telemetrySource)}
            disabled={historyPackets.length === 0}
            title={`Export official competition CSV (${OFFICIAL_FLIGHT_CSV_FILENAME}) per Section 6.3`}
            className="px-2 py-1 bg-[var(--status-nominal-bg)] hover:bg-[var(--status-nominal)] hover:text-white text-[var(--status-nominal)] border border-[var(--status-nominal)]/40 rounded-[var(--radius-xs)] cursor-pointer flex items-center gap-1 text-[10px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed tabular-nums"
          >
            <Download className="w-3 h-3" />
            <span>OFFICIAL CSV</span>
          </button>

          {/* Clear Buffer */}
          <button
            type="button"
            onClick={onClearLogs}
            disabled={sourceScopedLogs.length === 0}
            title="Clear Console Buffer"
            aria-label="Clear Console Buffer"
            className="p-1.5 bg-[var(--bg-base)] hover:bg-[var(--status-alert-bg)] text-[var(--status-alert)] border border-[var(--border-subtle)] rounded-[var(--radius-xs)] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Trash2 className="w-3 h-3" />
          </button>

          {/* Close Console */}
          <button
            type="button"
            onClick={onClose}
            title="Close Telemetry Console"
            aria-label="Close Telemetry Console"
            className="p-1.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer ml-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Telecommand Quick-Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 bg-[var(--bg-surface-elevated)] border-b border-[var(--border-subtle)] text-[11px] font-mono-data shrink-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[var(--text-tertiary)] font-bold text-[10px] uppercase">
            QUICK UPLINK:
          </span>

          <button
            type="button"
            onClick={() => handleSend('START')}
            disabled={Boolean(txPending)}
            title="Send 'START' command to enable flight telemetry downlink"
            className="px-2.5 py-1 bg-[var(--status-nominal-bg)] hover:bg-[var(--status-nominal)] hover:text-white text-[var(--status-nominal)] border border-[var(--status-nominal)]/50 rounded-[var(--radius-xs)] font-bold cursor-pointer transition-colors flex items-center gap-1 text-[10.5px] disabled:opacity-50"
          >
            <Play className="w-3 h-3 fill-current" />
            <span>START TELEMETRY</span>
          </button>

          <button
            type="button"
            onClick={() => handleSend('STOP')}
            disabled={Boolean(txPending)}
            title="Send 'STOP' command to halt flight telemetry downlink"
            className="px-2.5 py-1 bg-[var(--status-alert-bg)] hover:bg-[var(--status-alert)] hover:text-white text-[var(--status-alert)] border border-[var(--status-alert)]/50 rounded-[var(--radius-xs)] font-bold cursor-pointer transition-colors flex items-center gap-1 text-[10.5px] disabled:opacity-50"
          >
            <Square className="w-3 h-3 fill-current" />
            <span>STOP TELEMETRY</span>
          </button>

          <button
            type="button"
            onClick={() => handleSend('TARE')}
            disabled={Boolean(txPending)}
            title="Send 'TARE' command to zero yaw heading reference to 0.0°"
            className="px-2 py-1 bg-[var(--bg-surface-2)] hover:bg-[var(--bg-surface-hover)] text-[var(--text-primary)] border border-[var(--border-subtle)] rounded-[var(--radius-xs)] font-medium cursor-pointer transition-colors flex items-center gap-1 text-[10px] disabled:opacity-50"
          >
            <Compass className="w-3 h-3 text-[var(--accent-teal)]" />
            <span>TARE YAW</span>
          </button>

          <button
            type="button"
            onClick={() => handleSend('CAL')}
            disabled={Boolean(txPending)}
            title="Send 'CAL' command to execute bench accelerometer/gyro bias calibration"
            className="px-2 py-1 bg-[var(--bg-surface-2)] hover:bg-[var(--bg-surface-hover)] text-[var(--text-primary)] border border-[var(--border-subtle)] rounded-[var(--radius-xs)] font-medium cursor-pointer transition-colors flex items-center gap-1 text-[10px] disabled:opacity-50"
          >
            <RotateCcw className="w-3 h-3 text-[var(--action-amber)]" />
            <span>CALIB IMU</span>
          </button>

          <button
            type="button"
            onClick={() => {
              if (typeof targetLat === 'number' && typeof targetLon === 'number') {
                handleSend(`GPS:${targetLat.toFixed(6)},${targetLon.toFixed(6)}`);
              } else {
                setInputCommand('GPS:13.347500,74.792100');
              }
            }}
            disabled={Boolean(txPending)}
            title={
              typeof targetLat === 'number' && typeof targetLon === 'number'
                ? `Send 'GPS:${targetLat.toFixed(6)},${targetLon.toFixed(6)}' target uplink to CanSat`
                : "Pre-fill target coordinate uplink (e.g. GPS:13.347500,74.792100)"
            }
            className="px-2 py-1 bg-[var(--bg-surface-2)] hover:bg-[var(--bg-surface-hover)] text-[var(--accent-teal)] border border-[var(--border-subtle)] rounded-[var(--radius-xs)] font-medium cursor-pointer transition-colors flex items-center gap-1 text-[10px] disabled:opacity-50"
          >
            <Crosshair className="w-3 h-3 text-[var(--accent-teal)]" />
            <span>
              {typeof targetLat === 'number' && typeof targetLon === 'number'
                ? `GPS TGT (${targetLat.toFixed(4)}, ${targetLon.toFixed(4)})`
                : 'GPS TARGET'}
            </span>
          </button>
        </div>

        {/* Filter and Search controls */}
        {viewMode === 'raw' && (
          <div className="flex items-center gap-2">
            <div className="flex bg-[var(--bg-base)] border border-[var(--border-subtle)] p-0.5 rounded-[var(--radius-xs)] text-[9.5px]">
              {filterLabels.map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setFilterType(key)}
                  className={`px-2 py-0.5 uppercase cursor-pointer rounded-[var(--radius-xs)] transition-colors ${
                    filterType === key
                      ? 'bg-[var(--bg-surface-elevated)] text-[var(--action-amber)] font-bold'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="relative">
              <input
                type="text"
                placeholder="Filter logs..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-[var(--bg-base)] border border-[var(--border-subtle)] text-[10px] text-[var(--text-primary)] px-2 py-0.5 pl-5 rounded-[var(--radius-xs)] w-28 focus:w-36 focus:border-[var(--border-amber)] outline-none transition-all"
              />
              <Search className="w-2.5 h-2.5 text-[var(--text-tertiary)] absolute left-1.5 top-1.5 pointer-events-none" />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-1 top-0.5 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] cursor-pointer text-[10px]"
                >
                  &times;
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={() => setAutoScroll(!autoScroll)}
              title={autoScroll ? 'Auto-scroll enabled' : 'Auto-scroll paused'}
              className={`p-1 border rounded-[var(--radius-xs)] cursor-pointer ${
                autoScroll
                  ? 'bg-[var(--status-nominal-bg)] text-[var(--status-nominal)] border-[var(--status-nominal)]/40'
                  : 'bg-[var(--bg-base)] text-[var(--text-tertiary)] border-[var(--border-subtle)]'
              }`}
            >
              <ArrowDownCircle className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>

      {/* Main Content Area: Raw Stream vs Decoded Fields */}
      {viewMode === 'raw' ? (
        <div
          ref={consoleContainerRef}
          className={`flex-1 px-3 py-2 overflow-y-auto font-mono-data bg-[var(--bg-base)] select-text space-y-0.5 ${getFontSizeClasses()}`}
        >
          {filteredLogs.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center py-8 gap-1">
              <span className="text-[var(--text-secondary)] font-semibold text-xs uppercase">
                {sourceScopedLogs.length === 0
                  ? 'CONSOLE BUFFER EMPTY'
                  : `NO '${filterType.toUpperCase()}' LOG ENTRIES FOUND`}
              </span>
              <span className="text-[var(--text-tertiary)] text-[10px]">
                {sourceScopedLogs.length === 0
                  ? isSim
                    ? 'Awaiting simulated telemetry frames or local telecommand logs.'
                    : 'Awaiting incoming live LoRa / USB serial CSV frames. Click START TELEMETRY to enable downlink.'
                  : 'Reset filter or search query to inspect buffered records.'}
              </span>
            </div>
          ) : (
            filteredLogs.map((log, idx) => {
              const badgeText = getLogBadgeLabel(log, telemetrySource);
              const isAck = badgeText === 'SIM-ACK' || log.text.includes('ACK:');
              const isLiveRx = badgeText === 'LIVE-RX';
              const isLiveTx = badgeText === 'LIVE-TX' || badgeText === 'SIM-TX';
              const isErr = badgeText.endsWith('-ERR') || log.text.includes('[REJECTED:');

              const rowBg = isErr
                ? 'bg-[var(--status-alert-bg)]/60 border-[var(--status-alert)]/30'
                : isLiveTx
                ? 'bg-[var(--action-amber)]/10 border-[var(--border-amber)]/30'
                : isAck
                ? 'bg-[var(--status-nominal-bg)]/50 border-[var(--status-nominal)]/30'
                : 'hover:bg-[var(--bg-surface-1)] border-transparent';

              return (
                <div
                  key={idx}
                  className={`flex gap-2 items-baseline px-1.5 py-0.5 rounded-[var(--radius-xs)] border-b transition-colors ${rowBg}`}
                >
                  <span className="text-[var(--text-tertiary)] select-none text-[10px] min-w-[68px] shrink-0 tabular-nums">
                    {log.time}
                  </span>
                  <span
                    className={`text-[9px] font-bold uppercase px-1.5 py-0.2 min-w-[62px] text-center border rounded-[var(--radius-xs)] shrink-0 select-none ${
                      isErr
                        ? 'text-[var(--status-alert)] bg-[var(--status-alert-bg)] border-[var(--status-alert)]/50'
                        : isLiveTx
                        ? 'text-[var(--action-amber)] bg-[var(--status-warning-bg)] border-[var(--border-amber)]/50 font-bold'
                        : isAck
                        ? 'text-[var(--status-nominal)] bg-[var(--status-nominal-bg)] border-[var(--status-nominal)]/50 font-bold'
                        : isLiveRx
                        ? 'text-[var(--status-nominal)] bg-[var(--bg-surface-2)] border-[var(--border-subtle)]'
                        : 'text-[var(--text-secondary)] bg-[var(--bg-surface-2)] border-[var(--border-subtle)]'
                    }`}
                  >
                    {isAck && !badgeText.endsWith('ACK') ? 'FSW-ACK' : badgeText}
                  </span>
                  <span
                    className={`break-all min-w-0 font-mono-data ${
                      isErr
                        ? 'text-[var(--status-alert)] font-semibold'
                        : isLiveTx
                        ? 'text-[var(--action-amber)] font-bold'
                        : isAck
                        ? 'text-[var(--status-nominal)] font-semibold'
                        : isLiveRx
                        ? 'text-[var(--text-primary)]'
                        : 'text-[var(--text-secondary)]'
                    }`}
                  >
                    {log.text}
                  </span>
                </div>
              );
            })
          )}
        </div>
      ) : (
        /* Decoded Fields Structured Inspector */
        <div className="flex-1 p-3 overflow-y-auto bg-[var(--bg-base)]">
          {latestPacket ? (
            <div className="border border-[var(--border-subtle)] rounded-[var(--radius-sm)] overflow-hidden">
              <table className="w-full text-left font-mono-data text-xs border-collapse">
                <thead>
                  <tr className="bg-[var(--bg-surface-2)] border-b border-[var(--border-subtle)] text-[10px] text-[var(--text-tertiary)] uppercase font-bold">
                    <th className="py-1.5 px-3 w-10 text-center">#</th>
                    <th className="py-1.5 px-3">Telemetry Parameter</th>
                    <th className="py-1.5 px-3">Decoded Value</th>
                    <th className="py-1.5 px-3 w-16">Unit</th>
                    <th className="py-1.5 px-3 w-40">Sensor / Source</th>
                    <th className="py-1.5 px-3 w-36">Nature</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-muted)]/50">
                  {decodedFields.map((row) => {
                    const isMeasured = row.nature === 'MEASURED' || row.nature === 'MEASURED CLOCK';
                    const isDerived = row.nature.includes('DERIVED') || row.nature === 'DEAD-RECKONING';
                    const isState = row.nature === 'INTERNAL STATE';
                    return (
                      <tr
                        key={row.idx}
                        className="hover:bg-[var(--bg-surface-1)] transition-colors text-[11.5px]"
                      >
                        <td className="py-1 px-3 text-center text-[var(--text-tertiary)] tabular-nums font-semibold">
                          {row.idx}
                        </td>
                        <td className="py-1 px-3 text-[var(--text-primary)] font-bold">
                          {row.field}
                        </td>
                        <td className="py-1 px-3 text-[var(--accent-cobalt)] font-bold tabular-nums">
                          {row.value}
                        </td>
                        <td className="py-1 px-3 text-[var(--text-secondary)]">
                          {row.unit}
                        </td>
                        <td className="py-1 px-3 text-[var(--text-secondary)] text-[10.5px]">
                          {row.source}
                        </td>
                        <td className="py-1 px-3">
                          <span
                            className={`px-1.5 py-0.5 text-[9px] font-bold rounded border ${
                              isMeasured
                                ? 'bg-[var(--status-nominal-bg)] text-[var(--status-nominal)] border-[var(--status-nominal)]/40'
                                : isDerived
                                ? 'bg-[var(--accent-cobalt-bg)] text-[var(--accent-cobalt)] border-[var(--accent-cobalt)]/40'
                                : isState
                                ? 'bg-[var(--action-amber-bg)] text-[var(--action-amber)] border-[var(--action-amber)]/40'
                                : 'bg-[var(--bg-surface-2)] text-[var(--text-secondary)] border-[var(--border-subtle)]'
                            }`}
                          >
                            {row.nature}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center py-12 gap-1.5">
              <AlertCircle className="w-6 h-6 text-[var(--action-amber)]" />
              <span className="font-mono-data text-xs font-bold text-[var(--text-primary)] uppercase">
                Awaiting Telemetry Packet
              </span>
              <span className="font-mono-data text-[10px] text-[var(--text-tertiary)]">
                Connect USB serial and send START to populate real-time decoded fields.
              </span>
            </div>
          )}
        </div>
      )}

      {/* Telecommand Uplink Manual Form */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSend(inputCommand);
        }}
        className="flex flex-wrap sm:flex-nowrap items-center gap-2 px-3 py-2 bg-[var(--bg-surface-2)] border-t border-[var(--border-subtle)] shrink-0"
      >
        <div className="flex items-center gap-1.5 text-[var(--action-amber)] font-mono-data text-xs font-bold shrink-0">
          <span>UPLINK_CMD&gt;</span>
        </div>
        <input
          type="text"
          value={inputCommand}
          onChange={(e) => setInputCommand(e.target.value)}
          placeholder={
            isSim
              ? 'Enter command (e.g. START, STOP, GPS:13.347500,74.792100, TARE, CAL)'
              : 'Enter bridge telecommand (e.g. GPS:<lat>,<lon>, START, STOP, TARE, CAL) @ 115200 baud'
          }
          className="flex-1 min-w-[200px] bg-[var(--bg-base)] border border-[var(--border-subtle)] focus:border-[var(--border-amber)] text-[var(--text-primary)] font-mono-data text-xs px-2.5 py-1.5 outline-none rounded-[var(--radius-sm)]"
        />
        <button
          type="submit"
          disabled={!inputCommand.trim() || Boolean(txPending)}
          className="go-button font-mono-data text-xs font-bold px-3.5 py-1.5 uppercase cursor-pointer flex items-center gap-1.5 rounded-[var(--radius-sm)] disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
        >
          <Send className="w-3.5 h-3.5" />
          <span>{txPending ? 'SENDING...' : isSim ? 'SEND (SIM)' : 'TRANSMIT (TX)'}</span>
        </button>
      </form>
    </div>
  );
};
