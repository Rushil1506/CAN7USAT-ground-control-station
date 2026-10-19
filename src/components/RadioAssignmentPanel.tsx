import React from 'react';
import { Info, Radio } from 'lucide-react';
import {
  RADIO_ASSIGNMENT_SOURCE,
  RADIO_OPERATING_CONSTRAINTS,
  TEAM_017_RADIO_ASSIGNMENT,
  formatHex,
} from '../radioConfig';

interface RadioAssignmentPanelProps {
  compact?: boolean;
}

const Row: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex justify-between gap-3 py-0.5">
    <span className="text-[var(--text-tertiary)]">{label}</span>
    <span className="text-[var(--text-primary)] font-semibold tabular-nums text-right">{value}</span>
  </div>
);

/**
 * Informational display of the Team 017 competition radio assignment.
 * Read-only: the browser GCS cannot read, verify, or configure radio hardware.
 */
export const RadioAssignmentPanel: React.FC<RadioAssignmentPanelProps> = ({ compact = false }) => {
  const { lora, xbee, autoShutdownMinutesAfterLaunchDetect } = TEAM_017_RADIO_ASSIGNMENT;

  return (
    <div
      className={`${compact ? '' : 'ops-card p-3.5'} flex flex-col gap-2.5 select-text`}
      data-testid="radio-assignment-panel"
    >
      <div className="flex items-center justify-between gap-2 flex-wrap border-b border-[var(--border-subtle)] pb-2">
        <div className="flex items-center gap-2">
          <Radio className="w-4 h-4 text-[var(--accent-cobalt)]" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-primary)]">
            Radio Configuration — Competition Assignment (Team 017)
          </h3>
        </div>
        <span className="font-mono-data text-[9px] px-1.5 py-0.5 border rounded-[var(--radius-xs)] uppercase bg-[var(--bg-surface-2)] text-[var(--text-secondary)] border-[var(--border-subtle)]">
          ASSIGNED CONFIGURATION · NOT HARDWARE-VERIFIED
        </span>
      </div>

      <div className={`grid gap-2.5 ${compact ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-2'}`}>
        <div className="bg-[var(--bg-surface-2)] border border-[var(--border-subtle)] rounded-[var(--radius-sm)] p-2.5 font-mono-data text-[11px]">
          <div className="text-[10px] font-bold uppercase text-[var(--accent-cobalt)] mb-1">
            LoRa — 868 MHz-band link
          </div>
          <Row label="Main frequency" value={`${lora.mainMHz.toFixed(2)} MHz`} />
          <Row label="Backup frequency" value={`${lora.backupMHz.toFixed(2)} MHz`} />
          <Row label="Spreading factor" value={`SF${lora.spreadingFactor}`} />
          <Row label="Bandwidth" value={`${lora.bandwidthKHz} kHz`} />
          <Row label="Coding rate" value={lora.codingRate} />
          <Row label="Sync word" value={formatHex(lora.syncWord)} />
          <Row label="Modulation" value={`${lora.modulation} (not FSK)`} />
          <Row
            label="TX power guidance"
            value={`+${lora.txPowerPadDbm} dBm pad / ~+${lora.txPowerFlightDbm} dBm flight`}
          />
        </div>

        <div className="bg-[var(--bg-surface-2)] border border-[var(--border-subtle)] rounded-[var(--radius-sm)] p-2.5 font-mono-data text-[11px]">
          <div className="text-[10px] font-bold uppercase text-[var(--accent-teal)] mb-1">
            XBee — 2.4 GHz link
          </div>
          <Row
            label="Main channel"
            value={`Channel ${xbee.mainChannel} (${xbee.mainMHz} MHz)`}
          />
          <Row
            label="Backup channel"
            value={`Channel ${xbee.backupChannel} (${xbee.backupMHz} MHz)`}
          />
          <Row label="PAN ID" value={formatHex(xbee.panId, 4)} />
          <Row label="Variant" value={xbee.variant} />
          <Row label="Mode" value={xbee.mode} />
        </div>
      </div>

      <ul className="text-[11px] leading-snug text-[var(--text-secondary)] list-disc pl-4 space-y-0.5">
        <li>Use the main channel by default; switch to backup only when Net Control instructs.</li>
        <li>Never transmit on an unassigned frequency.</li>
        <li>
          Competition rule: transmissions must shut off automatically{' '}
          {autoShutdownMinutesAfterLaunchDetect} min after launch detection (onboard requirement —
          not implemented or verified by this GCS).
        </li>
        <li>TX power values are guidance, subject to the competition document and applicable authorization.</li>
      </ul>

      <div className="flex items-start gap-1.5 text-[10px] text-[var(--text-tertiary)] leading-snug">
        <Info className="w-3 h-3 shrink-0 mt-0.5" />
        <span>
          Informational only. This browser GCS is receive-only and cannot read or configure the radios.
          Source: {RADIO_ASSIGNMENT_SOURCE}.
        </span>
      </div>
    </div>
  );
};

export { RADIO_OPERATING_CONSTRAINTS };
