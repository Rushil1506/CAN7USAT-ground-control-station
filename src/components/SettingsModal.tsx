import React, { useEffect, useState } from 'react';
import {
  Settings as SettingsIcon,
  X,
  Volume2,
  Radio,
  Sliders,
  ShieldAlert,
  RotateCcw,
  Check,
  LayoutDashboard,
} from 'lucide-react';
import { TEAM_INFO } from '../constants';
import {
  DEFAULT_OVERVIEW_PREFERENCES,
  OVERVIEW_WIDGETS,
  OverviewPreferences,
  OverviewWidgetId,
} from '../services/overviewPreferences';
import { RadioAssignmentPanel } from './RadioAssignmentPanel';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  overviewPrefs?: OverviewPreferences;
  onUpdateOverviewPrefs?: (prefs: OverviewPreferences) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  overviewPrefs,
  onUpdateOverviewPrefs,
}) => {
  const [telemetryRate, setTelemetryRate] = useState<number>(10);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [unitSystem, setUnitSystem] = useState<'METRIC' | 'IMPERIAL'>('METRIC');
  const [callsign, setCallsign] = useState<string>(TEAM_INFO.id);
  const [localOverviewPrefs, setLocalOverviewPrefs] = useState<OverviewPreferences>(
    () => overviewPrefs ?? DEFAULT_OVERVIEW_PREFERENCES
  );

  useEffect(() => {
    if (overviewPrefs) {
      setLocalOverviewPrefs(overviewPrefs);
    }
  }, [overviewPrefs, isOpen]);

  if (!isOpen) return null;

  const handleToggleWidget = (id: OverviewWidgetId) => {
    setLocalOverviewPrefs((prev) => {
      const next = {
        ...prev,
        [id]: !prev[id],
      };
      onUpdateOverviewPrefs?.(next);
      return next;
    });
  };

  const handleResetOverviewDefaults = () => {
    setLocalOverviewPrefs(DEFAULT_OVERVIEW_PREFERENCES);
    onUpdateOverviewPrefs?.(DEFAULT_OVERVIEW_PREFERENCES);
  };

  const trimmedCallsign = callsign.trim();
  const isCallsignValid = /^[A-Za-z0-9_-]{3,40}$/.test(trimmedCallsign);
  const validationError = !trimmedCallsign
    ? 'Team Net ID cannot be empty.'
    : !isCallsignValid
    ? 'Use 3–40 alphanumeric characters, hyphens (-), or underscores (_).'
    : null;

  const handleResetDefaults = () => {
    setCallsign(TEAM_INFO.id);
    setTelemetryRate(10);
    setUnitSystem('METRIC');
    setSoundEnabled(true);
    setLocalOverviewPrefs(DEFAULT_OVERVIEW_PREFERENCES);
    onUpdateOverviewPrefs?.(DEFAULT_OVERVIEW_PREFERENCES);
  };

  const handleApplyAndClose = () => {
    if (validationError) return;
    setCallsign(trimmedCallsign);
    onUpdateOverviewPrefs?.(localOverviewPrefs);
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-modal-title"
      className="fixed inset-0 z-50 bg-[#000000]/75 backdrop-blur-xs flex items-center justify-center p-4 select-none"
    >
      <div className="bg-[var(--bg-surface-1)] border border-[var(--border-focus)] rounded-[var(--radius-md)] w-full max-w-xl shadow-2xl relative flex flex-col max-h-[90vh] overflow-hidden font-mono-data text-xs">
        {/* Modal Header */}
        <div className="flex justify-between items-center px-4 py-3 bg-[var(--bg-surface-2)] border-b border-[var(--border-subtle)] shrink-0">
          <div className="flex items-center gap-2">
            <SettingsIcon className="w-4 h-4 text-[var(--action-amber)]" />
            <h3 id="settings-modal-title" className="font-bold uppercase tracking-wider text-xs sm:text-sm text-[var(--text-primary)]">
              GROUND STATION & MISSION PROFILE CONFIGURATION
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Settings Modal"
            className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer p-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Content Body */}
        <div className="p-4 overflow-y-auto flex flex-col gap-4">
          {/* Section 1: Read-Only Competition & Team Metadata */}
          <div className="bg-[var(--bg-base)] border border-[var(--border-subtle)] rounded-[var(--radius-sm)] p-3 space-y-1.5 text-[11px]">
            <div className="flex flex-wrap justify-between items-center gap-2 border-b border-[var(--border-muted)] pb-1.5">
              <span className="text-[var(--action-amber)] font-bold">
                {TEAM_INFO.name} — {TEAM_INFO.id}
              </span>
              <span className="text-[9px] px-1.5 py-0.5 bg-[var(--bg-surface-2)] text-[var(--text-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-xs)]">
                PDR ID: {TEAM_INFO.pdrId}
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 text-[var(--text-secondary)] text-[10px]">
              <div>
                <span className="text-[var(--text-tertiary)]">INSTITUTION:</span> {TEAM_INFO.institution}
              </div>
              <div>
                <span className="text-[var(--text-tertiary)]">ADVISOR:</span> {TEAM_INFO.facultyAdvisor}
              </div>
            </div>
            <div className="text-[10px] text-[var(--text-tertiary)] pt-1 border-t border-[var(--border-muted)] leading-relaxed">
              <span className="text-[var(--text-secondary)] font-semibold">ROSTER:</span> {TEAM_INFO.members.join(', ')}
            </div>
          </div>

          {/* Section 2: Intended Hardware / Link Parameters (Unimplemented on Hardware) */}
          <div className="flex flex-col gap-3 border border-[var(--border-subtle)] bg-[var(--bg-surface-2)]/50 rounded-[var(--radius-sm)] p-3">
            <div className="flex flex-wrap items-center justify-between gap-1 border-b border-[var(--border-subtle)] pb-1.5">
              <span className="flex items-center gap-1.5 text-[11px] font-bold text-[var(--text-primary)] uppercase">
                <Radio className="w-3.5 h-3.5 text-[var(--status-info)]" />
                INTENDED RF / HARDWARE PROFILE
              </span>
              <span className="text-[9px] px-1.5 py-0.5 bg-[var(--bg-base)] text-[var(--action-amber)] border border-[var(--border-subtle)] rounded-[var(--radius-xs)] uppercase">
                PROFILE ONLY — NO HARDWARE DRIVER
              </span>
            </div>

            {/* Mission Callsign / Team Net ID */}
            <div className="flex flex-col gap-1">
              <div className="flex justify-between items-center text-[10px]">
                <label htmlFor="settings-callsign-input" className="text-[var(--text-secondary)] uppercase font-semibold">
                  TEAM NET ID / PACKET HEADER ID
                </label>
                <span className="text-[9px] text-[var(--text-tertiary)]">LOCAL PROFILE</span>
              </div>
              <input
                id="settings-callsign-input"
                type="text"
                value={callsign}
                onChange={(e) => setCallsign(e.target.value)}
                className={`bg-[var(--bg-base)] border px-2.5 py-1.5 text-xs text-[var(--text-primary)] outline-none rounded-[var(--radius-xs)] ${
                  validationError
                    ? 'border-[var(--status-alert)] focus:border-[var(--status-alert)]'
                    : 'border-[var(--border-subtle)] focus:border-[var(--border-amber)]'
                }`}
              />
              {validationError ? (
                <div className="flex items-center gap-1 text-[10px] text-[var(--status-alert)] mt-0.5">
                  <ShieldAlert className="w-3 h-3 shrink-0" />
                  <span>{validationError}</span>
                </div>
              ) : (
                <span className="text-[9px] text-[var(--text-tertiary)]">
                  Editing this field does not reprogram the physical transceiver or alter the simulator&apos;s hardcoded teamId.
                </span>
              )}
            </div>

            {/* Target LoRa Sample Rate */}
            <div className="flex flex-col gap-1">
              <div className="flex justify-between items-center text-[10px]">
                <span className="text-[var(--text-secondary)] uppercase font-semibold">
                  TARGET LORA SAMPLE RATE (Hz)
                </span>
                <span className="text-[9px] text-[var(--status-info)]">SIMULATOR FIXED @ 10 Hz</span>
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {[1, 5, 10, 20].map((rate) => (
                  <button
                    key={rate}
                    type="button"
                    onClick={() => setTelemetryRate(rate)}
                    className={`py-1.5 border uppercase cursor-pointer rounded-[var(--radius-xs)] text-[11px] tabular-nums transition-colors ${
                      telemetryRate === rate
                        ? 'bg-[var(--action-amber)] text-[var(--action-amber-contrast)] font-bold border-[var(--border-amber)]'
                        : 'bg-[var(--bg-base)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    {rate} Hz {rate === 10 ? '(SIM)' : ''}
                  </button>
                ))}
              </div>
              <span className="text-[9px] text-[var(--text-tertiary)]">
                Records intended RF rate preference only. Does not reconfigure LoRa hardware or change the 10 Hz simulator tick.
              </span>
            </div>
          </div>

          {/* Section 3: Local Presentation & Console Preferences */}
          <div className="flex flex-col gap-3 border border-[var(--border-subtle)] bg-[var(--bg-surface-2)]/50 rounded-[var(--radius-sm)] p-3">
            <div className="flex flex-wrap items-center justify-between gap-1 border-b border-[var(--border-subtle)] pb-1.5">
              <span className="flex items-center gap-1.5 text-[11px] font-bold text-[var(--text-primary)] uppercase">
                <Sliders className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
                CONSOLE PRESENTATION PREFERENCES
              </span>
              <span className="text-[9px] px-1.5 py-0.5 bg-[var(--bg-base)] text-[var(--text-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-xs)] uppercase">
                LOCAL DIALOG STATE
              </span>
            </div>

            {/* Unit System */}
            <div className="flex flex-col gap-1">
              <div className="flex justify-between items-center text-[10px]">
                <span className="text-[var(--text-secondary)] uppercase font-semibold">UNIT DISPLAY SYSTEM</span>
                <span className="text-[9px] text-[var(--status-nominal)]">PANELS USE SI METRIC</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setUnitSystem('METRIC')}
                  className={`py-1.5 px-2 border uppercase cursor-pointer rounded-[var(--radius-xs)] text-[10px] transition-colors ${
                    unitSystem === 'METRIC'
                      ? 'bg-[var(--status-info)] text-[var(--text-inverted)] font-bold border-[var(--status-info)]'
                      : 'bg-[var(--bg-base)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  METRIC (m, m/s, °C, hPa) [ACTIVE]
                </button>
                <button
                  type="button"
                  onClick={() => setUnitSystem('IMPERIAL')}
                  className={`py-1.5 px-2 border uppercase cursor-pointer rounded-[var(--radius-xs)] text-[10px] transition-colors ${
                    unitSystem === 'IMPERIAL'
                      ? 'bg-[var(--status-info)] text-[var(--text-inverted)] font-bold border-[var(--status-info)]'
                      : 'bg-[var(--bg-base)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  IMPERIAL (UNIMPLEMENTED IN PANELS)
                </button>
              </div>
              <span className="text-[9px] text-[var(--text-tertiary)]">
                IN-SPACe PDR specification mandates SI Metric telemetry. Imperial conversion is not wired to charts or readouts.
              </span>
            </div>

            {/* Sound Alerts */}
            <div className="flex flex-col gap-1">
              <div className="flex justify-between items-center p-2 bg-[var(--bg-base)] border border-[var(--border-subtle)] rounded-[var(--radius-xs)]">
                <div className="flex flex-col gap-0.5 pr-2">
                  <span className="text-[var(--text-primary)] font-semibold flex items-center gap-1.5 text-[11px]">
                    <Volume2 className="w-3.5 h-3.5 text-[var(--status-nominal)] shrink-0" />
                    CONSOLE AUDIO ALERT PREFERENCE
                  </span>
                  <span className="text-[9px] text-[var(--text-tertiary)]">
                    Local UI toggle only — no browser audio synthesis or hardware buzzer control is active.
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setSoundEnabled(!soundEnabled)}
                  className={`px-3 py-1 font-bold text-[10px] cursor-pointer rounded-[var(--radius-xs)] border shrink-0 transition-colors ${
                    soundEnabled
                      ? 'bg-[var(--status-nominal-bg)] text-[var(--status-nominal)] border-[var(--status-nominal)]/40'
                      : 'bg-[var(--bg-surface-2)] text-[var(--text-tertiary)] border-[var(--border-subtle)]'
                  }`}
                >
                  {soundEnabled ? 'ENABLED (UI)' : 'MUTED (UI)'}
                </button>
              </div>
            </div>
          </div>

          {/* Section 4: Overview Dashboard Widgets (Local Display Preferences) */}
          <div className="flex flex-col gap-3 border border-[var(--border-subtle)] bg-[var(--bg-surface-2)]/50 rounded-[var(--radius-sm)] p-3">
            <div className="flex flex-wrap items-center justify-between gap-1 border-b border-[var(--border-subtle)] pb-1.5">
              <span className="flex items-center gap-1.5 text-[11px] font-bold text-[var(--text-primary)] uppercase">
                <LayoutDashboard className="w-3.5 h-3.5 text-[var(--accent-teal)]" />
                MISSION OVERVIEW DASHBOARD WIDGETS
              </span>
              <button
                type="button"
                onClick={handleResetOverviewDefaults}
                className="text-[9px] px-1.5 py-0.5 bg-[var(--bg-base)] hover:bg-[var(--bg-surface-hover)] text-[var(--text-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-xs)] uppercase cursor-pointer"
              >
                Restore Overview Defaults
              </button>
            </div>

            <p className="text-[10px] text-[var(--text-secondary)] leading-relaxed">
              Toggle widget visibility on the Mission Overview workspace for this browser session.
              These preferences control local layout only and do not modify CanSat onboard hardware or flight state.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {OVERVIEW_WIDGETS.map((widget) => {
                const isChecked = localOverviewPrefs[widget.id];
                return (
                  <label
                    key={widget.id}
                    className="flex items-start gap-2 p-2 bg-[var(--bg-base)] border border-[var(--border-subtle)] rounded-[var(--radius-xs)] cursor-pointer hover:border-[var(--border-focus)] transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => handleToggleWidget(widget.id)}
                      className="mt-0.5 rounded-[var(--radius-xs)] border-[var(--border-subtle)] text-[var(--accent-cobalt)] focus:ring-0 cursor-pointer"
                    />
                    <div className="flex flex-col min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[11px] font-bold text-[var(--text-primary)]">
                          {widget.label}
                        </span>
                        {widget.onlyIn === 'SIMULATION' && (
                          <span className="text-[8px] font-mono px-1 py-0.2 bg-[var(--status-info-bg)] text-[var(--accent-cobalt)] border border-[var(--accent-cobalt)]/25 rounded-[var(--radius-xs)] uppercase font-semibold">
                            SIM ONLY
                          </span>
                        )}
                      </div>
                      <span className="text-[9px] text-[var(--text-tertiary)] leading-tight mt-0.5">
                        {widget.description}
                      </span>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Section 5: Assigned Radio Configuration (Competition Assignment — Team 017) */}
          <div className="flex flex-col gap-2 border border-[var(--border-subtle)] bg-[var(--bg-surface-2)]/50 rounded-[var(--radius-sm)] p-3">
            <RadioAssignmentPanel compact />
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex justify-between items-center gap-3 px-4 py-3 bg-[var(--bg-surface-2)] border-t border-[var(--border-subtle)] shrink-0">
          <button
            type="button"
            onClick={handleResetDefaults}
            className="px-3 py-1.5 bg-[var(--bg-base)] hover:bg-[var(--bg-surface-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border-subtle)] rounded-[var(--radius-sm)] cursor-pointer flex items-center gap-1.5 text-[11px]"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>RESET DEFAULTS</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 bg-[var(--bg-base)] hover:bg-[var(--bg-surface-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border-subtle)] rounded-[var(--radius-sm)] cursor-pointer text-[11px] uppercase"
            >
              CANCEL
            </button>
            <button
              type="button"
              onClick={handleApplyAndClose}
              disabled={Boolean(validationError)}
              className="go-button font-bold px-4 py-1.5 text-[11px] uppercase cursor-pointer rounded-[var(--radius-sm)] flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Check className="w-3.5 h-3.5" />
              <span>APPLY LOCAL PROFILE</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
