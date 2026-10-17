import React, { useState, useRef, useEffect } from 'react';
import { ShieldAlert, X, AlertTriangle, CheckCircle2, Flame, Lock } from 'lucide-react';
import { TEAM_INFO } from '../constants';
import { TelemetrySource } from '../types';

interface DeployConfirmationModalProps {
  isOpen: boolean;
  telemetrySource: TelemetrySource;
  onClose: () => void;
  onConfirmDeploy: () => void;
}

export const DeployConfirmationModal: React.FC<DeployConfirmationModalProps> = ({
  isOpen,
  telemetrySource,
  onClose,
  onConfirmDeploy,
}) => {
  const [sliderVal, setSliderVal] = useState<number>(0);
  const [deployedSuccess, setDeployedSuccess] = useState<boolean>(false);
  const timerRef = useRef<number | null>(null);

  const isSim = telemetrySource === 'SIMULATION';

  useEffect(() => {
    if (!isOpen || !isSim) {
      setSliderVal(0);
      setDeployedSuccess(false);
    }
  }, [isOpen, isSim]);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, []);

  if (!isOpen) return null;

  const handleAbort = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setSliderVal(0);
    setDeployedSuccess(false);
    onClose();
  };

  const handleConfirm = () => {
    if (!isSim || sliderVal < 100) return;
    setDeployedSuccess(true);
    onConfirmDeploy();
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }
    timerRef.current = window.setTimeout(() => {
      setDeployedSuccess(false);
      setSliderVal(0);
      onClose();
    }, 2000);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="deploy-modal-title"
      className="fixed inset-0 z-50 bg-[#000000]/75 backdrop-blur-xs flex items-center justify-center p-4 select-none"
    >
      <div className="bg-[var(--bg-surface-1)] border-2 border-[var(--border-amber)] rounded-[var(--radius-md)] w-full max-w-md shadow-2xl relative flex flex-col overflow-hidden font-mono-data text-xs">
        {/* Modal Header */}
        <div className="flex justify-between items-center px-4 py-3 bg-[var(--bg-surface-2)] border-b border-[var(--border-subtle)]">
          <div className="flex items-center gap-2 text-[var(--action-amber)]">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <h3 id="deploy-modal-title" className="font-bold uppercase tracking-wider text-xs sm:text-sm text-[var(--text-primary)]">
              DISREEF OVERRIDE INTERLOCK
            </h3>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[9px] px-1.5 py-0.5 bg-[var(--bg-base)] text-[var(--action-amber)] border border-[var(--border-amber)]/40 rounded-[var(--radius-xs)] uppercase font-bold">
              {isSim ? 'SIMULATOR ONLY' : 'HW TX LOCKED'}
            </span>
            <button
              type="button"
              onClick={handleAbort}
              aria-label="Close Deploy Modal"
              className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer p-0.5"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-4 flex flex-col gap-3.5">
          {!isSim ? (
            <div className="py-5 px-3 bg-[var(--bg-base)] border border-[var(--status-alert)]/40 rounded-[var(--radius-sm)] flex flex-col items-center justify-center text-center gap-2.5">
              <Lock className="w-8 h-8 text-[var(--status-alert)]" />
              <div className="text-sm font-bold text-[var(--status-alert)] uppercase tracking-wide">
                HARDWARE TELECOMMANDS UNAVAILABLE
              </div>
              <div className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
                Live USB-Serial mode is strictly <strong className="text-[var(--text-primary)]">receive-only</strong>.
                Transmitting real deployment or burnwire commands over serial/LoRa is disabled, and simulator overrides cannot be triggered while monitoring live hardware.
              </div>
              <button
                type="button"
                onClick={handleAbort}
                className="mt-1 px-4 py-2 bg-[var(--bg-surface-2)] hover:bg-[var(--bg-surface-hover)] text-[var(--text-primary)] border border-[var(--border-subtle)] rounded-[var(--radius-sm)] font-bold uppercase cursor-pointer"
              >
                CLOSE
              </button>
            </div>
          ) : deployedSuccess ? (
            <div className="py-6 px-3 bg-[var(--bg-base)] border border-[var(--status-nominal)]/40 rounded-[var(--radius-sm)] flex flex-col items-center justify-center text-center gap-2">
              <CheckCircle2 className="w-9 h-9 text-[var(--status-nominal)]" />
              <div className="text-sm font-bold text-[var(--status-nominal)] uppercase tracking-wide">
                SIMULATED OVERRIDE APPLIED
              </div>
              <div className="text-[11px] text-[var(--text-primary)]">
                <code>CMD,{TEAM_INFO.id},DISREEF,OVERRIDE</code>
              </div>
              <div className="text-[10px] text-[var(--text-secondary)] max-w-xs leading-relaxed">
                Local simulator forced to State 6 (AEROBREAK_RELEASE). No RF packet was transmitted to physical hardware.
              </div>
            </div>
          ) : (
            <>
              {/* Action / Target / Mode / Consequences Breakdown */}
              <div className="bg-[var(--bg-base)] border border-[var(--border-subtle)] rounded-[var(--radius-sm)] p-3 space-y-2 text-[11px]">
                <div className="text-[var(--status-alert)] font-bold flex items-center gap-1.5 border-b border-[var(--border-muted)] pb-1.5 uppercase">
                  <ShieldAlert className="w-4 h-4 shrink-0" />
                  <span>STAGE 2 PARACHUTE DISREEF OVERRIDE</span>
                </div>

                <div className="grid grid-cols-[92px_1fr] gap-y-1.5 gap-x-2 text-[10px] leading-snug">
                  <span className="text-[var(--text-tertiary)] uppercase">ACTION:</span>
                  <span className="text-[var(--text-primary)] font-semibold">
                    Trigger Stage 2 Canopy Disreefing
                  </span>

                  <span className="text-[var(--text-tertiary)] uppercase">COMMAND:</span>
                  <code className="text-[var(--action-amber)] break-all">
                    CMD,{TEAM_INFO.id},DISREEF,OVERRIDE
                  </code>

                  <span className="text-[var(--text-tertiary)] uppercase">TARGET / MODE:</span>
                  <span className="text-[var(--status-info)] font-semibold">
                    LOCAL SIMULATOR (NO RF HARDWARE LINK)
                  </span>

                  <span className="text-[var(--text-tertiary)] uppercase">CONSEQUENCES:</span>
                  <span className="text-[var(--text-secondary)]">
                    Forces simulated FSW state to <strong className="text-[var(--text-primary)]">[6] AEROBREAK_RELEASE</strong> (1–3 m/s descent) and logs local command. Does not actuate physical burnwire MOSFETs.
                  </span>
                </div>
              </div>

              {/* Safety Lock Slider */}
              <div className="flex flex-col gap-2 bg-[var(--bg-surface-2)] border border-[var(--border-subtle)] rounded-[var(--radius-sm)] p-3">
                <div className="flex justify-between items-center text-[11px]">
                  <label htmlFor="deploy-safety-slider" className="text-[var(--text-secondary)] font-semibold uppercase">
                    SAFETY INTERLOCK LATCH:
                  </label>
                  <span
                    className={`font-bold tabular-nums px-1.5 py-0.5 rounded-[var(--radius-xs)] text-[10px] ${
                      sliderVal >= 100
                        ? 'bg-[var(--status-nominal-bg)] text-[var(--status-nominal)] border border-[var(--status-nominal)]/40'
                        : 'bg-[var(--bg-base)] text-[var(--action-amber)] border border-[var(--border-subtle)]'
                    }`}
                  >
                    {sliderVal >= 100 ? '100% — ARMED (SIM)' : `${sliderVal}% — LOCKED`}
                  </span>
                </div>

                <input
                  id="deploy-safety-slider"
                  type="range"
                  min="0"
                  max="100"
                  value={sliderVal}
                  onChange={(e) => setSliderVal(Number(e.target.value))}
                  className="w-full accent-[var(--action-amber)] bg-[var(--bg-base)] h-2.5 cursor-pointer rounded-[var(--radius-xs)]"
                />
                <span className="text-[9px] text-[var(--text-tertiary)]">
                  Slide completely to 100% to unlock the simulated override trigger.
                </span>
              </div>

              {/* Actions */}
              <div className="flex gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={handleAbort}
                  className="flex-1 bg-[var(--bg-surface-2)] hover:bg-[var(--bg-surface-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-xs font-semibold py-2.5 uppercase border border-[var(--border-subtle)] rounded-[var(--radius-sm)] cursor-pointer transition-colors"
                >
                  ABORT
                </button>

                <button
                  type="button"
                  onClick={handleConfirm}
                  disabled={sliderVal < 100}
                  className={`flex-1 text-xs font-bold py-2.5 px-3 uppercase flex items-center justify-center gap-1.5 rounded-[var(--radius-sm)] transition-colors ${
                    sliderVal >= 100
                      ? 'go-button cursor-pointer'
                      : 'bg-[var(--bg-surface-2)] text-[var(--text-tertiary)] border border-[var(--border-subtle)] opacity-50 cursor-not-allowed'
                  }`}
                >
                  <Flame className="w-3.5 h-3.5 text-[var(--status-alert)] shrink-0" />
                  <span>EXECUTE SIM OVERRIDE</span>
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
