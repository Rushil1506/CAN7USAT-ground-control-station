import React, { useEffect, useState } from 'react';
import {
  Rocket,
  Settings,
  Terminal,
  Radio,
  Activity,
  RefreshCw,
  BarChart3,
  Compass,
  Cpu,
  Usb,
  Crosshair,
  LayoutDashboard,
} from 'lucide-react';
import {
  ActiveTab,
  SerialConnectionState,
  SerialMetrics,
  TelemetryPacket,
  TelemetrySource,
} from '../types';
import { TEAM_INFO } from '../constants';

interface HeaderBarProps {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  latestPacket: TelemetryPacket | null;
  telemetrySource: TelemetrySource;
  onSelectSource: (source: TelemetrySource) => void;
  serialState: SerialConnectionState;
  serialMetrics: SerialMetrics;
  liveBaudRate: number;
  isStale: boolean;
  packetAgeSeconds: number | null;
  onOpenDeployModal: () => void;
  onOpenSettingsModal: () => void;
  onToggleTerminal: () => void;
  isTerminalOpen: boolean;
  onResetSimulation: () => void;
}

const IST_TIME_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kolkata',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
  hourCycle: 'h23',
});

const IST_DATE_TIME_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
  hourCycle: 'h23',
});

function formatComputerIstClock(date: Date = new Date()): {
  timeLabel: string;
  fullDateTimeTitle: string;
} {
  const timeStr = IST_TIME_FORMATTER.format(date);
  const fullStr = IST_DATE_TIME_FORMATTER.format(date);
  return {
    timeLabel: `${timeStr} IST`,
    fullDateTimeTitle: `Ground Station Computer Clock: ${fullStr} IST (Asia/Kolkata, UTC+05:30 — independent of GNSS packet time)`,
  };
}

export const HeaderBar: React.FC<HeaderBarProps> = ({
  activeTab,
  setActiveTab,
  latestPacket,
  telemetrySource,
  onSelectSource,
  serialState,
  serialMetrics,
  liveBaudRate,
  isStale,
  packetAgeSeconds,
  onOpenDeployModal,
  onOpenSettingsModal,
  onToggleTerminal,
  isTerminalOpen,
  onResetSimulation,
}) => {
  const [istClock, setIstClock] = useState<{
    timeLabel: string;
    fullDateTimeTitle: string;
  }>(() => formatComputerIstClock());

  useEffect(() => {
    const updateTime = () => {
      setIstClock(formatComputerIstClock(new Date()));
    };
    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, []);

  const isSim = telemetrySource === 'SIMULATION';

  const tabs: { id: ActiveTab; label: string; icon: React.ReactNode }[] = [
    {
      id: 'OVERVIEW',
      label: 'Mission Overview',
      icon: <LayoutDashboard className="w-4 h-4" />,
    },
    {
      id: 'LANDING_PREDICTOR',
      label: 'Landing Predictor',
      icon: <Crosshair className="w-4 h-4" />,
    },
    {
      id: 'TELEMETRY',
      label: 'Telemetry Explorer',
      icon: <BarChart3 className="w-4 h-4" />,
    },
    {
      id: 'ATTITUDE_SENSORS',
      label: 'Attitude & Sensors',
      icon: <Compass className="w-4 h-4" />,
    },
    {
      id: 'COMMS_LOGS',
      label: 'Communications & Logs',
      icon: <Radio className="w-4 h-4" />,
    },
  ];

  const hasValidBatt =
    latestPacket !== null &&
    typeof latestPacket.batteryVoltage === 'number' &&
    Number.isFinite(latestPacket.batteryVoltage);

  const hasValidSoc =
    latestPacket !== null &&
    typeof latestPacket.batterySoc === 'number' &&
    Number.isFinite(latestPacket.batterySoc);

  return (
    <header className="flex justify-between items-center px-4 h-15 w-full z-50 bg-[var(--bg-surface-1)] border-b border-[var(--border-subtle)] shadow-[var(--shadow-xs)] fixed top-0 left-0 right-0 select-none">
      {/* Left: Mission Identity & Five-Workspace Navigation */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="w-1.5 h-7 bg-[var(--accent-cobalt)] rounded-full hidden sm:block" />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-bold text-[var(--text-primary)] tracking-tight">
                CAN-7USAT Operations
              </h1>
              <span className="bg-[var(--accent-cobalt-soft)] text-[var(--accent-cobalt)] border border-[var(--accent-cobalt)]/20 text-[11px] font-mono-data font-semibold px-1.5 py-0.5 rounded-[var(--radius-xs)]">
                {latestPacket?.teamId?.endsWith('017') ? 'ID #017' : 'ID #332'}
              </span>
            </div>
            <div className="text-[11px] text-[var(--text-secondary)] hidden xl:block">
              {TEAM_INFO.name} • {TEAM_INFO.institution}
            </div>
          </div>
        </div>

        {/* Five-Workspace Primary Navigation Bar */}
        <nav
          aria-label="Primary Mission Workspaces"
          className="hidden lg:flex items-center gap-1 ml-2 bg-[var(--bg-surface-2)] p-1 rounded-[var(--radius-md)] border border-[var(--border-subtle)]"
        >
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`px-3 py-1.5 text-xs font-medium transition-all flex items-center gap-1.5 rounded-[var(--radius-sm)] cursor-pointer ${
                  isActive
                    ? 'bg-[var(--bg-surface-1)] text-[var(--accent-cobalt)] font-semibold shadow-[var(--shadow-xs)] border border-[var(--border-subtle)]'
                    : 'text-[var(--text-secondary)] border border-transparent hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-elevated)]'
                }`}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Responsive Workspace Selector (< lg) */}
        <div className="flex lg:hidden items-center ml-1">
          <select
            value={activeTab}
            onChange={(e) => setActiveTab(e.target.value as ActiveTab)}
            aria-label="Navigation Workspace Switcher"
            className="bg-[var(--bg-surface-2)] border border-[var(--border-subtle)] text-[var(--text-primary)] text-xs font-medium px-2.5 py-1.5 rounded-[var(--radius-sm)] focus:border-[var(--accent-cobalt)] outline-none cursor-pointer"
          >
            {tabs.map((tab) => (
              <option key={tab.id} value={tab.id}>
                {tab.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Right: Data Source Switcher, Telemetry Freshness, Clocks & Actions */}
      <div className="flex items-center gap-2 sm:gap-2.5">
        {/* Source Mode Selector Pill (Strict Isolation between SIMULATION and LIVE_SERIAL) */}
        <div
          role="group"
          aria-label="Telemetry Data Source"
          className="flex items-center bg-[var(--bg-surface-2)] border border-[var(--border-subtle)] p-0.5 rounded-[var(--radius-sm)] text-[11px] font-medium"
        >
          <button
            type="button"
            onClick={() => onSelectSource('SIMULATION')}
            title="Switch to Isolated In-Browser 10Hz Flight Simulator"
            className={`px-2.5 py-1 rounded-[var(--radius-xs)] flex items-center gap-1.5 cursor-pointer transition-colors ${
              isSim
                ? 'bg-[var(--bg-surface-1)] text-[var(--accent-cobalt)] font-semibold shadow-[var(--shadow-xs)]'
                : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'
            }`}
          >
            <Cpu className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Simulator</span>
          </button>
          <button
            type="button"
            onClick={() => onSelectSource('LIVE_SERIAL')}
            title="Switch to Live USB-Serial Receiver (115200 8N1, Receive-Only)"
            className={`px-2.5 py-1 rounded-[var(--radius-xs)] flex items-center gap-1.5 cursor-pointer transition-colors ${
              !isSim
                ? 'bg-[var(--accent-teal)] text-white font-semibold shadow-[var(--shadow-xs)]'
                : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'
            }`}
          >
            <Usb className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Live USB Serial</span>
          </button>
        </div>

        {/* Link Health & Freshness Status Badge */}
        {isSim ? (
          <div
            className="hidden xl:flex items-center gap-1.5 px-2.5 py-1 bg-[var(--status-info-bg)] border border-[var(--accent-cobalt)]/20 text-[11px] font-mono-data text-[var(--accent-cobalt)] rounded-[var(--radius-sm)]"
            title="Telemetry Source: Local 10Hz Physics Simulator (Isolated from Live Hardware)"
          >
            <span className="w-2 h-2 rounded-full bg-[var(--accent-cobalt)]" />
            <span className="font-semibold">SIMULATED</span>
            <span className="opacity-60">•</span>
            <span className="tabular-nums">10 Hz</span>
          </div>
        ) : (
          <div
            className={`hidden md:flex items-center gap-1.5 px-2.5 py-1 border text-[11px] font-mono-data rounded-[var(--radius-sm)] ${
              serialState === 'CONNECTED' && !isStale && latestPacket
                ? 'bg-[var(--status-nominal-bg)] text-[var(--status-nominal)] border-[var(--status-nominal)]/30'
                : isStale
                ? 'bg-[var(--status-warning-bg)] text-[var(--status-warning)] border-[var(--status-warning)]/30'
                : 'bg-[var(--bg-surface-2)] text-[var(--text-secondary)] border-[var(--border-subtle)]'
            }`}
            title={`Live USB Serial @ ${liveBaudRate} baud | Valid: ${serialMetrics.validPacketsReceived} | Malformed: ${serialMetrics.malformedPacketsReceived}`}
          >
            <Radio className="w-3.5 h-3.5" />
            <span className="font-semibold">
              {serialState !== 'CONNECTED'
                ? `USB ${serialState}`
                : !latestPacket
                ? 'AWAITING RX'
                : isStale
                ? `STALE (${packetAgeSeconds !== null ? `${packetAgeSeconds.toFixed(1)}s` : '--'})`
                : `LIVE RX (${packetAgeSeconds !== null ? `${packetAgeSeconds.toFixed(1)}s` : '0.0s'})`}
            </span>
          </div>
        )}

        {/* Packet Counter Badge */}
        <div
          className="hidden md:flex items-center gap-1.5 px-2.5 py-1 bg-[var(--bg-surface-2)] border border-[var(--border-subtle)] text-[11px] font-mono-data text-[var(--text-secondary)] rounded-[var(--radius-sm)]"
          title={
            isSim
              ? 'Simulated Packet Sequence Number'
              : `Received Packet Sequence # | Valid Frames: ${serialMetrics.validPacketsReceived} | Malformed: ${serialMetrics.malformedPacketsReceived}`
          }
        >
          <Activity className="w-3.5 h-3.5 text-[var(--accent-teal)]" />
          <span>PKT</span>
          <span className="text-[var(--text-primary)] font-semibold tabular-nums">
            {latestPacket ? `#${latestPacket.packetNumber}` : 'NONE'}
          </span>
        </div>

        {/* Battery Monitor Badge */}
        <div className="hidden 2xl:flex items-center gap-1.5 bg-[var(--bg-surface-2)] border border-[var(--border-subtle)] px-2.5 py-1 text-[11px] font-mono-data rounded-[var(--radius-sm)]">
          <span className="text-[var(--text-secondary)]">BATT</span>
          {hasValidBatt ? (
            <>
              <span
                className={`font-semibold tabular-nums ${
                  latestPacket!.batteryVoltage! >= 6.4
                    ? 'text-[var(--status-nominal)]'
                    : 'text-[var(--status-warning)]'
                }`}
              >
                {latestPacket!.batteryVoltage!.toFixed(2)}V
              </span>
              {hasValidSoc && (
                <span className="text-[var(--text-tertiary)] tabular-nums">
                  ({latestPacket!.batterySoc!.toFixed(0)}%)
                </span>
              )}
            </>
          ) : (
            <span className="text-[var(--text-tertiary)] tabular-nums">N/A</span>
          )}
        </div>

        {/* Ground Station Computer Clock (IST / Asia/Kolkata) */}
        <div
          title={istClock.fullDateTimeTitle}
          className="font-mono-data text-xs text-[var(--text-primary)] font-medium px-2.5 border-l border-[var(--border-subtle)] hidden sm:block tabular-nums"
        >
          {istClock.timeLabel}
        </div>

        {/* Reset Simulation Button (Strictly Simulation Only) */}
        <button
          type="button"
          onClick={onResetSimulation}
          disabled={!isSim}
          title={
            isSim
              ? 'Reset Telemetry Simulator to T=0.0s'
              : 'Simulator Reset Disabled in Live USB Serial Mode'
          }
          className="p-1.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-2)] transition-colors cursor-pointer border border-[var(--border-subtle)] rounded-[var(--radius-sm)] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <RefreshCw className="w-4 h-4" />
        </button>

        {/* Telecommands / Receive-Only Hardware Lock Indicator */}
        <button
          type="button"
          onClick={onOpenDeployModal}
          title={
            isSim
              ? 'Open Simulated Disreef Override Interlock'
              : 'Hardware Telecommands Unavailable (Live Serial is Strictly Receive-Only)'
          }
          className={`text-xs font-semibold px-3 py-1.5 transition-colors cursor-pointer flex items-center gap-1.5 rounded-[var(--radius-sm)] ${
            isSim
              ? 'bg-[var(--accent-cobalt)] hover:bg-[var(--accent-cobalt-hover)] text-white shadow-[var(--shadow-xs)]'
              : 'bg-[var(--bg-surface-2)] text-[var(--text-secondary)] border border-[var(--border-subtle)] hover:text-[var(--text-primary)]'
          }`}
        >
          <Rocket className="w-3.5 h-3.5" />
          <span>{isSim ? 'Sim Commands' : 'RX Only'}</span>
        </button>

        {/* Raw Frame Drawer Toggle */}
        <button
          type="button"
          onClick={onToggleTerminal}
          title="Toggle Raw Stream & Frame Inspector Drawer"
          className={`p-1.5 transition-colors cursor-pointer border rounded-[var(--radius-sm)] ${
            isTerminalOpen
              ? 'text-[var(--accent-cobalt)] bg-[var(--accent-cobalt-soft)] border-[var(--accent-cobalt)]/40'
              : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-2)] border-[var(--border-subtle)]'
          }`}
        >
          <Terminal className="w-4 h-4" />
        </button>

        {/* Settings Modal Toggle */}
        <button
          type="button"
          onClick={onOpenSettingsModal}
          title="Ground Station & Vehicle Settings"
          className="p-1.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-2)] transition-colors cursor-pointer border border-[var(--border-subtle)] rounded-[var(--radius-sm)]"
        >
          <Settings className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
};
