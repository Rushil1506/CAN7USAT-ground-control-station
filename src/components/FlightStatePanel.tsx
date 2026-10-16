import React, { useState } from 'react';
import { ChevronDown, Layers } from 'lucide-react';
import { FLIGHT_STATES } from '../constants';
import { FlightStateCode, TelemetryPacket } from '../types';

interface FlightStatePanelProps {
  latestPacket: TelemetryPacket | null;
  onOverrideState: (state: FlightStateCode | null) => void;
}

export const FlightStatePanel: React.FC<FlightStatePanelProps> = ({
  latestPacket,
  onOverrideState,
}) => {
  const [overrideSelection, setOverrideSelection] = useState<'AUTO' | FlightStateCode>('AUTO');

  const hasValidState =
    latestPacket !== null &&
    typeof latestPacket.stateCode === 'number' &&
    latestPacket.stateCode in FLIGHT_STATES;

  const currentStateCode = hasValidState ? latestPacket!.stateCode : null;
  const stateInfo = currentStateCode !== null ? FLIGHT_STATES[currentStateCode] : null;

  const handleSelectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
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

  return (
    <div className="telemetry-panel panel-amber-accent p-2.5 select-none flex flex-col gap-2">
      {/* Header & Sim Override Selector */}
      <div className="flex justify-between items-center gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <Layers className="w-3.5 h-3.5 text-[var(--action-amber)] shrink-0" />
          <span className="font-mono-data text-[11px] font-bold text-[var(--text-primary)] uppercase tracking-wider truncate">
            FLIGHT STATE (FSW)
          </span>
        </div>

        {/* Sim State Selection Dropdown Override */}
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
      </div>

      {/* Primary State Readout Banner */}
      {stateInfo !== null && currentStateCode !== null ? (
        <div
          className="flex flex-col justify-between border border-[var(--border-subtle)] bg-[var(--bg-base)] dot-matrix-bg rounded-[var(--radius-sm)] px-3 py-2.5 border-l-2"
          style={{ borderLeftColor: stateInfo.color }}
        >
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="font-mono-data text-[10px] text-[var(--text-secondary)] uppercase tracking-wider tabular-nums">
              STATE CODE [{stateInfo.code}]
            </span>
            <span className="font-mono-data text-[9px] px-1.5 py-0.5 bg-[var(--bg-surface-1)] text-[var(--text-tertiary)] border border-[var(--border-muted)] rounded-[var(--radius-xs)] uppercase">
              {overrideSelection === 'AUTO' ? 'SIM AUTO' : 'SIM OVERRIDE'}
            </span>
          </div>

          <div
            className="font-mono-data text-sm sm:text-base font-bold tracking-wide leading-snug break-words"
            style={{ color: stateInfo.color }}
          >
            {stateInfo.label}
          </div>

          <div className="font-mono-data text-[10px] text-[var(--text-secondary)] mt-1 leading-relaxed">
            {stateInfo.description}
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center border border-[var(--border-subtle)] bg-[var(--bg-base)] rounded-[var(--radius-sm)] px-3 py-4 text-center">
          <span className="font-mono-data text-xs font-bold text-[var(--status-alert)] uppercase">
            FSW STATE UNAVAILABLE
          </span>
          <span className="font-mono-data text-[10px] text-[var(--text-tertiary)] mt-0.5">
            Awaiting valid stateCode from telemetry stream
          </span>
        </div>
      )}

      {/* Mission Phase Progression Bar (States 0 - 7) */}
      <div className="flex flex-col gap-1">
        <div className="flex justify-between items-center font-mono-data text-[9px] text-[var(--text-tertiary)]">
          <span>PHASE SEQUENCE (0–7)</span>
          <span>{currentStateCode !== null ? `STAGE ${currentStateCode + 1} OF 8` : 'STANDBY'}</span>
        </div>
        <div className="grid grid-cols-8 gap-1">
          {allStates.map((code) => {
            const isCurrent = currentStateCode === code;
            const isPassed = currentStateCode !== null && currentStateCode > code;
            const st = FLIGHT_STATES[code];
            return (
              <button
                key={code}
                type="button"
                onClick={() => handleStepClick(code)}
                title={`Force Sim State [${st.code}] ${st.label}: ${st.description}`}
                className={`h-5 font-mono-data text-[9px] tabular-nums transition-colors rounded-[var(--radius-xs)] cursor-pointer border flex items-center justify-center ${
                  isCurrent
                    ? 'bg-[var(--action-amber)] text-[var(--action-amber-contrast)] border-[var(--border-amber)] font-bold'
                    : isPassed
                    ? 'bg-[var(--status-nominal-bg)] text-[var(--status-nominal)] border-[var(--status-nominal)]/40 font-semibold'
                    : 'bg-[var(--bg-surface-2)] text-[var(--text-tertiary)] border-[var(--border-subtle)] hover:text-[var(--text-primary)]'
                }`}
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
