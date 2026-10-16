import React, { useState, useRef, useEffect } from 'react';
import { Play, Pause, Sliders, Zap, RotateCcw, Terminal, Check, X } from 'lucide-react';

interface MissionControlPanelProps {
  isRunning: boolean;
  onTogglePlay: () => void;
  onCalibrateSensors: () => void;
  onInjectDisturbance: () => void;
  onResetSimulation: () => void;
}

export const MissionControlPanel: React.FC<MissionControlPanelProps> = ({
  isRunning,
  onTogglePlay,
  onCalibrateSensors,
  onInjectDisturbance,
  onResetSimulation,
}) => {
  const [calibrating, setCalibrating] = useState<boolean>(false);
  const [confirmingReset, setConfirmingReset] = useState<boolean>(false);
  const [statusFeedback, setStatusFeedback] = useState<{ text: string; tone: 'info' | 'nominal' | 'amber' } | null>(
    null
  );
  const timerRefs = useRef<number[]>([]);

  const clearTimers = () => {
    timerRefs.current.forEach((id) => window.clearTimeout(id));
    timerRefs.current = [];
  };

  useEffect(() => {
    return () => clearTimers();
  }, []);

  const showTemporaryStatus = (text: string, tone: 'info' | 'nominal' | 'amber', durationMs = 2600) => {
    clearTimers();
    setStatusFeedback({ text, tone });
    const id = window.setTimeout(() => {
      setStatusFeedback(null);
    }, durationMs);
    timerRefs.current.push(id);
  };

  const handleCalibrate = () => {
    clearTimers();
    setCalibrating(true);
    setStatusFeedback({ text: 'SIM CMD: ZEROING IMU & BARO...', tone: 'amber' });
    onCalibrateSensors();

    const t1 = window.setTimeout(() => {
      setCalibrating(false);
      setStatusFeedback({ text: 'SIM ACK: CALIBRATED (LOCAL ONLY)', tone: 'nominal' });
      const t2 = window.setTimeout(() => setStatusFeedback(null), 2500);
      timerRefs.current.push(t2);
    }, 1800);
    timerRefs.current.push(t1);
  };

  const handleTurbulence = () => {
    onInjectDisturbance();
    showTemporaryStatus('SIM ENV: 1.5G DISTURBANCE INJECTED', 'info');
  };

  const handleConfirmReset = () => {
    setConfirmingReset(false);
    onResetSimulation();
    showTemporaryStatus('SIM RESET: TIMELINE RESTORED TO T=0.0s', 'amber');
  };

  return (
    <div className="telemetry-panel panel-amber-accent p-2.5 select-none flex flex-col gap-2">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-1.5">
          <Terminal className="w-3.5 h-3.5 text-[var(--action-amber)]" />
          <span className="font-mono-data text-[11px] font-bold text-[var(--text-primary)] uppercase tracking-wider">
            MISSION CONTROL
          </span>
        </div>
        <span className="font-mono-data text-[9px] px-1.5 py-0.5 bg-[var(--bg-surface-2)] text-[var(--action-amber)] border border-[var(--border-subtle)] rounded-[var(--radius-xs)] uppercase">
          SIM COMMANDS
        </span>
      </div>

      {/* Primary Action GO / Pause Button */}
      <button
        onClick={onTogglePlay}
        className={`w-full font-mono-data text-xs py-2.5 px-3 uppercase transition-colors cursor-pointer font-bold tracking-wider flex items-center justify-center gap-2 rounded-[var(--radius-sm)] ${
          isRunning
            ? 'go-button'
            : 'bg-[var(--status-nominal)] hover:opacity-95 text-[var(--text-inverted)] border border-[var(--border-nominal)]'
        }`}
      >
        {isRunning ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 fill-current" />}
        <span>{isRunning ? 'PAUSE TELEMETRY' : 'START TELEMETRY'}</span>
      </button>

      {/* Secondary Action Button: CALIBRATE SENSORS (Simulated Local Command) */}
      <button
        onClick={handleCalibrate}
        disabled={calibrating}
        title="Dispatch simulated calibration telecommand (local simulator only)"
        className="w-full bg-[var(--bg-surface-2)] text-[var(--text-primary)] font-mono-data text-[11px] py-1.5 px-2.5 uppercase hover:bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] hover:border-[var(--border-focus)] transition-colors cursor-pointer flex items-center justify-between disabled:opacity-50 rounded-[var(--radius-sm)]"
      >
        <span className="flex items-center gap-1.5 font-semibold">
          <Sliders className="w-3.5 h-3.5 text-[var(--action-amber)]" />
          <span>{calibrating ? 'CALIBRATING (SIM)...' : 'CALIBRATE SENSORS'}</span>
        </span>
        <span className="text-[9px] text-[var(--text-tertiary)] font-normal">LOCAL SIM</span>
      </button>

      {/* Simulation Test & Reset Controls */}
      {!confirmingReset ? (
        <div className="grid grid-cols-2 gap-1.5">
          <button
            onClick={handleTurbulence}
            title="Inject simulated 1.5G pitch/roll disturbance impulse"
            className="bg-[var(--bg-surface-2)] text-[var(--status-info)] hover:bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] hover:border-[var(--border-focus)] py-1.5 px-2 font-mono-data text-[10px] font-semibold uppercase transition-colors cursor-pointer flex items-center justify-center gap-1 rounded-[var(--radius-sm)]"
          >
            <Zap className="w-3 h-3 text-[var(--status-info)] shrink-0" />
            <span>TURBULENCE</span>
          </button>

          <button
            onClick={() => setConfirmingReset(true)}
            title="Reset simulated mission timeline to T=0.0s"
            className="bg-[var(--bg-surface-2)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] hover:border-[var(--border-focus)] py-1.5 px-2 font-mono-data text-[10px] font-semibold uppercase transition-colors cursor-pointer flex items-center justify-center gap-1 rounded-[var(--radius-sm)]"
          >
            <RotateCcw className="w-3 h-3 text-[var(--text-secondary)] shrink-0" />
            <span>RESTART SIM</span>
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-1.5 bg-[var(--bg-base)] border border-[var(--border-amber)] px-2 py-1 rounded-[var(--radius-sm)] font-mono-data text-[10px]">
          <span className="text-[var(--action-amber)] font-semibold truncate">RESET SIM TO T=0?</span>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={handleConfirmReset}
              className="px-2 py-0.5 bg-[var(--action-amber)] text-[var(--action-amber-contrast)] font-bold rounded-[var(--radius-xs)] cursor-pointer hover:bg-[var(--action-amber-hover)] flex items-center gap-0.5"
            >
              <Check className="w-3 h-3" />
              <span>YES</span>
            </button>
            <button
              onClick={() => setConfirmingReset(false)}
              className="px-1.5 py-0.5 bg-[var(--bg-surface-2)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border-subtle)] rounded-[var(--radius-xs)] cursor-pointer flex items-center"
              aria-label="Cancel Simulation Reset"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}

      {/* Command Feedback / Provenance Status Bar */}
      <div className="flex items-center justify-between px-2 py-1 bg-[var(--bg-base)] border border-[var(--border-muted)] rounded-[var(--radius-xs)] font-mono-data text-[9px]">
        {statusFeedback ? (
          <span
            className={`font-semibold truncate ${
              statusFeedback.tone === 'nominal'
                ? 'text-[var(--status-nominal)]'
                : statusFeedback.tone === 'amber'
                ? 'text-[var(--action-amber)]'
                : 'text-[var(--status-info)]'
            }`}
          >
            {statusFeedback.text}
          </span>
        ) : (
          <span className="text-[var(--text-tertiary)]">TARGET: LOCAL SIMULATOR (NO HW TX)</span>
        )}
        <span className="text-[var(--text-tertiary)] shrink-0 ml-1">{isRunning ? '10 Hz' : 'PAUSED'}</span>
      </div>
    </div>
  );
};
