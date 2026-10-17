import React, { useState, useRef, useEffect } from 'react';
import { Terminal, Download, Trash2, Send, X, Copy, Check, ArrowDownCircle, AlertCircle, Lock } from 'lucide-react';
import { RawLogEntry, TelemetryPacket, TelemetrySource } from '../types';

interface TerminalDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  telemetrySource: TelemetrySource;
  rawLogEntries: RawLogEntry[];
  historyPackets: TelemetryPacket[];
  onSendCommand: (cmd: string) => void;
  onClearLogs: () => void;
}

function csvCell(val: string | number | boolean | null | undefined): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'number') return Number.isFinite(val) ? String(val) : '';
  return String(val);
}

export const TerminalDrawer: React.FC<TerminalDrawerProps> = ({
  isOpen,
  onClose,
  telemetrySource,
  rawLogEntries,
  historyPackets,
  onSendCommand,
  onClearLogs,
}) => {
  const [inputCommand, setInputCommand] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'rx' | 'tx' | 'sys' | 'err'>('all');
  const [autoScroll, setAutoScroll] = useState<boolean>(true);
  const [copied, setCopied] = useState(false);
  const consoleContainerRef = useRef<HTMLDivElement | null>(null);
  const copyTimerRef = useRef<number | null>(null);

  const isSim = telemetrySource === 'SIMULATION';

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (isOpen && autoScroll && consoleContainerRef.current) {
      consoleContainerRef.current.scrollTop = consoleContainerRef.current.scrollHeight;
    }
  }, [rawLogEntries.length, isOpen, autoScroll, filterType]);

  if (!isOpen) return null;

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isSim || !inputCommand.trim()) return;
    onSendCommand(inputCommand.trim());
    setInputCommand('');
  };

  const downloadCsvLog = () => {
    if (historyPackets.length === 0) return;
    const headers = [
      'Source',
      'TeamId',
      'MissionTimeSec',
      'PacketNumber',
      'Altitude_m',
      'Pressure_Pa',
      'Pressure_hPa',
      'Temp_C',
      'Batt_V',
      'GnssTime_UTC',
      'GnssTime_IST',
      'ComputerRxTime_UTC',
      'Latitude',
      'Longitude',
      'GpsAltitude_m',
      'GpsSats',
      'GpsFixType',
      'AccelX',
      'AccelY',
      'AccelZ',
      'Roll_deg',
      'Pitch_deg',
      'SpinRate_degs',
      'FswStateName',
      'MappedStateCode',
      'Velocity_ms',
      'Yaw_deg',
      'WheelRpm',
      'CO2_ppm',
      'PM2_5_ugm3',
      'UV_Index',
      'Humidity_RH',
      'Current_A',
      'Power_W',
    ].join(',');

    const rows = historyPackets.map((p) =>
      [
        csvCell(p.source ?? telemetrySource),
        csvCell(p.teamId),
        csvCell(p.missionTimeSeconds),
        csvCell(p.packetNumber),
        csvCell(p.altitude),
        csvCell(p.rawPressurePa),
        csvCell(p.pressure),
        csvCell(p.temperature),
        csvCell(p.batteryVoltage),
        csvCell(p.timestampUtc),
        csvCell(p.gnssTimeIst),
        csvCell(p.receivedAtTimeStr),
        csvCell(p.latitude),
        csvCell(p.longitude),
        csvCell(p.gpsAltitude),
        csvCell(p.gpsSats),
        csvCell(p.gpsFixType),
        csvCell(p.accelX),
        csvCell(p.accelY),
        csvCell(p.accelZ),
        csvCell(p.roll),
        csvCell(p.pitch),
        csvCell(p.spinRate),
        csvCell(p.fswStateName),
        csvCell(p.stateCode),
        csvCell(p.velocity),
        csvCell(p.yaw),
        csvCell(p.wheelRpm),
        csvCell(p.co2),
        csvCell(p.pm2_5),
        csvCell(p.uv),
        csvCell(p.humidity),
        csvCell(p.currentDraw),
        csvCell(p.power),
      ].join(',')
    );

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers, ...rows].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    const prefix = isSim ? 'CANSAT_SIM_TELEMETRY_LOG' : 'CANSAT_LIVE_SERIAL_LOG';
    link.setAttribute('download', `${prefix}_${new Date().toISOString().slice(0, 19)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const getBadgeLabel = (log: RawLogEntry): string => {
    const entryIsSim = (log.source ?? telemetrySource) === 'SIMULATION';
    if (log.type === 'err') return 'RX-ERR';
    if (log.type === 'sys') return 'SYS';
    if (entryIsSim) {
      if (log.type === 'tx') return 'SIM-TX';
      if (log.type === 'rx' && log.text.includes('ACK]')) return 'SIM-ACK';
      return 'SIM-RX';
    }
    return log.type === 'tx' ? 'TX' : 'RX';
  };

  const copyToClipboard = () => {
    if (rawLogEntries.length === 0) return;
    const text = rawLogEntries.map((l) => `[${l.time}] [${getBadgeLabel(l)}] ${l.text}`).join('\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    if (copyTimerRef.current !== null) {
      window.clearTimeout(copyTimerRef.current);
    }
    copyTimerRef.current = window.setTimeout(() => setCopied(false), 2000);
  };

  const filteredLogs = rawLogEntries.filter((l) => {
    if (filterType === 'all') return true;
    return l.type === filterType;
  });

  const filterLabels: { key: 'all' | 'rx' | 'tx' | 'sys' | 'err'; label: string }[] = [
    { key: 'all', label: 'ALL' },
    { key: 'rx', label: isSim ? 'SIM RX' : 'RX' },
    { key: 'err', label: 'ERR' },
    { key: 'tx', label: 'SIM TX' },
    { key: 'sys', label: 'SYS' },
  ];

  return (
    <div
      role="region"
      aria-label="Telemetry and Command Log Drawer"
      className="fixed inset-x-0 bottom-0 z-50 bg-[var(--bg-surface-1)] border-t-2 border-[var(--border-amber)] shadow-2xl flex flex-col h-80 sm:h-96 select-none"
    >
      {/* Drawer Header */}
      <div className="flex flex-wrap justify-between items-center gap-2 px-3 py-2 bg-[var(--bg-surface-2)] border-b border-[var(--border-subtle)] shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Terminal className="w-4 h-4 text-[var(--action-amber)] shrink-0" />
          <span className="font-mono-data text-xs font-bold text-[var(--text-primary)] uppercase tracking-wider truncate">
            TELEMETRY &amp; COMMAND LOG CONSOLE
          </span>
          <span
            className={`font-mono-data text-[9px] px-1.5 py-0.5 border rounded-[var(--radius-xs)] uppercase shrink-0 ${
              isSim
                ? 'text-[var(--status-info)] bg-[var(--bg-surface-1)] border-[var(--border-subtle)]'
                : 'text-[var(--action-amber)] bg-[var(--bg-surface-elevated)] border-[var(--border-amber)]/60 font-bold'
            }`}
          >
            {isSim ? 'SIMULATED STREAM | CSV FRAME' : 'LIVE USB SERIAL | 115200 8N1'}
          </span>
          <span className="hidden md:inline-flex items-center gap-1 font-mono-data text-[9px] text-[var(--text-tertiary)] bg-[var(--bg-base)] px-1.5 py-0.5 border border-[var(--border-muted)] rounded-[var(--radius-xs)] shrink-0">
            <AlertCircle className="w-3 h-3 text-[var(--action-amber)]" />
            {isSim ? 'SIMULATOR LOOPBACK' : 'RECEIVE-ONLY (NO HW TX)'}
          </span>
        </div>

        <div className="flex items-center gap-1.5 font-mono-data text-xs">
          {/* Source / Severity Filter */}
          <div className="flex bg-[var(--bg-base)] border border-[var(--border-subtle)] p-0.5 rounded-[var(--radius-xs)] text-[10px]">
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

          {/* Auto-Scroll Lock Toggle */}
          <button
            type="button"
            onClick={() => setAutoScroll(!autoScroll)}
            title={autoScroll ? 'Auto-scroll enabled (click to pause)' : 'Auto-scroll paused (click to follow latest)'}
            className={`px-2 py-1 border rounded-[var(--radius-xs)] cursor-pointer flex items-center gap-1 text-[10px] transition-colors ${
              autoScroll
                ? 'bg-[var(--bg-surface-elevated)] text-[var(--status-nominal)] border-[var(--status-nominal)]/40 font-semibold'
                : 'bg-[var(--bg-base)] text-[var(--text-tertiary)] border-[var(--border-subtle)] hover:text-[var(--text-primary)]'
            }`}
          >
            <ArrowDownCircle className="w-3 h-3" />
            <span className="hidden sm:inline">{autoScroll ? 'FOLLOW' : 'PAUSED'}</span>
          </button>

          {/* Copy Logs */}
          <button
            type="button"
            onClick={copyToClipboard}
            disabled={rawLogEntries.length === 0}
            title="Copy All Log Entries"
            aria-label="Copy All Log Entries"
            className="p-1.5 bg-[var(--bg-base)] hover:bg-[var(--bg-surface-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border-subtle)] rounded-[var(--radius-xs)] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-[var(--status-nominal)]" /> : <Copy className="w-3.5 h-3.5" />}
          </button>

          {/* Export CSV */}
          <button
            type="button"
            onClick={downloadCsvLog}
            disabled={historyPackets.length === 0}
            title="Export Telemetry History to CSV (absent fields left blank)"
            className="px-2 py-1 bg-[var(--bg-surface-elevated)] hover:bg-[var(--bg-surface-hover)] text-[var(--action-amber)] border border-[var(--border-subtle)] rounded-[var(--radius-xs)] cursor-pointer flex items-center gap-1 text-[10px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed tabular-nums"
          >
            <Download className="w-3.5 h-3.5" />
            <span>
              EXPORT {isSim ? 'SIM' : 'LIVE'} CSV ({historyPackets.length})
            </span>
          </button>

          {/* Clear Terminal */}
          <button
            type="button"
            onClick={onClearLogs}
            disabled={rawLogEntries.length === 0}
            title="Clear Terminal Buffer"
            aria-label="Clear Terminal Buffer"
            className="p-1.5 bg-[var(--bg-base)] hover:bg-[var(--status-alert-bg)] text-[var(--status-alert)] border border-[var(--border-subtle)] rounded-[var(--radius-xs)] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>

          {/* Close Drawer */}
          <button
            type="button"
            onClick={onClose}
            title="Close Terminal Drawer"
            aria-label="Close Terminal Drawer"
            className="p-1.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer ml-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Terminal Output Console */}
      <div
        ref={consoleContainerRef}
        className="flex-1 px-3 py-2 overflow-y-auto font-mono-data text-[11px] text-[var(--text-primary)] space-y-0.5 bg-[var(--bg-base)] select-text"
      >
        {filteredLogs.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center py-8 gap-1">
            <span className="text-[var(--text-secondary)] font-semibold text-xs uppercase">
              {rawLogEntries.length === 0 ? 'TERMINAL BUFFER EMPTY' : `NO '${filterType.toUpperCase()}' LOG ENTRIES`}
            </span>
            <span className="text-[var(--text-tertiary)] text-[10px]">
              {rawLogEntries.length === 0
                ? isSim
                  ? 'Awaiting simulated telemetry frames or local command logs.'
                  : 'Awaiting incoming live USB serial CSV frames.'
                : 'Switch filter tab to ALL to view other buffered entries.'}
            </span>
          </div>
        ) : (
          filteredLogs.map((log, idx) => {
            const badgeText = getBadgeLabel(log);
            const isAck = badgeText === 'SIM-ACK';
            const isLiveRx = badgeText === 'RX';
            const isErr = badgeText === 'RX-ERR';

            const badgeClass = isErr
              ? 'text-[var(--status-alert)] bg-[var(--status-alert-bg)] border-[var(--status-alert)]/40'
              : log.type === 'tx'
              ? 'text-[var(--action-amber)] bg-[var(--status-warning-bg)] border-[var(--border-amber)]/40'
              : log.type === 'sys'
              ? 'text-[var(--status-info)] bg-[var(--status-info-bg)] border-[var(--status-info)]/40'
              : isAck || isLiveRx
              ? 'text-[var(--status-nominal)] bg-[var(--status-nominal-bg)] border-[var(--status-nominal)]/40'
              : 'text-[var(--text-secondary)] bg-[var(--bg-surface-2)] border-[var(--border-subtle)]';

            return (
              <div
                key={idx}
                className="flex gap-2 items-baseline leading-relaxed hover:bg-[var(--bg-surface-1)] px-1.5 py-0.5 rounded-[var(--radius-xs)] border-b border-[var(--border-muted)]/40"
              >
                <span className="text-[var(--text-tertiary)] select-none text-[10px] min-w-[68px] shrink-0 tabular-nums">
                  {log.time}
                </span>
                <span
                  className={`text-[9px] font-bold uppercase px-1.5 py-0.2 min-w-[56px] text-center border rounded-[var(--radius-xs)] shrink-0 select-none ${badgeClass}`}
                >
                  {badgeText}
                </span>
                <span
                  className={`break-all min-w-0 ${
                    isErr
                      ? 'text-[var(--status-alert)]'
                      : log.type === 'tx'
                      ? 'text-[var(--action-amber)] font-semibold'
                      : isAck
                      ? 'text-[var(--status-nominal)] font-medium'
                      : isLiveRx
                      ? 'text-[var(--text-primary)]'
                      : log.type === 'sys'
                      ? 'text-[var(--status-info)]'
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

      {/* Command Input Form (Restricted to Simulation Mode) */}
      <form
        onSubmit={handleSend}
        className="flex flex-wrap sm:flex-nowrap items-center gap-2 px-3 py-2 bg-[var(--bg-surface-2)] border-t border-[var(--border-subtle)] shrink-0"
      >
        <div className="flex items-center gap-1.5 text-[var(--action-amber)] font-mono-data text-xs font-bold shrink-0">
          {isSim ? (
            <span>SIM_CMD&gt;</span>
          ) : (
            <span className="flex items-center gap-1 text-[var(--text-tertiary)]">
              <Lock className="w-3.5 h-3.5 text-[var(--status-alert)]" />
              RX_ONLY&gt;
            </span>
          )}
        </div>
        <input
          type="text"
          value={inputCommand}
          disabled={!isSim}
          onChange={(e) => setInputCommand(e.target.value)}
          placeholder={
            isSim
              ? 'Enter command for local simulator (e.g. CMD,2026-INSPACe-CAN-7USAT-332,CALIBRATE,1)'
              : 'Hardware telecommand transmission is disabled in Live Serial receive-only mode'
          }
          className="flex-1 min-w-[200px] bg-[var(--bg-base)] border border-[var(--border-subtle)] focus:border-[var(--border-amber)] text-[var(--text-primary)] font-mono-data text-xs px-2.5 py-1.5 outline-none rounded-[var(--radius-sm)] disabled:opacity-50 disabled:cursor-not-allowed"
        />
        <span className="hidden lg:inline-block font-mono-data text-[9px] text-[var(--text-tertiary)] shrink-0">
          {isSim ? 'LOCAL SIMULATOR ONLY (NO RF TX)' : 'SERIAL TX DISABLED'}
        </span>
        <button
          type="submit"
          disabled={!isSim || !inputCommand.trim()}
          className="go-button font-mono-data text-xs font-bold px-3.5 py-1.5 uppercase cursor-pointer flex items-center gap-1.5 rounded-[var(--radius-sm)] disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
        >
          <Send className="w-3.5 h-3.5" />
          <span>{isSim ? 'SEND (SIM)' : 'TX LOCKED'}</span>
        </button>
      </form>
    </div>
  );
};
