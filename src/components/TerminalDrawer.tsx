import React, { useState, useRef, useEffect } from 'react';
import { Terminal, Download, Trash2, Send, X, Copy, Check, ArrowDownCircle, AlertCircle } from 'lucide-react';
import { TelemetryPacket } from '../types';

interface TerminalDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  rawLogEntries: { time: string; text: string; type: 'rx' | 'tx' | 'sys' }[];
  historyPackets: TelemetryPacket[];
  onSendCommand: (cmd: string) => void;
  onClearLogs: () => void;
}

export const TerminalDrawer: React.FC<TerminalDrawerProps> = ({
  isOpen,
  onClose,
  rawLogEntries,
  historyPackets,
  onSendCommand,
  onClearLogs,
}) => {
  const [inputCommand, setInputCommand] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'rx' | 'tx' | 'sys'>('all');
  const [autoScroll, setAutoScroll] = useState<boolean>(true);
  const [copied, setCopied] = useState(false);
  const consoleContainerRef = useRef<HTMLDivElement | null>(null);
  const copyTimerRef = useRef<number | null>(null);

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
    if (!inputCommand.trim()) return;
    onSendCommand(inputCommand.trim());
    setInputCommand('');
  };

  const downloadCsvLog = () => {
    if (historyPackets.length === 0) return;
    const headers = [
      'PacketNumber',
      'MissionTimeSec',
      'TimestampUtc',
      'Altitude_m',
      'Velocity_ms',
      'Acceleration_ms2',
      'SpinRate_degs',
      'Roll_deg',
      'Pitch_deg',
      'Yaw_deg',
      'Latitude',
      'Longitude',
      'Temp_C',
      'Pressure_kPa',
      'Batt_V',
      'StateCode',
    ].join(',');

    const rows = historyPackets.map((p) =>
      [
        p.packetNumber,
        p.missionTimeSeconds,
        p.timestampUtc,
        p.altitude,
        p.velocity,
        p.acceleration,
        p.spinRate,
        p.roll,
        p.pitch,
        p.yaw,
        p.latitude,
        p.longitude,
        p.temperature,
        p.pressure,
        p.batteryVoltage,
        p.stateCode,
      ].join(',')
    );

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers, ...rows].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `CANSAT_SIM_TELEMETRY_LOG_${new Date().toISOString().slice(0, 19)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const copyToClipboard = () => {
    if (rawLogEntries.length === 0) return;
    const text = rawLogEntries.map((l) => `[${l.time}] [SIM-${l.type.toUpperCase()}] ${l.text}`).join('\n');
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

  const filterLabels: { key: 'all' | 'rx' | 'tx' | 'sys'; label: string }[] = [
    { key: 'all', label: 'ALL' },
    { key: 'rx', label: 'SIM RX' },
    { key: 'tx', label: 'SIM TX' },
    { key: 'sys', label: 'SYS' },
  ];

  return (
    <div
      role="region"
      aria-label="Simulated Telemetry and Command Log Drawer"
      className="fixed inset-x-0 bottom-0 z-50 bg-[var(--bg-surface-1)] border-t-2 border-[var(--border-amber)] shadow-2xl flex flex-col h-80 sm:h-96 select-none"
    >
      {/* Drawer Header */}
      <div className="flex flex-wrap justify-between items-center gap-2 px-3 py-2 bg-[var(--bg-surface-2)] border-b border-[var(--border-subtle)] shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Terminal className="w-4 h-4 text-[var(--action-amber)] shrink-0" />
          <span className="font-mono-data text-xs font-bold text-[var(--text-primary)] uppercase tracking-wider truncate">
            TELEMETRY & COMMAND LOG CONSOLE
          </span>
          <span className="font-mono-data text-[9px] text-[var(--status-info)] bg-[var(--bg-surface-1)] px-1.5 py-0.5 border border-[var(--border-subtle)] rounded-[var(--radius-xs)] uppercase shrink-0">
            SIMULATED STREAM | CSV FRAME
          </span>
          <span className="hidden md:inline-flex items-center gap-1 font-mono-data text-[9px] text-[var(--text-tertiary)] bg-[var(--bg-base)] px-1.5 py-0.5 border border-[var(--border-muted)] rounded-[var(--radius-xs)] shrink-0">
            <AlertCircle className="w-3 h-3 text-[var(--action-amber)]" />
            NO HARDWARE SERIAL LINK
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
            title="Export Simulated Telemetry History to CSV"
            className="px-2 py-1 bg-[var(--bg-surface-elevated)] hover:bg-[var(--bg-surface-hover)] text-[var(--action-amber)] border border-[var(--border-subtle)] rounded-[var(--radius-xs)] cursor-pointer flex items-center gap-1 text-[10px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed tabular-nums"
          >
            <Download className="w-3.5 h-3.5" />
            <span>EXPORT SIM CSV ({historyPackets.length})</span>
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
                ? 'Awaiting simulated telemetry frames or local command logs.'
                : 'Switch filter tab to ALL to view other buffered entries.'}
            </span>
          </div>
        ) : (
          filteredLogs.map((log, idx) => {
            const isAck = log.type === 'rx' && log.text.includes('ACK]');
            const badgeText =
              log.type === 'tx' ? 'SIM-TX' : log.type === 'sys' ? 'SYS' : isAck ? 'SIM-ACK' : 'SIM-RX';
            const badgeClass =
              log.type === 'tx'
                ? 'text-[var(--action-amber)] bg-[var(--status-warning-bg)] border-[var(--border-amber)]/40'
                : log.type === 'sys'
                ? 'text-[var(--status-info)] bg-[var(--status-info-bg)] border-[var(--status-info)]/40'
                : isAck
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
                  className={`text-[9px] font-bold uppercase px-1.5 py-0.2 min-w-[54px] text-center border rounded-[var(--radius-xs)] shrink-0 select-none ${badgeClass}`}
                >
                  {badgeText}
                </span>
                <span
                  className={`break-all min-w-0 ${
                    log.type === 'tx'
                      ? 'text-[var(--action-amber)] font-semibold'
                      : isAck
                      ? 'text-[var(--status-nominal)] font-medium'
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

      {/* Simulated Command Input Form */}
      <form
        onSubmit={handleSend}
        className="flex flex-wrap sm:flex-nowrap items-center gap-2 px-3 py-2 bg-[var(--bg-surface-2)] border-t border-[var(--border-subtle)] shrink-0"
      >
        <div className="flex items-center gap-1.5 text-[var(--action-amber)] font-mono-data text-xs font-bold shrink-0">
          <span>SIM_CMD&gt;</span>
        </div>
        <input
          type="text"
          value={inputCommand}
          onChange={(e) => setInputCommand(e.target.value)}
          placeholder="Enter command for local simulator (e.g. CMD,2026-INSPACe-CAN-7USAT-332,CALIBRATE,1)"
          className="flex-1 min-w-[200px] bg-[var(--bg-base)] border border-[var(--border-subtle)] focus:border-[var(--border-amber)] text-[var(--text-primary)] font-mono-data text-xs px-2.5 py-1.5 outline-none rounded-[var(--radius-sm)]"
        />
        <span className="hidden lg:inline-block font-mono-data text-[9px] text-[var(--text-tertiary)] shrink-0">
          LOCAL SIMULATOR ONLY (NO RF TX)
        </span>
        <button
          type="submit"
          disabled={!inputCommand.trim()}
          className="go-button font-mono-data text-xs font-bold px-3.5 py-1.5 uppercase cursor-pointer flex items-center gap-1.5 rounded-[var(--radius-sm)] disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
        >
          <Send className="w-3.5 h-3.5" />
          <span>SEND (SIM)</span>
        </button>
      </form>
    </div>
  );
};
