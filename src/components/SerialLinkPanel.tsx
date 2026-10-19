import React, { useState } from 'react';
import { Cable, Radio, AlertCircle, Usb, ShieldAlert, Clock } from 'lucide-react';
import { AVAILABLE_PORTS, BAUD_RATES } from '../constants';
import { SerialConfig, SerialConnectionState, SerialMetrics, TelemetrySource } from '../types';

interface SerialLinkPanelProps {
  telemetrySource: TelemetrySource;
  onSelectSource: (source: TelemetrySource) => void;
  config: SerialConfig;
  onUpdateConfig: (newConfig: Partial<SerialConfig>) => void;
  onToggleConnect: () => void;
  serialState: SerialConnectionState;
  serialMetrics: SerialMetrics;
  liveBaudRate: number;
  onChangeLiveBaudRate: (baud: number) => void;
  onConnectLiveSerial: () => void;
  onDisconnectLiveSerial: () => void;
  isStale: boolean;
  packetAgeSeconds: number | null;
}

export const SerialLinkPanel: React.FC<SerialLinkPanelProps> = ({
  telemetrySource,
  onSelectSource,
  config,
  onUpdateConfig,
  onToggleConnect,
  serialState,
  serialMetrics,
  liveBaudRate,
  onChangeLiveBaudRate,
  onConnectLiveSerial,
  onDisconnectLiveSerial,
  isStale,
  packetAgeSeconds,
}) => {
  const [selectedPort, setSelectedPort] = useState<string>(AVAILABLE_PORTS[0]);
  const [simBaudRate, setSimBaudRate] = useState<number>(config.baudRate || 115200);

  const isSim = telemetrySource === 'SIMULATION';
  const isLiveConnected = serialState === 'CONNECTED';
  const isLiveConnecting = serialState === 'CONNECTING';

  const handleSimConnectToggle = () => {
    onUpdateConfig({ port: selectedPort, baudRate: simBaudRate });
    onToggleConnect();
  };

  const rxCountDisplay = typeof config.rxCount === 'number' && Number.isFinite(config.rxCount) ? config.rxCount : null;
  const txCountDisplay = typeof config.txCount === 'number' && Number.isFinite(config.txCount) ? config.txCount : null;

  return (
    <div className="ops-card p-3 select-none flex flex-col gap-2">
      {/* Header Row */}
      <div className="flex justify-between items-center gap-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <Cable className="w-3.5 h-3.5 text-[var(--text-secondary)] shrink-0" />
          <span className="font-mono-data text-[11px] font-bold text-[var(--text-primary)] uppercase tracking-wider truncate">
            TELEMETRY LINK
          </span>
          <span
            className={`font-mono-data text-[9px] px-1.5 py-0.5 border rounded-[var(--radius-xs)] uppercase shrink-0 ${
              isSim
                ? 'bg-[var(--bg-surface-2)] text-[var(--status-info)] border-[var(--border-subtle)]'
                : 'bg-[var(--bg-surface-elevated)] text-[var(--action-amber)] border-[var(--border-amber)]/60 font-bold'
            }`}
          >
            {isSim ? 'SIM LOOPBACK' : 'LIVE SERIAL'}
          </span>
        </div>

        {isSim ? (
          <span
            className={`font-mono-data text-[9px] px-1.5 py-0.5 uppercase font-bold border rounded-[var(--radius-xs)] shrink-0 ${
              config.connected
                ? 'bg-[var(--status-nominal-bg)] text-[var(--status-nominal)] border-[var(--status-nominal)]/40'
                : 'bg-[var(--bg-surface-2)] text-[var(--text-secondary)] border-[var(--border-subtle)]'
            }`}
          >
            {config.connected ? 'SIM STREAM ON' : 'SIM PAUSED'}
          </span>
        ) : (
          <span
            className={`font-mono-data text-[9px] px-1.5 py-0.5 uppercase font-bold border rounded-[var(--radius-xs)] shrink-0 ${
              isLiveConnected
                ? isStale
                  ? 'bg-[var(--status-warning-bg)] text-[var(--status-warning)] border-[var(--status-warning)]/40'
                  : 'bg-[var(--status-nominal-bg)] text-[var(--status-nominal)] border-[var(--status-nominal)]/40'
                : serialState === 'ERROR' || serialState === 'UNSUPPORTED'
                ? 'bg-[var(--status-alert-bg)] text-[var(--status-alert)] border-[var(--status-alert)]/40'
                : 'bg-[var(--bg-surface-2)] text-[var(--text-secondary)] border-[var(--border-subtle)]'
            }`}
          >
            {isLiveConnected ? (isStale ? 'CONNECTED (STALE)' : 'CONNECTED') : serialState}
          </span>
        )}
      </div>

      {/* Source Selector: SIMULATION vs LIVE SERIAL */}
      <div
        role="group"
        aria-label="Telemetry Data Source Selector"
        className="grid grid-cols-2 gap-1 p-0.5 bg-[var(--bg-base)] border border-[var(--border-subtle)] rounded-[var(--radius-sm)] font-mono-data text-[10px]"
      >
        <button
          type="button"
          onClick={() => onSelectSource('SIMULATION')}
          className={`py-1 px-2 rounded-[var(--radius-xs)] uppercase font-bold transition-colors cursor-pointer flex items-center justify-center gap-1 ${
            isSim
              ? 'bg-[var(--bg-surface-elevated)] text-[var(--status-info)] border border-[var(--status-info)]/50'
              : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-transparent'
          }`}
        >
          <Radio className="w-3 h-3" />
          <span>SIMULATION</span>
        </button>

        <button
          type="button"
          onClick={() => onSelectSource('LIVE_SERIAL')}
          className={`py-1 px-2 rounded-[var(--radius-xs)] uppercase font-bold transition-colors cursor-pointer flex items-center justify-center gap-1 ${
            !isSim
              ? 'bg-[var(--bg-surface-elevated)] text-[var(--action-amber)] border border-[var(--border-amber)]'
              : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-transparent'
          }`}
        >
          <Usb className="w-3 h-3" />
          <span>LIVE SERIAL</span>
        </button>
      </div>

      {isSim ? (
        <>
          {/* Simulation Hardware Provenance Notice */}
          <div className="flex items-center justify-between px-2 py-1 bg-[var(--bg-base)] border border-[var(--border-muted)] rounded-[var(--radius-xs)] font-mono-data text-[9px] text-[var(--text-secondary)]">
            <span className="flex items-center gap-1 text-[var(--text-tertiary)]">
              <AlertCircle className="w-3 h-3 text-[var(--action-amber)] shrink-0" />
              SYNTHETIC FLIGHT ENGINE
            </span>
            <span className="text-[var(--text-secondary)]">LOCAL SIMULATOR</span>
          </div>

          {/* Port & Baud Selectors + Toggle */}
          <div className="flex gap-1.5">
            <select
              aria-label="Target Serial Interface Profile"
              value={selectedPort}
              onChange={(e) => {
                setSelectedPort(e.target.value);
                onUpdateConfig({ port: e.target.value });
              }}
              disabled={config.connected}
              className="bg-[var(--bg-surface-2)] border border-[var(--border-subtle)] text-[var(--text-primary)] font-mono-data text-[11px] px-2 py-1 flex-1 min-w-0 focus:border-[var(--border-focus)] outline-none h-7 rounded-[var(--radius-sm)] cursor-pointer disabled:opacity-50 truncate"
            >
              {AVAILABLE_PORTS.map((port) => (
                <option key={port} value={port}>
                  {port}
                </option>
              ))}
            </select>

            <select
              aria-label="Simulation Baud Rate"
              value={simBaudRate}
              onChange={(e) => {
                const nextBaud = Number(e.target.value);
                setSimBaudRate(nextBaud);
                onUpdateConfig({ baudRate: nextBaud });
              }}
              disabled={config.connected}
              className="bg-[var(--bg-surface-2)] border border-[var(--border-subtle)] text-[var(--text-primary)] font-mono-data text-[11px] px-1.5 py-1 w-20 focus:border-[var(--border-focus)] outline-none h-7 rounded-[var(--radius-sm)] cursor-pointer disabled:opacity-50 hidden sm:block tabular-nums"
            >
              {BAUD_RATES.map((rate) => (
                <option key={rate} value={rate}>
                  {rate}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={handleSimConnectToggle}
              title={config.connected ? 'Pause Simulated Serial Stream' : 'Resume Simulated Serial Stream'}
              aria-label={config.connected ? 'Pause Simulated Serial Stream' : 'Resume Simulated Serial Stream'}
              className={`font-mono-data text-[10px] font-semibold px-2.5 h-7 border transition-colors cursor-pointer flex items-center justify-center gap-1 rounded-[var(--radius-sm)] shrink-0 ${
                config.connected
                  ? 'bg-[var(--status-alert-bg)] text-[var(--status-alert)] border-[var(--status-alert)]/40 hover:bg-[var(--status-alert)]/20'
                  : 'bg-[var(--bg-surface-elevated)] hover:bg-[var(--bg-surface-hover)] text-[var(--text-primary)] border-[var(--border-focus)]'
              }`}
            >
              <Radio className="w-3 h-3" />
              <span>{config.connected ? 'STOP' : 'LINK'}</span>
            </button>
          </div>

          {/* Simulated Link Rx/Tx Counters & Frame Format */}
          <div className="flex justify-between items-center px-2 py-1 bg-[var(--bg-base)] border border-[var(--border-subtle)] rounded-[var(--radius-xs)] text-[10px] font-mono-data text-[var(--text-secondary)]">
            <div className="flex items-center gap-1.5" title="Simulated Packets Received">
              <span className="text-[var(--text-tertiary)]">SIM RX:</span>
              <span className="text-[var(--status-nominal)] font-semibold tabular-nums">
                {rxCountDisplay !== null ? rxCountDisplay : '--'}
              </span>
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  config.connected ? 'bg-[var(--status-nominal)] active-link-indicator' : 'bg-[var(--text-tertiary)]'
                }`}
              />
            </div>
            <div className="flex items-center gap-1.5" title="Simulated Commands Logged">
              <span className="text-[var(--text-tertiary)]">SIM TX:</span>
              <span className="text-[var(--action-amber)] font-semibold tabular-nums">
                {txCountDisplay !== null ? txCountDisplay : '--'}
              </span>
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--action-amber)]/70" />
            </div>
            <div className="text-[var(--text-tertiary)] tabular-nums">{simBaudRate} 8N1</div>
          </div>
        </>
      ) : (
        <>
          {/* Live Hardware Port & Receive-Only Notice */}
          <div className="flex items-center justify-between px-2 py-1 bg-[var(--bg-base)] border border-[var(--border-muted)] rounded-[var(--radius-xs)] font-mono-data text-[9px] text-[var(--text-secondary)]">
            <span className="flex items-center gap-1 text-[var(--text-primary)] truncate">
              <Usb className="w-3 h-3 text-[var(--action-amber)] shrink-0" />
              <span className="truncate">{serialMetrics.portLabel ?? 'NO USB PORT OPEN'}</span>
            </span>
            <span className="text-[var(--text-tertiary)] shrink-0 ml-1">RX ONLY (NO TX)</span>
          </div>

          {/* Connect / Disconnect & Baud Rate Controls */}
          <div className="flex gap-1.5">
            <select
              aria-label="Live Serial Baud Rate"
              value={liveBaudRate}
              onChange={(e) => onChangeLiveBaudRate(Number(e.target.value))}
              disabled={isLiveConnected || isLiveConnecting}
              className="bg-[var(--bg-surface-2)] border border-[var(--border-subtle)] text-[var(--text-primary)] font-mono-data text-[11px] px-2 py-1 w-28 focus:border-[var(--border-focus)] outline-none h-7 rounded-[var(--radius-sm)] cursor-pointer disabled:opacity-50 tabular-nums"
            >
              {BAUD_RATES.map((rate) => (
                <option key={rate} value={rate}>
                  {rate} BAUD
                </option>
              ))}
            </select>

            {isLiveConnected ? (
              <button
                type="button"
                onClick={onDisconnectLiveSerial}
                className="flex-1 font-mono-data text-[10px] font-bold px-2.5 h-7 border transition-colors cursor-pointer flex items-center justify-center gap-1 rounded-[var(--radius-sm)] bg-[var(--status-alert-bg)] text-[var(--status-alert)] border-[var(--status-alert)]/50 hover:bg-[var(--status-alert)]/20 uppercase"
              >
                <Cable className="w-3 h-3" />
                <span>DISCONNECT USB</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={onConnectLiveSerial}
                disabled={isLiveConnecting || serialState === 'UNSUPPORTED'}
                className="flex-1 go-button font-mono-data text-[10px] font-bold px-2.5 h-7 border border-[var(--border-amber)] transition-colors cursor-pointer flex items-center justify-center gap-1 rounded-[var(--radius-sm)] uppercase disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Usb className="w-3 h-3" />
                <span>{isLiveConnecting ? 'OPENING PORT...' : 'CONNECT USB SERIAL'}</span>
              </button>
            )}
          </div>

          {/* Error / Unsupported Banner */}
          {serialMetrics.lastError && (
            <div className="flex items-start gap-1.5 px-2 py-1.5 bg-[var(--status-alert-bg)] border border-[var(--status-alert)]/40 rounded-[var(--radius-xs)] font-mono-data text-[9px] text-[var(--status-alert)] leading-snug">
              <ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span className="break-words">{serialMetrics.lastError}</span>
            </div>
          )}

          {/* Live Packet Timing (Computer Reception Time vs Packet GNSS Time-of-Day) & Staleness */}
          <div className="px-2 py-1 bg-[var(--bg-base)] border border-[var(--border-subtle)] rounded-[var(--radius-xs)] text-[9px] font-mono-data space-y-0.5">
            <div className="flex justify-between items-center">
              <div
                className="flex items-center gap-1 text-[var(--text-secondary)]"
                title="Computer packet-reception clock (UTC time-of-day when frame arrived over USB)"
              >
                <Clock className="w-3 h-3 text-[var(--text-tertiary)]" />
                <span>PC RX (UTC):</span>
                <span className="text-[var(--text-primary)] font-semibold tabular-nums">
                  {serialMetrics.lastValidPacketRxTime ?? 'NONE'}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[var(--text-tertiary)]">AGE:</span>
                <span
                  className={`font-bold tabular-nums ${
                    packetAgeSeconds === null
                      ? 'text-[var(--text-tertiary)]'
                      : isStale
                      ? 'text-[var(--status-warning)]'
                      : 'text-[var(--status-nominal)]'
                  }`}
                >
                  {packetAgeSeconds !== null ? `${packetAgeSeconds.toFixed(1)}s${isStale ? ' (STALE)' : ''}` : '--'}
                </span>
              </div>
            </div>
            <div
              className="flex justify-between items-center border-t border-[var(--border-muted)]/60 pt-0.5 text-[var(--text-tertiary)]"
              title="Transmitted NEO-M9N GNSS time-of-day only (no date transmitted in CSV)"
            >
              <span>
                GNSS UTC:{' '}
                <strong className="text-[var(--text-secondary)] tabular-nums">
                  {serialMetrics.lastValidPacketUtc ?? 'NONE'}
                </strong>
              </span>
              <span>
                IST:{' '}
                <strong className="text-[var(--action-amber)] tabular-nums">
                  {serialMetrics.lastValidPacketIst ?? 'NONE'}
                </strong>
              </span>
            </div>
          </div>

          {/* Live Serial Telemetry Counters */}
          <div className="grid grid-cols-4 gap-1 px-2 py-1 bg-[var(--bg-base)] border border-[var(--border-subtle)] rounded-[var(--radius-xs)] text-[9px] font-mono-data">
            <div title="Valid Parsed Telemetry Packets">
              <span className="text-[var(--text-tertiary)] block">VALID</span>
              <span className="text-[var(--status-nominal)] font-bold tabular-nums">
                {serialMetrics.validPacketsReceived}
              </span>
            </div>
            <div title="Malformed or Rejected Frames">
              <span className="text-[var(--text-tertiary)] block">MALFORM</span>
              <span
                className={`font-bold tabular-nums ${
                  serialMetrics.malformedPacketsReceived > 0
                    ? 'text-[var(--status-alert)]'
                    : 'text-[var(--text-secondary)]'
                }`}
              >
                {serialMetrics.malformedPacketsReceived}
              </span>
            </div>
            <div title="Complete Lines Received">
              <span className="text-[var(--text-tertiary)] block">LINES</span>
              <span className="text-[var(--text-primary)] font-semibold tabular-nums">
                {serialMetrics.completeLinesReceived}
              </span>
            </div>
            <div title="Raw USB Serial Bytes Received">
              <span className="text-[var(--text-tertiary)] block">BYTES</span>
              <span className="text-[var(--text-secondary)] font-semibold tabular-nums">
                {serialMetrics.rawBytesReceived}
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
