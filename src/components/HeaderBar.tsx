import React, { useEffect, useState } from 'react';
import { Rocket, Settings, Terminal, Radio, Activity, RefreshCw, ClipboardCheck, BarChart3, MapPin, Cpu } from 'lucide-react';
import { ActiveTab, TelemetryPacket } from '../types';
import { TEAM_INFO } from '../constants';

interface HeaderBarProps {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  latestPacket: TelemetryPacket | null;
  onOpenDeployModal: () => void;
  onOpenSettingsModal: () => void;
  onToggleTerminal: () => void;
  isTerminalOpen: boolean;
  onResetSimulation: () => void;
}

export const HeaderBar: React.FC<HeaderBarProps> = ({
  activeTab,
  setActiveTab,
  latestPacket,
  onOpenDeployModal,
  onOpenSettingsModal,
  onToggleTerminal,
  isTerminalOpen,
  onResetSimulation,
}) => {
  const [utcTime, setUtcTime] = useState<string>('00:00:00 UTC');

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setUtcTime(`${now.toUTCString().split(' ')[4]} UTC`);
    };
    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, []);

  const tabs: { id: ActiveTab; label: string; icon: React.ReactNode }[] = [
    { id: 'MISSION', label: 'Mission Control', icon: <Radio className="w-3.5 h-3.5" /> },
    { id: 'TELEMETRY', label: 'Telemetry & Charts', icon: <BarChart3 className="w-3.5 h-3.5" /> },
    { id: 'GPS_MAP', label: 'GPS Tracking', icon: <MapPin className="w-3.5 h-3.5" /> },
    { id: 'CHECKLIST', label: 'Pre-Flight Checklist', icon: <ClipboardCheck className="w-3.5 h-3.5" /> },
    { id: 'ANALYTICS', label: 'Judge Report', icon: <Activity className="w-3.5 h-3.5" /> },
  ];

  return (
    <header className="flex justify-between items-center px-3 sm:px-4 h-14 w-full z-50 bg-[var(--bg-surface-1)] border-b border-[var(--border-subtle)] fixed top-0 left-0 right-0 select-none">
      {/* Left Title & Team Identity */}
      <div className="flex items-center gap-3 sm:gap-4">
        <div className="flex items-center gap-2.5">
          <div className="w-1 h-6 bg-[var(--action-amber)] rounded-[var(--radius-xs)] hidden sm:block"></div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-mono-data text-xs sm:text-sm font-bold text-[var(--text-primary)] tracking-tight">
                IN-SPACe CAN-7USAT
              </h1>
              <span className="bg-[var(--bg-surface-elevated)] text-[var(--status-nominal)] border border-[var(--border-subtle)] text-[10px] font-mono-data font-semibold px-1.5 py-0.2 rounded-[var(--radius-xs)]">
                #332
              </span>
            </div>
            <div className="text-[10px] text-[var(--text-secondary)] opacity-90 hidden md:block">
              {TEAM_INFO.name} • {TEAM_INFO.institution}
            </div>
          </div>
        </div>

        {/* View Navigation Tabs */}
        <nav className="hidden lg:flex items-center gap-1 h-full ml-2">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-2.5 py-1 text-xs font-medium transition-colors flex items-center gap-1.5 h-9 rounded-[var(--radius-sm)] border cursor-pointer ${
                  isActive
                    ? 'text-[var(--text-primary)] border-[var(--border-amber)] bg-[var(--bg-surface-elevated)] font-semibold'
                    : 'text-[var(--text-secondary)] border-transparent hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-2)]'
                }`}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Mobile / Tablet View Switcher Dropdown (< lg) */}
        <div className="flex lg:hidden items-center ml-1">
          <select
            value={activeTab}
            onChange={(e) => setActiveTab(e.target.value as ActiveTab)}
            aria-label="Navigation View Switcher"
            className="bg-[var(--bg-surface-2)] border border-[var(--border-subtle)] text-[var(--text-primary)] font-mono-data text-[11px] px-2 py-1 rounded-[var(--radius-sm)] focus:border-[var(--border-focus)] outline-none cursor-pointer h-8"
          >
            {tabs.map((tab) => (
              <option key={tab.id} value={tab.id}>
                {tab.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Right Telemetry Link Indicators & Global Actions */}
      <div className="flex items-center gap-2 sm:gap-2.5">
        {/* Transparent Simulation Source Indicator */}
        <div
          className="flex items-center gap-1.5 px-2 py-0.5 bg-[var(--bg-surface-2)] border border-[var(--border-subtle)] text-[10px] font-mono-data text-[var(--text-secondary)] rounded-[var(--radius-xs)]"
          title="Telemetry Feed Source: In-Browser 10Hz Flight Physics Simulator"
        >
          <Cpu className="w-3 h-3 text-[var(--status-info)]" />
          <span className="text-[var(--status-info)] font-semibold hidden sm:inline">SIM ENGINE</span>
          <span className="text-[var(--text-tertiary)] hidden sm:inline">|</span>
          <span className="text-[var(--text-primary)] tabular-nums">10.0 Hz</span>
        </div>

        {/* Steady Telemetry Packet Counter (No Flashing) */}
        <div className="hidden md:flex items-center gap-1.5 px-2 py-0.5 bg-[var(--bg-surface-2)] border border-[var(--border-subtle)] text-[10px] font-mono-data text-[var(--text-secondary)] rounded-[var(--radius-xs)]">
          <Activity className="w-3 h-3 text-[var(--status-nominal)]" />
          <span>PKT</span>
          <span className="text-[var(--text-primary)] font-bold tabular-nums">
            {latestPacket ? `#${latestPacket.packetNumber}` : 'STANDBY'}
          </span>
        </div>

        {/* Radio Protocol Specification Tag */}
        <div
          className="hidden xl:flex items-center gap-1.5 px-2 py-0.5 bg-[var(--bg-surface-2)] border border-[var(--border-subtle)] text-[10px] font-mono-data text-[var(--text-secondary)] rounded-[var(--radius-xs)]"
          title="Protocol Specification: Zeminet LoRa 865MHz"
        >
          <Radio className="w-3 h-3 text-[var(--status-nominal)]" />
          <span>865 MHz LoRa</span>
        </div>

        {/* 2S Battery Monitor Badge */}
        <div className="hidden sm:flex items-center gap-1.5 bg-[var(--bg-surface-2)] border border-[var(--border-subtle)] px-2 py-0.5 text-[10px] font-mono-data rounded-[var(--radius-xs)]">
          <span className="text-[var(--text-secondary)]">2S BATT:</span>
          {latestPacket ? (
            <>
              <span className="text-[var(--status-nominal)] font-bold tabular-nums">
                {latestPacket.batteryVoltage.toFixed(2)}V
              </span>
              <span className="text-[var(--text-tertiary)] tabular-nums">
                ({latestPacket.batterySoc.toFixed(0)}%)
              </span>
            </>
          ) : (
            <span className="text-[var(--text-tertiary)] tabular-nums">--</span>
          )}
        </div>

        {/* UTC Clock Display */}
        <div className="font-mono-data text-xs text-[var(--text-primary)] font-medium px-2 border-l border-[var(--border-subtle)] hidden sm:block tabular-nums">
          {utcTime}
        </div>

        {/* Reset Simulation Quick Action */}
        <button
          onClick={onResetSimulation}
          title="Reset Telemetry Engine to T=0.0s"
          className="p-1.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-2)] transition-colors cursor-pointer border border-[var(--border-subtle)] rounded-[var(--radius-xs)]"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>

        {/* Primary Mission Action: TELECOMMANDS / DEPLOY */}
        <button
          onClick={onOpenDeployModal}
          className="bg-[var(--action-amber)] hover:bg-[var(--action-amber-hover)] text-[var(--action-amber-contrast)] font-mono-data text-xs font-bold px-3 py-1.5 uppercase transition-colors cursor-pointer active:opacity-90 tracking-wide flex items-center gap-1.5 rounded-[var(--radius-xs)]"
        >
          <Rocket className="w-3.5 h-3.5" />
          <span>COMMANDS</span>
        </button>

        {/* Console Terminal Toggle */}
        <button
          onClick={onToggleTerminal}
          title="Toggle Command & Raw Stream Terminal"
          className={`p-1.5 transition-colors cursor-pointer border rounded-[var(--radius-xs)] ${
            isTerminalOpen
              ? 'text-[var(--action-amber)] bg-[var(--bg-surface-elevated)] border-[var(--border-amber)]'
              : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-2)] border-[var(--border-subtle)]'
          }`}
        >
          <Terminal className="w-3.5 h-3.5" />
        </button>

        {/* Settings Modal Toggle */}
        <button
          onClick={onOpenSettingsModal}
          title="Ground Station & Vehicle Settings"
          className="p-1.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-2)] transition-colors cursor-pointer border border-[var(--border-subtle)] rounded-[var(--radius-xs)]"
        >
          <Settings className="w-3.5 h-3.5" />
        </button>
      </div>
    </header>
  );
};
