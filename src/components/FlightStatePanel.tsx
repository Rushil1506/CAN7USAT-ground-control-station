import React, { useState } from 'react';
import { ChevronDown, Layers } from 'lucide-react';
import { FLIGHT_STATES } from '../constants';
import { FlightStateCode, TelemetryPacket, TelemetrySource } from '../types';

interface FlightStatePanelProps {
  latestPacket: TelemetryPacket | null;
  telemetrySource: TelemetrySource;
  isStale?: boolean;
  onOverrideState: (state: FlightStateCode | null) => void;
}

export const FlightStatePanel: React.FC<FlightStatePanelProps> = ({
  latestPacket,
  telemetrySource,
  isStale = false,
  onOverrideState,
}) => {
  const [overrideSelection, setOverrideSelection] = useState<'AUTO' | FlightStateCode>('AUTO');

  const isSim = telemetrySource === 'SIMULATION';

  const hasPacket = latestPacket !== null;
  const fswStateName =
    latestPacket && typeof latestPacket.fswStateName === 'string' && latestPacket.fswStateName.trim().length > 0
      ? latestPacket.fswStateName.trim()
      : null;

  const hasMappedStateCode =
    latestPacket !== null &&
    typeof latestPacket.stateCode === 'number' &&
    latestPacket.stateCode in FLIGHT_STATES;

  const currentStateCode = hasMappedStateCode ? latestPacket!.stateCode! : null;
  const stateInfo = currentStateCode !== null ? FLIGHT_STATES[currentStateCode] : null;

  const handleSelectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (!isSim) return;
    const val = e.target.value;
    if (val === 'AUTO') {
      setOverrideSelection('AUTO');
      onOverrideState(null);
    } else {
      const code = Number(val) as FlightStateCode;
      setOverrideSelection(code);
      onOverrideState(code);
    }
  };

  const handleStepClick = (code: FlightStateCode) => {
    if (!isSim) return;
    setOverrideSelection(code);
    onOverrideState(code);
  };

  const allStates = [
    FlightStateCode.BOOT,
    FlightStateCode.TEST_MODE,
    FlightStateCode.LAUNCH_PAD,
    FlightStateCode.ASCENT,
    FlightStateCode.ROCKET_DEPLOY,
    FlightStateCode.DESCENT,
    FlightStateCode.AEROBREAK_RELEASE,
    FlightStateCode.IMPACT,
  ];

  // Authoritative displayed label: use transmitted fswStateName in live serial, or stateInfo.label in simulation
  const displayedLabel = !isSim
    ? fswStateName ?? stateInfo?.label ?? 'UNAVAILABLE'
    : stateInfo?.label ?? fswStateName ?? 'UNAVAILABLE';

  const accentColor = stateInfo ? stateInfo.color : '#388BFD';

  return (
    <div className="ops-card p-3 select-none flex flex-col gap-2">
      {/* Header & Sim Override Selector */}
      <div className="flex justify-between items-center gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <Layers className="w-3.5 h-3.5 text-[var(--action-amber)] shrink-0" />
          <span className="font-mono-data text-[11px] font-bold text-[var(--text-primary)] uppercase tracking-wider truncate">
            FLIGHT STATE (FSW)
          </span>
        </div>

        {/* Sim State Selection Dropdown Override (Simulation Only) */}
        {isSim ? (
          <div className="relative shrink-0">
            <select
              aria-label="Simulated Flight Software State Override"
              value={overrideSelection === 'AUTO' ? 'AUTO' : String(overrideSelection)}
              onChange={handleSelectChange}
              className="bg-[var(--bg-surface-2)] border border-[var(--border-subtle)] focus:border-[var(--border-focus)] text-[var(--action-amber)] font-mono-data text-[10px] pl-2 pr-5 py-0.5 outline-none rounded-[var(--radius-xs)] cursor-pointer uppercase appearance-none h-6"
            >
              <option value="AUTO">SIM: AUTO TIMELINE</option>
              {Object.values(FLIGHT_STATES).map((st) => (
                <option key={st.code} value={st.code}>
                  SIM FORCE [{st.code}] {st.label.replace(/^\d+:\s*/, '')}
                </option>
              ))}
            </select>
            <ChevronDown className="w-3 h-3 text-[var(--text-secondary)] absolute right-1 top-1.5 pointer-events-none" />
          </div>
        ) : (
          <span
            className={`font-mono-data text-[9px] px-1.5 py-0.5 border rounded-[var(--radius-xs)] uppercase shrink-0 ${
              !hasPacket
                ? 'bg-[var(--bg-surface-2)] text-[var(--text-tertiary)] border-[var(--border-subtle)]'
                : isStale
                ? 'bg-[var(--status-warning-bg)] text-[var(--status-warning)] border-[var(--status-warning)]/40 font-bold'
                : 'bg-[var(--status-nominal-bg)] text-[var(--status-nominal)] border-[var(--status-nominal)]/40 font-bold'
            }`}
          >
            {!hasPacket ? 'AWAITING RX' : isStale ? 'STALE FSW' : 'LIVE FSW'}
          </span>
        )}
      </div>

      {/* Primary State Readout Banner */}
      {hasPacket && fswStateName !== null ? (
        <div
          className="flex flex-col justify-between border border-[var(--border-subtle)] bg-[var(--bg-base)] dot-matrix-bg rounded-[var(--radius-sm)] px-3 py-2.5 border-l-2"
          style={{ borderLeftColor: accentColor }}
        >
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="font-mono-data text-[10px] text-[var(--text-secondary)] uppercase tracking-wider tabular-nums">
              {stateInfo !== null ? `STATE CODE [${stateInfo.code}]` : 'RAW TRANSMITTER STATE (UNMAPPED)'}
            </span>
            <span className="font-mono-data text-[9px] px-1.5 py-0.5 bg-[var(--bg-surface-1)] text-[var(--text-tertiary)] border border-[var(--border-muted)] rounded-[var(--radius-xs)] uppercase">
              {isSim
                ? overrideSelection === 'AUTO'
                  ? 'SIM AUTO'
                  : 'SIM OVERRIDE'
                : isStale
                ? 'LAST RECEIVED (STALE)'
                : 'LIVE SERIAL'}
            </span>
          </div>

          <div
            className="font-mono-data text-sm sm:text-base font-bold tracking-wide leading-snug break-words"
            style={{ color: accentColor }}
          >
            {displayedLabel}
          </div>

          <div className="font-mono-data text-[10px] text-[var(--text-secondary)] mt-1 leading-relaxed">
            {stateInfo !== null
              ? !isSim && fswStateName !== FlightStateCode[stateInfo.code]
                ? `Transmitted '${fswStateName}' (mapped to ${stateInfo.label}) — ${stateInfo.description}`
                : stateInfo.description
              : `Transmitter reported FSW state '${fswStateName}' (no direct GCS 0–7 enum mapping).`}
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center border border-[var(--border-subtle)] bg-[var(--bg-base)] rounded-[var(--radius-sm)] px-3 py-4 text-center">
          <span className="font-mono-data text-xs font-bold text-[var(--status-alert)] uppercase">
            FSW STATE UNAVAILABLE
          </span>
          <span className="font-mono-data text-[10px] text-[var(--text-tertiary)] mt-0.5">
            {isSim
              ? 'Awaiting valid state from simulator'
              : 'No valid live serial telemetry packet received yet'}
          </span>
        </div>
      )}

      {/* Mission Phase Progression Bar (States 0 - 7) */}
      <div className="flex flex-col gap-1">
        <div className="flex justify-between items-center font-mono-data text-[9px] text-[var(--text-tertiary)]">
          <span>PHASE SEQUENCE (0–7)</span>
          <span>
            {currentStateCode !== null
              ? `STAGE ${currentStateCode + 1} OF 8`
              : fswStateName !== null
              ? `CUSTOM (${fswStateName})`
              : 'STANDBY'}
          </span>
        </div>
        <div className="grid grid-cols-8 gap-1">
          {allStates.map((code) => {
            const isCurrent = currentStateCode === code;
            const isPassed = currentStateCode !== null && currentStateCode > code;
            const st = FLIGHT_STATES[code];
            const stepClass = `h-5 font-mono-data text-[9px] tabular-nums transition-colors rounded-[var(--radius-xs)] border flex items-center justify-center ${
              isCurrent
                ? 'bg-[var(--action-amber)] text-[var(--action-amber-contrast)] border-[var(--border-amber)] font-bold'
                : isPassed
                ? 'bg-[var(--status-nominal-bg)] text-[var(--status-nominal)] border-[var(--status-nominal)]/40 font-semibold'
                : 'bg-[var(--bg-surface-2)] text-[var(--text-tertiary)] border-[var(--border-subtle)]'
            }`;
            // Live Serial: read-only phase indicator (not a button). Simulation: interactive force-state button.
            if (!isSim) {
              return (
                <div
                  key={code}
                  title={`Phase [${st.code}] ${st.label}: ${st.description}`}
                  className={stepClass}
                >
                  {code}
                </div>
              );
            }
            return (
              <button
                key={code}
                type="button"
                onClick={() => handleStepClick(code)}
                title={`Force Sim State [${st.code}] ${st.label}: ${st.description}`}
                className={`${stepClass} cursor-pointer hover:text-[var(--text-primary)]`}
              >
                {code}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
