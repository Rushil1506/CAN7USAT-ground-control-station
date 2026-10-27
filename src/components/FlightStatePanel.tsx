import React from 'react';
import {
  CheckCircle2,
  Cpu,
  Navigation,
  ShieldAlert,
  Volume2,
  Zap,
} from 'lucide-react';
import { FlightStateCode, TelemetryPacket, TelemetrySource } from '../types';
import { FIRMWARE_FLIGHT_STATES, FLIGHT_STATES } from '../constants';

interface FlightStatePanelProps {
  latestPacket: TelemetryPacket | null;
  telemetrySource?: TelemetrySource;
  isStale?: boolean;
  onOverrideState?: (state: FlightStateCode) => void;
}

export const FlightStatePanel: React.FC<FlightStatePanelProps> = ({
  latestPacket,
  telemetrySource = 'SIMULATION',
  isStale = false,
  onOverrideState,
}) => {
  const isSim = telemetrySource === 'SIMULATION';
  const hasPacket = latestPacket !== null;
  const currentCode = latestPacket ? latestPacket.stateCode : null;
  const currentFswIndex =
    latestPacket && typeof latestPacket.fswStateIndex === 'number'
      ? latestPacket.fswStateIndex
      : currentCode !== null
      ? FIRMWARE_FLIGHT_STATES.find((s) => s.stateCode === currentCode)?.fswIndex ?? null
      : null;

  const currentFswStateInfo =
    currentFswIndex !== null
      ? FIRMWARE_FLIGHT_STATES.find((s) => s.fswIndex === currentFswIndex) ?? null
      : null;

  const currentLegacyStateInfo =
    currentCode !== null ? FLIGHT_STATES[currentCode] : null;

  const isUnmappedState = hasPacket && currentCode === null;

  const burnwireActive =
    typeof latestPacket?.burnwireActive === 'boolean' ? latestPacket.burnwireActive : null;
  const buzzerActive =
    typeof latestPacket?.buzzerMosfet === 'boolean'
      ? latestPacket.buzzerMosfet
      : typeof latestPacket?.audioBeaconActive === 'boolean'
      ? latestPacket.audioBeaconActive
      : null;
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

  return (
    <div className="ops-card p-3 flex flex-col justify-between w-full min-w-0 select-none">
      {/* Header */}
      <div className="flex justify-between items-center border-b border-[var(--border-subtle)] pb-2 mb-2.5">
        <div className="flex items-center gap-2">
          <Cpu className="w-4 h-4 text-[var(--accent-cobalt)]" />
          <span className="text-xs font-bold text-[var(--text-primary)] tracking-tight">
            Flight Software State Machine (FSW)
          </span>
        </div>
        <span className="font-mono-data text-[11px] font-semibold px-2 py-0.5 bg-[var(--bg-surface-2)] text-[var(--text-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-xs)]">
          {!hasPacket
            ? 'STANDBY'
            : isUnmappedState
            ? 'UNMAPPED STATE'
            : currentFswIndex !== null
            ? `FSW STATE 0${currentFswIndex}`
            : `STATE 0${currentCode}`}
        </span>
      </div>

      {/* Active State Banner */}
      {!hasPacket ? (
        <div className="p-3 mb-2.5 border border-[var(--border-subtle)] bg-[var(--bg-surface-2)] rounded-[var(--radius-sm)] text-center space-y-1">
          <div className="font-mono-data text-xs font-bold text-[var(--text-secondary)]">
            AWAITING TELEMETRY STREAM
          </div>
          <p className="text-[11px] text-[var(--text-tertiary)]">
            {isSim
              ? 'Simulator paused or initializing.'
              : 'Connect USB Serial receiver (115200 8N1) and ensure FSW telemetry is started (START command).'}
          </p>
        </div>
      ) : currentFswStateInfo || currentLegacyStateInfo ? (
        <div
          className="p-3 mb-2.5 border transition-all rounded-[var(--radius-sm)]"
          style={{
            borderColor: (currentFswStateInfo ?? currentLegacyStateInfo)!.color,
            backgroundColor: (currentFswStateInfo ?? currentLegacyStateInfo)!.bgGlow,
          }}
        >
          <div className="flex justify-between items-center mb-1 gap-2">
            <span
              className="font-mono-data text-sm font-bold tracking-tight"
              style={{ color: (currentFswStateInfo ?? currentLegacyStateInfo)!.color }}
            >
              {currentFswStateInfo ? currentFswStateInfo.label : currentLegacyStateInfo!.label}
            </span>
            <span className="text-[10px] font-mono-data uppercase px-1.5 py-0.5 bg-[var(--bg-surface-1)] text-[var(--text-primary)] border border-[var(--border-subtle)] font-semibold rounded-[var(--radius-xs)]">
              WIRE: {latestPacket.fswStateName}
            </span>
          </div>
          <p className="text-xs text-[var(--text-primary)] leading-snug font-medium">
            {(currentFswStateInfo ?? currentLegacyStateInfo)!.description}
          </p>
          {currentFswStateInfo && (
            <div className="mt-1 text-[10px] font-mono-data text-[var(--text-secondary)]">
              Enum: <strong>FlightState::{currentFswStateInfo.enumName}</strong> • Exit:{' '}
              {currentFswStateInfo.transitionRule}
            </div>
          )}
        </div>
      ) : (
        <div
          role="alert"
          data-testid="unmapped-fsw-state-banner"
          className="p-3 mb-2.5 border border-[var(--status-warning)] bg-[var(--status-warning-bg)] rounded-[var(--radius-sm)]"
        >
          <div className="flex justify-between items-center mb-1">
            <span className="font-mono-data text-sm font-bold text-[var(--status-warning)] flex items-center gap-1.5">
              <ShieldAlert className="w-4 h-4 shrink-0" />
              <span>RAW FSW STATE: {latestPacket.fswStateName}</span>
            </span>
            <span className="text-[10px] font-mono-data uppercase px-1.5 py-0.5 bg-[var(--bg-surface-1)] text-[var(--status-warning)] border border-[var(--status-warning)]/40 font-semibold rounded-[var(--radius-xs)]">
              UNKNOWN / UNMAPPED
            </span>
          </div>
          <p className="text-xs text-[var(--text-primary)] leading-snug font-medium">
            Transmitter reported state &lsquo;{latestPacket.fswStateName}&rsquo;, which is not mapped to a known FlightState enum phase. Displaying raw wire value without inference.
          </p>
        </div>
      )}

      {/* 10-State CAN7USAT_FSW Sequence Stepper (nav_types.h 0..9) */}
      <div className="flex-1 overflow-y-auto space-y-1 pr-1 max-h-56">
        {FIRMWARE_FLIGHT_STATES.map((state) => {
          const isCompleted =
            currentFswIndex !== null && state.fswIndex < currentFswIndex;
          const isCurrent =
            currentFswIndex !== null && state.fswIndex === currentFswIndex;

          return (
            <div
              key={state.fswIndex}
              onClick={() => {
                if (isSim && onOverrideState) {
                  onOverrideState(state.stateCode);
                }
              }}
              className={`flex items-center justify-between px-2.5 py-1.5 border text-xs transition-all rounded-[var(--radius-xs)] ${
                isSim && onOverrideState ? 'cursor-pointer' : ''
              } ${
                isCurrent
                  ? 'bg-[var(--status-info-bg)] border-[var(--accent-cobalt)] text-[var(--text-primary)] font-semibold shadow-[var(--shadow-xs)]'
                  : isCompleted
                  ? 'bg-[var(--bg-surface-2)]/60 border-[var(--border-subtle)] text-[var(--text-secondary)]'
                  : 'bg-[var(--bg-surface-1)] border-transparent text-[var(--text-tertiary)]'
              }`}
              title={`Enum: FlightState::${state.enumName} (${state.fswIndex}) | Wire: ${state.wireName} | Rule: ${state.transitionRule}${isStale ? ' (STALE)' : ''}`}
            >
              <div className="flex items-center gap-2 min-w-0">
                {isCompleted ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-[var(--status-nominal)] shrink-0" />
                ) : isCurrent ? (
                  <span className="w-2.5 h-2.5 rounded-full bg-[var(--accent-cobalt)] shrink-0" />
                ) : (
                  <span className="w-2 h-2 rounded-full bg-[var(--border-strong)] shrink-0 ml-0.5" />
                )}
                <span className="font-mono-data text-[11px] truncate">
                  {state.label}
                </span>
                {state.enumName !== state.wireName && (
                  <span className="text-[9px] font-mono-data text-[var(--text-tertiary)] truncate hidden sm:inline">
                    ({state.enumName})
                  </span>
                )}
              </div>

              {isCurrent && (
                <span className="text-[10px] font-mono-data text-[var(--accent-cobalt)] uppercase font-bold shrink-0">
                  ACTIVE
                </span>
              )}
              {isCompleted && (
                <span className="text-[10px] font-mono-data text-[var(--status-nominal)] font-medium shrink-0">
                  DONE
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Hardware Actuator & Recovery Subsystems Strip (Truthful 24-Field FSW Readouts) */}
      <div className="mt-2.5 pt-2.5 border-t border-[var(--border-subtle)] grid grid-cols-2 gap-2">
        <div
          className={`flex items-center gap-1.5 px-2.5 py-1.5 border text-[11px] font-mono-data rounded-[var(--radius-xs)] ${
            burnwireActive === true
              ? 'bg-[var(--status-warning-bg)] border-[var(--status-warning)] text-[var(--status-warning)] font-semibold'
              : burnwireActive === false
              ? 'bg-[var(--bg-surface-2)] border-[var(--border-subtle)] text-[var(--text-secondary)]'
              : 'bg-[var(--bg-surface-2)] border-[var(--border-subtle)] text-[var(--text-tertiary)]'
          }`}
          title="Pin 4 XY-MOS Thermal Reefing Cutter (BURNWIRE_MOSFET: 7.0s @ <=700m AGL)"
        >
          <Zap className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">
            BURNWIRE:{' '}
            {burnwireActive === null
              ? 'UNAVAIL'
              : burnwireActive
              ? 'ON (1)'
              : 'OFF (0)'}
          </span>
        </div>

        <div
          className={`flex items-center gap-1.5 px-2.5 py-1.5 border text-[11px] font-mono-data rounded-[var(--radius-xs)] ${
            buzzerActive === true
              ? 'bg-[var(--status-nominal-bg)] border-[var(--status-nominal)] text-[var(--status-nominal)] font-semibold'
              : buzzerActive === false
              ? 'bg-[var(--bg-surface-2)] border-[var(--border-subtle)] text-[var(--text-secondary)]'
              : 'bg-[var(--bg-surface-2)] border-[var(--border-subtle)] text-[var(--text-tertiary)]'
          }`}
          title="Pin 5 XY-MOS Recovery Buzzer Beacon (BUZZER_MOSFET: 500ms pulse in LANDED/FAILSAFE)"
        >
          <Volume2 className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">
            BUZZER:{' '}
            {buzzerActive === null
              ? 'UNAVAIL'
              : buzzerActive
              ? 'ACTIVE (1)'
              : 'OFF (0)'}
          </span>
        </div>

        <div
          className={`flex items-center gap-1.5 px-2.5 py-1.5 border text-[11px] font-mono-data rounded-[var(--radius-xs)] ${
            hasContinuousSpools || hasServos
              ? 'bg-[var(--bg-surface-2)] border-[var(--border-subtle)] text-[var(--text-primary)]'
              : 'bg-[var(--bg-surface-2)] border-[var(--border-subtle)] text-[var(--text-tertiary)]'
          }`}
          title={
            hasContinuousSpools
              ? `Continuous-Rotation Parafoil Brake Spools (LEFT_BRAKE_CMD=${(latestPacket!.leftBrakeCmd! * 100).toFixed(0)}%, RIGHT_BRAKE_CMD=${(latestPacket!.rightBrakeCmd! * 100).toFixed(0)}%, Dir=${latestPacket!.leftSpoolDir ?? 'STOP'}/${latestPacket!.rightSpoolDir ?? 'STOP'}, Cal=${latestPacket!.actuatorCalStatus ?? 'UNCAL_LOCKED'})`
              : 'Left/Right Parafoil Brake Spools / Legacy Servos'
          }
        >
          <Navigation className="w-3.5 h-3.5 text-[var(--accent-cobalt)] shrink-0" />
          <span className="truncate">
            {hasContinuousSpools
              ? `SPOOLS: ${(latestPacket!.leftBrakeCmd! * 100).toFixed(0)}%/${(latestPacket!.rightBrakeCmd! * 100).toFixed(0)}% (${
                  latestPacket!.actuatorCalStatus === 'UNCAL_LOCKED'
                    ? 'UNCAL'
                    : `${latestPacket!.leftSpoolDir ?? 'STOP'}/${latestPacket!.rightSpoolDir ?? 'STOP'}`
                })`
              : hasServos
              ? `SERVOS: ${latestPacket!.leftServoDeg!.toFixed(0)}°/${latestPacket!.rightServoDeg!.toFixed(0)}°`
              : 'SPOOLS: UNAVAIL'}
          </span>
        </div>

        <div
          className={`flex items-center gap-1.5 px-2.5 py-1.5 border text-[11px] font-mono-data rounded-[var(--radius-xs)] ${
            hasWheelRpm && latestPacket!.wheelRpm! > 0
              ? 'bg-[var(--status-info-bg)] border-[var(--accent-cobalt)]/40 text-[var(--accent-cobalt)] font-semibold'
              : hasWheelRpm
              ? 'bg-[var(--bg-surface-2)] border-[var(--border-subtle)] text-[var(--text-secondary)]'
              : 'bg-[var(--bg-surface-2)] border-[var(--border-subtle)] text-[var(--text-tertiary)]'
          }`}
          title="Pin 6 Readytosky MT2204 ESC Yaw Reaction Wheel Target RPM (FLYWHEEL_RPM)"
        >
          <Cpu className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">
            WHEEL:{' '}
            {hasWheelRpm ? `${Math.round(latestPacket!.wheelRpm!)} RPM` : 'UNAVAIL'}
          </span>
        </div>
      </div>
    </div>
  );
};
