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
  Cloud,
  Eye,
  Globe,
} from 'lucide-react';
import {
  ActiveTab,
  SerialConnectionState,
  SerialMetrics,
  TelemetryPacket,
  TelemetrySource,
} from '../types';
import { TEAM_INFO } from '../constants';
import { OptionalTelemetrySettings } from '../services/optionalTelemetrySettings';

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
  onOpenSettingsModal: () => void;
  onToggleTerminal: () => void;
  isTerminalOpen: boolean;
  onResetSimulation: () => void;
  optionalTelemetrySettings?: OptionalTelemetrySettings;
  onOpenSyncModal?: () => void;
  syncConnected?: boolean;
  syncRole?: 'publisher' | 'viewer' | 'none';
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

export interface HeaderTeamBadge {
  /** Production display label, e.g. `CAN-7USAT | TEAM 017`. */
  label: string;
  /** Provenance of the identity shown next to the label. */
  status: 'SIMULATED' | 'AWAITING_RX' | 'VERIFIED' | 'MISMATCH';
  /** Received identifier when it differs from the expected Team 017 identifier. */
  mismatchedTeamId: string | null;
}

/**
 * Team identity for the header. The assigned team is always 017. A received identifier is
 * compared with the expected identifier and a mismatch is surfaced explicitly (never silently
 * replaced). Simulated packets are labeled as simulated, never as live hardware identity.
 */
export function resolveHeaderTeamBadge(
  latestPacket: TelemetryPacket | null,
  telemetrySource: TelemetrySource
): HeaderTeamBadge {
  const received = latestPacket?.teamId?.trim() ?? '';
  if (telemetrySource === 'SIMULATION') {
    return { label: TEAM_INFO.displayLabel, status: 'SIMULATED', mismatchedTeamId: null };
  }
  if (!received) {
    return { label: TEAM_INFO.displayLabel, status: 'AWAITING_RX', mismatchedTeamId: null };
  }
  if (received !== TEAM_INFO.id) {
    return { label: TEAM_INFO.displayLabel, status: 'MISMATCH', mismatchedTeamId: received };
  }
  return { label: TEAM_INFO.displayLabel, status: 'VERIFIED', mismatchedTeamId: null };
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
  onOpenSettingsModal,
  onToggleTerminal,
  isTerminalOpen,
  onResetSimulation,
  optionalTelemetrySettings,
  onOpenSyncModal,
  syncConnected,
  syncRole,
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
  const teamBadge = resolveHeaderTeamBadge(latestPacket, telemetrySource);

  const tabs: {
    id: ActiveTab;
    label: string;
    shortLabel: string;
    icon: React.ReactNode;
  }[] = [
    {
      id: 'OVERVIEW',
      label: 'Mission Overview',
      shortLabel: 'Overview',
      icon: <LayoutDashboard className="w-4 h-4" />,
    },
    {
      id: 'LANDING_PREDICTOR',
      label: 'Landing Predictor',
      shortLabel: 'Predictor',
      icon: <Crosshair className="w-4 h-4" />,
    },
    {
      id: 'TELEMETRY',
      label: 'Telemetry Explorer',
      shortLabel: 'Telemetry',
      icon: <BarChart3 className="w-4 h-4" />,
    },
    {
      id: 'ATTITUDE_SENSORS',
      label: 'Attitude & Sensors',
      shortLabel: 'Attitude',
      icon: <Compass className="w-4 h-4" />,
    },
    {
      id: 'COMMS_LOGS',
      label: 'Communications & Logs',
      shortLabel: 'Comms & Logs',
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
    <header className="flex flex-col lg:flex-row lg:justify-between lg:items-center px-2.5 sm:px-3 xl:px-4 py-1.5 lg:py-0 lg:h-14 w-full z-40 bg-[var(--bg-surface-1)] border-b border-[var(--border-subtle)] shadow-[var(--shadow-xs)] shrink-0 select-none overflow-hidden gap-1.5 lg:gap-0">
      {/* Top Row (Mobile/Tablet) / Main Row (Desktop) */}
      <div className="flex justify-between items-center w-full gap-1.5 sm:gap-2 min-w-0">
        {/* Left: Mission Identity & Five-Workspace Navigation */}
        <div className="flex items-center gap-1.5 sm:gap-2 xl:gap-3 2xl:gap-4 min-w-0 shrink">
          <div className="flex items-center gap-1.5 sm:gap-2 xl:gap-2.5 shrink-0">
            <div className="w-1.5 h-6 lg:h-7 bg-[var(--accent-cobalt)] rounded-full shrink-0" />
            <div className="shrink-0">
              <div className="flex items-center gap-1.5 xl:gap-2 shrink-0">
                <h1 className="hidden sm:block text-xs sm:text-sm font-bold text-[var(--text-primary)] tracking-tight whitespace-nowrap shrink-0">
                  <span>CAN-7USAT</span>
                  <span className="hidden 2xl:inline"> Operations</span>
                </h1>
                <span
                  className="bg-[var(--accent-cobalt-soft)] text-[var(--accent-cobalt)] border border-[var(--accent-cobalt)]/20 text-[10px] sm:text-[11px] font-mono-data font-semibold px-1.5 py-0.5 rounded-[var(--radius-xs)] shrink-0 whitespace-nowrap"
                  data-testid="team-badge"
                >
                  {teamBadge.label}
                </span>
                <span
                  className={`hidden 2xl:inline-block text-[9px] font-mono-data font-bold px-1.5 py-0.5 border rounded-[var(--radius-xs)] uppercase shrink-0 whitespace-nowrap ${
                    teamBadge.status === 'MISMATCH'
                      ? 'bg-[var(--status-alert-bg)] text-[var(--status-alert)] border-[var(--status-alert)]/40'
                      : teamBadge.status === 'VERIFIED'
                      ? 'bg-[var(--status-nominal-bg)] text-[var(--status-nominal)] border-[var(--status-nominal)]/30'
                      : teamBadge.status === 'SIMULATED'
                      ? 'bg-[var(--status-info-bg)] text-[var(--accent-cobalt)] border-[var(--accent-cobalt)]/25'
                      : 'bg-[var(--bg-surface-2)] text-[var(--text-tertiary)] border-[var(--border-subtle)]'
                  }`}
                  title={
                    teamBadge.status === 'MISMATCH'
                      ? `Received team identifier '${teamBadge.mismatchedTeamId}' does not match expected '${TEAM_INFO.id}'`
                      : `Expected team identifier: ${TEAM_INFO.id}`
                  }
                >
                  {teamBadge.status === 'MISMATCH'
                    ? `ID MISMATCH: ${teamBadge.mismatchedTeamId}`
                    : teamBadge.status === 'VERIFIED'
                    ? 'ID VERIFIED'
                    : teamBadge.status === 'SIMULATED'
                    ? 'SIMULATED'
                    : 'AWAITING RX'}
                </span>
              </div>
              <div
                className="text-[11px] text-[var(--text-secondary)] hidden 2xl:block max-w-[280px] truncate"
                title={`${TEAM_INFO.name} • ${TEAM_INFO.institution}`}
              >
                {TEAM_INFO.name} • {TEAM_INFO.institution}
              </div>
            </div>
          </div>

          {/* Five-Workspace Primary Navigation Bar (Desktop >= lg) */}
          <nav
            aria-label="Primary Mission Workspaces"
            className="hidden lg:flex items-center gap-0.5 xl:gap-1 bg-[var(--bg-surface-2)] p-1 rounded-[var(--radius-md)] border border-[var(--border-subtle)] shrink min-w-0 max-w-full overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
          >
            {tabs.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  title={tab.label}
                  className={`px-2 xl:px-2.5 2xl:px-3 py-1.5 text-xs font-medium transition-all flex items-center gap-1.5 rounded-[var(--radius-sm)] cursor-pointer whitespace-nowrap shrink-0 ${
                    isActive
                      ? 'bg-[var(--bg-surface-1)] text-[var(--accent-cobalt)] font-semibold shadow-[var(--shadow-xs)] border border-[var(--border-subtle)]'
                      : 'text-[var(--text-secondary)] border border-transparent hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-elevated)]'
                  }`}
                >
                  <span className="shrink-0">{tab.icon}</span>
                  <span className="hidden 2xl:inline whitespace-nowrap">{tab.label}</span>
                  <span className="inline 2xl:hidden whitespace-nowrap">{tab.shortLabel}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Right: Data Source Switcher, Telemetry Freshness, Clocks & Actions */}
        <div className="flex items-center gap-1 sm:gap-1.5 xl:gap-2 shrink-0">
          {/* Source Mode Selector Pill (Strict Isolation between SIMULATION, LIVE_SERIAL, and REMOTE_VIEWER) */}
          <div
            role="group"
            aria-label="Telemetry Data Source"
            className="flex items-center bg-[var(--bg-surface-2)] border border-[var(--border-subtle)] p-0.5 rounded-[var(--radius-sm)] text-[11px] font-medium shrink-0 whitespace-nowrap"
          >
            <button
              type="button"
              onClick={() => onSelectSource('SIMULATION')}
              title="Switch to Isolated In-Browser 10Hz Flight Simulator"
              className={`px-2 xl:px-2.5 py-1 rounded-[var(--radius-xs)] flex items-center gap-1 sm:gap-1.5 cursor-pointer transition-colors shrink-0 whitespace-nowrap ${
                telemetrySource === 'SIMULATION'
                  ? 'bg-[var(--bg-surface-1)] text-[var(--accent-cobalt)] font-semibold shadow-[var(--shadow-xs)]'
                  : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'
              }`}
            >
              <Cpu className="w-3.5 h-3.5 shrink-0" />
              <span className="sm:hidden text-[10px] font-mono-data">SIM</span>
              <span className="hidden sm:inline whitespace-nowrap">Simulator</span>
            </button>
            <button
              type="button"
              onClick={() => onSelectSource('LIVE_SERIAL')}
              title="Switch to Live USB-Serial Receiver (115200 8N1, Receive-Only)"
              className={`px-2 xl:px-2.5 py-1 rounded-[var(--radius-xs)] flex items-center gap-1 sm:gap-1.5 cursor-pointer transition-colors shrink-0 whitespace-nowrap ${
                telemetrySource === 'LIVE_SERIAL'
                  ? 'bg-[var(--accent-teal)] text-white font-semibold shadow-[var(--shadow-xs)]'
                  : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'
              }`}
            >
              <Usb className="w-3.5 h-3.5 shrink-0" />
              <span className="sm:hidden text-[10px] font-mono-data">USB</span>
              <span className="hidden xl:inline whitespace-nowrap">Live USB Serial</span>
              <span className="hidden sm:inline xl:hidden whitespace-nowrap">Live Serial</span>
            </button>
            <button
              type="button"
              onClick={() => onSelectSource('REMOTE_VIEWER')}
              title="Switch to Remote Spectator Mode (Real-Time Cloud Relay)"
              className={`px-2 xl:px-2.5 py-1 rounded-[var(--radius-xs)] flex items-center gap-1 sm:gap-1.5 cursor-pointer transition-colors shrink-0 whitespace-nowrap ${
                telemetrySource === 'REMOTE_VIEWER'
                  ? 'bg-[var(--accent-cobalt)] text-white font-semibold shadow-[var(--shadow-xs)]'
                  : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'
              }`}
            >
              <Globe className="w-3.5 h-3.5 shrink-0" />
              <span className="sm:hidden text-[10px] font-mono-data">SYNC</span>
              <span className="hidden sm:inline whitespace-nowrap">Remote Viewer</span>
            </button>
          </div>

          {/* Link Health & Freshness Status Badge (Desktop >= sm) */}
          {telemetrySource === 'SIMULATION' ? (
            <div
              className="hidden xl:flex items-center gap-1.5 px-2 xl:px-2.5 py-1 bg-[var(--status-info-bg)] border border-[var(--accent-cobalt)]/20 text-[11px] font-mono-data text-[var(--accent-cobalt)] rounded-[var(--radius-sm)] shrink-0 whitespace-nowrap"
              title="Telemetry Source: Local 10Hz Physics Simulator (Isolated from Live Hardware)"
            >
              <span className="w-2 h-2 rounded-full bg-[var(--accent-cobalt)] shrink-0" />
              <span className="font-semibold whitespace-nowrap">SIMULATED</span>
              <span className="opacity-60">•</span>
              <span className="tabular-nums whitespace-nowrap">10 Hz</span>
            </div>
          ) : telemetrySource === 'REMOTE_VIEWER' ? (
            <div
              className={`hidden lg:flex items-center gap-1.5 px-2 xl:px-2.5 py-1 border text-[11px] font-mono-data rounded-[var(--radius-sm)] shrink-0 whitespace-nowrap ${
                syncConnected && !isStale && latestPacket
                  ? 'bg-[var(--accent-cobalt-soft)] text-[var(--accent-cobalt)] border-[var(--accent-cobalt)]/30'
                  : isStale
                  ? 'bg-[var(--status-warning-bg)] text-[var(--status-warning)] border-[var(--status-warning)]/30'
                  : 'bg-[var(--bg-surface-2)] text-[var(--text-secondary)] border-[var(--border-subtle)]'
              }`}
              title={`Remote Viewer Sync | Role: ${syncRole || 'viewer'} | Packet Age: ${packetAgeSeconds !== null ? `${packetAgeSeconds.toFixed(1)}s` : '--'}`}
            >
              <Cloud className="w-3.5 h-3.5 shrink-0" />
              <span className="font-semibold whitespace-nowrap">
                {!syncConnected
                  ? 'SYNC OFFLINE'
                  : !latestPacket
                  ? 'AWAITING SNAPSHOT'
                  : isStale
                  ? `REMOTE STALE (${packetAgeSeconds !== null ? `${packetAgeSeconds.toFixed(1)}s` : '--'})`
                  : `REMOTE RX (${packetAgeSeconds !== null ? `${packetAgeSeconds.toFixed(1)}s` : '0.0s'})`}
              </span>
            </div>
          ) : (
            <div
              className={`hidden lg:flex items-center gap-1.5 px-2 xl:px-2.5 py-1 border text-[11px] font-mono-data rounded-[var(--radius-sm)] shrink-0 whitespace-nowrap ${
                serialState === 'CONNECTED' && !isStale && latestPacket
                  ? 'bg-[var(--status-nominal-bg)] text-[var(--status-nominal)] border-[var(--status-nominal)]/30'
                  : isStale
                  ? 'bg-[var(--status-warning-bg)] text-[var(--status-warning)] border-[var(--status-warning)]/30'
                  : 'bg-[var(--bg-surface-2)] text-[var(--text-secondary)] border-[var(--border-subtle)]'
              }`}
              title={`Live USB Serial @ ${liveBaudRate} baud | Valid: ${serialMetrics.validPacketsReceived} | Malformed: ${serialMetrics.malformedPacketsReceived}`}
            >
              <Radio className="w-3.5 h-3.5 shrink-0" />
              <span className="font-semibold whitespace-nowrap">
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
            className="hidden xl:flex items-center gap-1.5 px-2 xl:px-2.5 py-1 bg-[var(--bg-surface-2)] border border-[var(--border-subtle)] text-[11px] font-mono-data text-[var(--text-secondary)] rounded-[var(--radius-sm)] shrink-0 whitespace-nowrap"
            title={
              isSim
                ? 'Simulated Packet Sequence Number'
                : `Received Packet Sequence # | Valid Frames: ${serialMetrics.validPacketsReceived} | Malformed: ${serialMetrics.malformedPacketsReceived}`
            }
          >
            <Activity className="w-3.5 h-3.5 text-[var(--accent-teal)] shrink-0" />
            <span className="whitespace-nowrap">PKT</span>
            <span className="text-[var(--text-primary)] font-semibold tabular-nums whitespace-nowrap">
              {latestPacket ? `#${latestPacket.packetNumber}` : 'NONE'}
            </span>
          </div>

          {/* Battery Monitor Badge */}
          <div className="hidden 2xl:flex items-center gap-1.5 bg-[var(--bg-surface-2)] border border-[var(--border-subtle)] px-2.5 py-1 text-[11px] font-mono-data rounded-[var(--radius-sm)] shrink-0 whitespace-nowrap">
            <span className="text-[var(--text-secondary)] whitespace-nowrap">BATT</span>
            {optionalTelemetrySettings && !optionalTelemetrySettings.enableBatteryVoltage ? (
              <span className="text-[var(--text-tertiary)] font-mono text-[10px] whitespace-nowrap" title="Battery voltage monitoring disabled in Settings">
                DISABLED
              </span>
            ) : hasValidBatt ? (
              <>
                <span
                  className={`font-semibold tabular-nums whitespace-nowrap ${
                    latestPacket!.batteryVoltage! >= 6.4
                      ? 'text-[var(--status-nominal)]'
                      : 'text-[var(--status-warning)]'
                  }`}
                >
                  {latestPacket!.batteryVoltage!.toFixed(2)}V
                </span>
                {hasValidSoc && (
                  <span className="text-[var(--text-tertiary)] tabular-nums whitespace-nowrap">
                    ({latestPacket!.batterySoc!.toFixed(0)}%)
                  </span>
                )}
              </>
            ) : (
              <span className="text-[var(--text-tertiary)] tabular-nums whitespace-nowrap">UNAVAILABLE</span>
            )}
          </div>

          {/* Ground Station Computer Clock (IST / Asia/Kolkata) */}
          <div
            title={istClock.fullDateTimeTitle}
            className="font-mono-data text-xs text-[var(--text-primary)] font-medium px-2 xl:px-2.5 border-l border-[var(--border-subtle)] hidden md:block tabular-nums shrink-0 whitespace-nowrap"
          >
            {istClock.timeLabel}
          </div>

          {/* Simulation-only: reset simulator. Not rendered at all in Live Serial mode. */}
          {isSim && (
            <button
              type="button"
              onClick={onResetSimulation}
              title="Reset Telemetry Simulator to T=0.0s"
              className="hidden sm:inline-flex p-1.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-2)] transition-colors cursor-pointer border border-[var(--border-subtle)] rounded-[var(--radius-sm)] shrink-0"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          )}

          {/* Live Serial: static receive-only indicator (informational, not a control) */}
          {!isSim && (
            <span
              className="hidden 2xl:flex items-center gap-1.5 text-[11px] font-semibold px-2 xl:px-2.5 py-1 bg-[var(--bg-surface-2)] text-[var(--text-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-sm)] shrink-0 whitespace-nowrap"
              title="Live Serial is strictly receive-only: no hardware telecommands are sent"
            >
              <Rocket className="w-3.5 h-3.5 shrink-0" />
              <span className="whitespace-nowrap">RX ONLY</span>
            </span>
          )}
          {/* Raw Frame Drawer Toggle */}
          <button
            type="button"
            onClick={onToggleTerminal}
            title="Toggle Raw Stream & Frame Inspector Drawer"
            className={`p-1.5 transition-colors cursor-pointer border rounded-[var(--radius-sm)] shrink-0 ${
              isTerminalOpen
                ? 'text-[var(--accent-cobalt)] bg-[var(--accent-cobalt-soft)] border-[var(--accent-cobalt)]/40'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-2)] border-[var(--border-subtle)]'
            }`}
          >
            <Terminal className="w-4 h-4" />
          </button>

          {/* Real-Time Telemetry Synchronization / Cloud Relay */}
          {onOpenSyncModal && (
            <button
              type="button"
              onClick={onOpenSyncModal}
              title={
                syncConnected
                  ? `Cloud Sync Active (${syncRole?.toUpperCase()}) — Click to view session metrics`
                  : 'Configure Cloud Telemetry Relay (Publisher / Remote Viewer)'
              }
              className={`p-1.5 transition-colors cursor-pointer border rounded-[var(--radius-sm)] shrink-0 flex items-center gap-1 ${
                syncConnected
                  ? syncRole === 'publisher'
                    ? 'text-[var(--accent-teal)] bg-[var(--accent-teal)]/15 border-[var(--accent-teal)]/40 font-semibold'
                    : 'text-[var(--accent-cobalt)] bg-[var(--accent-cobalt-soft)] border-[var(--accent-cobalt)]/40 font-semibold'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-2)] border-[var(--border-subtle)]'
              }`}
            >
              <Cloud className="w-4 h-4" />
              <span className="hidden 2xl:inline text-[10px] font-mono-data uppercase">
                {syncConnected ? (syncRole === 'publisher' ? 'RELAY' : 'VIEW') : 'SYNC'}
              </span>
            </button>
          )}

          {/* Settings Modal Toggle */}
          <button
            type="button"
            onClick={onOpenSettingsModal}
            title="Ground Station & Vehicle Settings"
            className="p-1.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-2)] transition-colors cursor-pointer border border-[var(--border-subtle)] rounded-[var(--radius-sm)] shrink-0"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Second Row (Mobile & Tablet < lg): Always-Visible Field Status Strip */}
      <div
        data-testid="mobile-status-strip"
        className="flex lg:hidden items-center justify-between gap-1.5 w-full pt-1 border-t border-[var(--border-subtle)] text-[10px] font-mono-data overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
      >
        <div className="flex items-center gap-1.5 min-w-0 shrink-0">
          {/* Link & Freshness Status */}
          {telemetrySource === 'SIMULATION' ? (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-[var(--status-info-bg)] text-[var(--accent-cobalt)] border border-[var(--accent-cobalt)]/25 rounded-[var(--radius-xs)] font-semibold whitespace-nowrap">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-cobalt)]" />
              SIM 10Hz
            </span>
          ) : telemetrySource === 'REMOTE_VIEWER' ? (
            <span
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 border rounded-[var(--radius-xs)] font-semibold whitespace-nowrap ${
                syncConnected && !isStale && latestPacket
                  ? 'bg-[var(--accent-cobalt-soft)] text-[var(--accent-cobalt)] border-[var(--accent-cobalt)]/30'
                  : isStale
                  ? 'bg-[var(--status-warning-bg)] text-[var(--status-warning)] border-[var(--status-warning)]/40'
                  : 'bg-[var(--bg-surface-2)] text-[var(--text-secondary)] border-[var(--border-subtle)]'
              }`}
            >
              <Cloud className="w-3 h-3 shrink-0" />
              {!syncConnected
                ? 'SYNC OFF'
                : !latestPacket
                ? 'SYNC AWAIT'
                : isStale
                ? `STALE (${packetAgeSeconds !== null ? `${packetAgeSeconds.toFixed(1)}s` : '--'})`
                : `SYNC (${packetAgeSeconds !== null ? `${packetAgeSeconds.toFixed(1)}s` : '0.0s'})`}
            </span>
          ) : (
            <span
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 border rounded-[var(--radius-xs)] font-semibold whitespace-nowrap ${
                serialState === 'CONNECTED' && !isStale && latestPacket
                  ? 'bg-[var(--status-nominal-bg)] text-[var(--status-nominal)] border-[var(--status-nominal)]/30'
                  : isStale || serialState === 'ERROR'
                  ? 'bg-[var(--status-warning-bg)] text-[var(--status-warning)] border-[var(--status-warning)]/40'
                  : 'bg-[var(--bg-surface-2)] text-[var(--text-secondary)] border-[var(--border-subtle)]'
              }`}
            >
              <Radio className="w-3 h-3 shrink-0" />
              {serialState !== 'CONNECTED'
                ? `USB ${serialState}`
                : !latestPacket
                ? 'USB AWAITING RX'
                : isStale
                ? `STALE (${packetAgeSeconds !== null ? `${packetAgeSeconds.toFixed(1)}s` : '--'})`
                : `LIVE RX (${packetAgeSeconds !== null ? `${packetAgeSeconds.toFixed(1)}s` : '0.0s'})`}
            </span>
          )}

          {/* Packet sequence */}
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-[var(--bg-surface-2)] border border-[var(--border-subtle)] text-[var(--text-secondary)] rounded-[var(--radius-xs)] whitespace-nowrap tabular-nums">
            <span>PKT</span>
            <strong className="text-[var(--text-primary)]">
              {latestPacket ? `#${latestPacket.packetNumber}` : 'NONE'}
            </strong>
          </span>

          {/* Mission Phase */}
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-[var(--bg-surface-2)] border border-[var(--border-subtle)] text-[var(--text-primary)] font-semibold rounded-[var(--radius-xs)] whitespace-nowrap">
            {latestPacket ? latestPacket.fswStateName : 'STANDBY'}
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {/* Battery status */}
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-[var(--bg-surface-2)] border border-[var(--border-subtle)] rounded-[var(--radius-xs)] whitespace-nowrap tabular-nums">
            <span className="text-[var(--text-tertiary)]">BATT</span>
            {optionalTelemetrySettings && !optionalTelemetrySettings.enableBatteryVoltage ? (
              <span className="text-[var(--text-tertiary)]">OFF</span>
            ) : hasValidBatt ? (
              <strong
                className={
                  latestPacket!.batteryVoltage! >= 6.4
                    ? 'text-[var(--status-nominal)]'
                    : 'text-[var(--status-warning)]'
                }
              >
                {latestPacket!.batteryVoltage!.toFixed(2)}V
              </strong>
            ) : (
              <span className="text-[var(--text-tertiary)]">N/A</span>
            )}
          </span>

          {/* Team ID Provenance */}
          <span
            className={`hidden sm:inline-flex items-center px-1.5 py-0.5 border rounded-[var(--radius-xs)] font-bold uppercase whitespace-nowrap ${
              teamBadge.status === 'MISMATCH'
                ? 'bg-[var(--status-alert-bg)] text-[var(--status-alert)] border-[var(--status-alert)]/40'
                : teamBadge.status === 'VERIFIED'
                ? 'bg-[var(--status-nominal-bg)] text-[var(--status-nominal)] border-[var(--status-nominal)]/30'
                : teamBadge.status === 'SIMULATED'
                ? 'bg-[var(--status-info-bg)] text-[var(--accent-cobalt)] border-[var(--accent-cobalt)]/25'
                : 'bg-[var(--bg-surface-2)] text-[var(--text-tertiary)] border-[var(--border-subtle)]'
            }`}
          >
            {teamBadge.status === 'MISMATCH'
              ? `ID MISMATCH: ${teamBadge.mismatchedTeamId}`
              : teamBadge.status === 'VERIFIED'
              ? 'ID VERIFIED'
              : teamBadge.status === 'SIMULATED'
              ? 'SIMULATED ID'
              : 'AWAITING RX'}
          </span>
        </div>
      </div>
    </header>
  );
};

interface MobileWorkspaceNavProps {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
}

export const MobileWorkspaceNav: React.FC<MobileWorkspaceNavProps> = ({
  activeTab,
  setActiveTab,
}) => {
  const navItems: {
    id: ActiveTab;
    label: string;
    icon: React.ReactNode;
  }[] = [
    {
      id: 'OVERVIEW',
      label: 'Overview',
      icon: <LayoutDashboard className="w-4 h-4" />,
    },
    {
      id: 'LANDING_PREDICTOR',
      label: 'Predictor',
      icon: <Crosshair className="w-4 h-4" />,
    },
    {
      id: 'TELEMETRY',
      label: 'Telemetry',
      icon: <BarChart3 className="w-4 h-4" />,
    },
    {
      id: 'ATTITUDE_SENSORS',
      label: 'Attitude',
      icon: <Compass className="w-4 h-4" />,
    },
    {
      id: 'COMMS_LOGS',
      label: 'Comms',
      icon: <Radio className="w-4 h-4" />,
    },
  ];

  return (
    <nav
      aria-label="Mobile Field Operations Workspaces"
      data-testid="mobile-workspace-nav"
      className="lg:hidden grid grid-cols-5 bg-[var(--bg-surface-1)] border-t border-[var(--border-strong)] shadow-[var(--shadow-sm)] shrink-0 z-40 select-none pb-safe"
    >
      {navItems.map((item) => {
        const isActive = activeTab === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => setActiveTab(item.id)}
            aria-current={isActive ? 'page' : undefined}
            className={`flex flex-col items-center justify-center py-1.5 px-1 min-h-[48px] text-[10px] font-semibold transition-colors cursor-pointer relative ${
              isActive
                ? 'text-[var(--accent-cobalt)] bg-[var(--accent-cobalt-soft)]/55'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-2)]'
            }`}
          >
            {isActive && (
              <span className="absolute top-0 left-2 right-2 h-0.5 bg-[var(--accent-cobalt)] rounded-b-full" />
            )}
            <span className="shrink-0 mb-0.5">{item.icon}</span>
            <span className="truncate max-w-full leading-tight">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
};
