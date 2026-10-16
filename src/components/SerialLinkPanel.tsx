import React, { useState } from 'react';
import { Cable, Radio, AlertCircle } from 'lucide-react';
import { AVAILABLE_PORTS, BAUD_RATES } from '../constants';
import { SerialConfig } from '../types';

interface SerialLinkPanelProps {
  config: SerialConfig;
  onUpdateConfig: (newConfig: Partial<SerialConfig>) => void;
  onToggleConnect: () => void;
}

export const SerialLinkPanel: React.FC<SerialLinkPanelProps> = ({
  config,
  onUpdateConfig,
  onToggleConnect,
}) => {
  const [selectedPort, setSelectedPort] = useState<string>(AVAILABLE_PORTS[0]);
  const [baudRate, setBaudRate] = useState<number>(config.baudRate || 115200);

  const handleConnectToggle = () => {
    onUpdateConfig({ port: selectedPort, baudRate });
    onToggleConnect();
  };

  const rxCountDisplay = typeof config.rxCount === 'number' && Number.isFinite(config.rxCount) ? config.rxCount : null;
  const txCountDisplay = typeof config.txCount === 'number' && Number.isFinite(config.txCount) ? config.txCount : null;

  return (
    <div className="telemetry-panel panel-gray-accent p-2.5 select-none flex flex-col gap-2">
      {/* Header Row */}
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-1.5">
          <Cable className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
          <span className="font-mono-data text-[11px] font-bold text-[var(--text-primary)] uppercase tracking-wider">
            TELEMETRY LINK
          </span>
          <span className="font-mono-data text-[9px] px-1.5 py-0.5 bg-[var(--bg-surface-2)] text-[var(--status-info)] border border-[var(--border-subtle)] rounded-[var(--radius-xs)] uppercase">
            SIM LOOPBACK
          </span>
        </div>

        <span
          className={`font-mono-data text-[9px] px-1.5 py-0.5 uppercase font-bold border rounded-[var(--radius-xs)] ${
            config.connected
              ? 'bg-[var(--status-nominal-bg)] text-[var(--status-nominal)] border-[var(--status-nominal)]/40'
              : 'bg-[var(--bg-surface-2)] text-[var(--text-secondary)] border-[var(--border-subtle)]'
          }`}
        >
          {config.connected ? 'SIM STREAM ON' : 'SIM PAUSED'}
        </span>
      </div>

      {/* Hardware Provenance Notice */}
      <div className="flex items-center justify-between px-2 py-1 bg-[var(--bg-base)] border border-[var(--border-muted)] rounded-[var(--radius-xs)] font-mono-data text-[9px] text-[var(--text-secondary)]">
        <span className="flex items-center gap-1 text-[var(--text-tertiary)]">
          <AlertCircle className="w-3 h-3 text-[var(--action-amber)] shrink-0" />
          HW SERIAL UNVERIFIED
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
          aria-label="Baud Rate"
          value={baudRate}
          onChange={(e) => {
            const nextBaud = Number(e.target.value);
            setBaudRate(nextBaud);
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
          onClick={handleConnectToggle}
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
        <div className="text-[var(--text-tertiary)] tabular-nums">{baudRate} 8N1</div>
      </div>
    </div>
  );
};
