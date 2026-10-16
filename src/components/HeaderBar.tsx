import React, { useEffect, useState } from 'react';
import { Rocket, Settings, Terminal, Radio, Activity, RefreshCw, ClipboardCheck, BarChart3, MapPin } from 'lucide-react';
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
  const [packetFlash, setPacketFlash] = useState<boolean>(false);

  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      setUtcTime(`${now.toUTCString().split(' ')[4]} UTC`);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (latestPacket) {
      setPacketFlash(true);
      const timeout = setTimeout(() => setPacketFlash(false), 150);
      return () => clearTimeout(timeout);
    }
  }, [latestPacket?.packetNumber]);

  const tabs: { id: ActiveTab; label: string; icon: React.ReactNode }[] = [
    { id: 'MISSION', label: 'MISSION CONTROL', icon: <Radio className="w-3.5 h-3.5" /> },
    { id: 'TELEMETRY', label: 'CHARTS & SENSORS', icon: <BarChart3 className="w-3.5 h-3.5" /> },
    { id: 'GPS_MAP', label: 'GPS MAP', icon: <MapPin className="w-3.5 h-3.5" /> },
    { id: 'CHECKLIST', label: 'PRE-FLIGHT GO/NO-GO', icon: <ClipboardCheck className="w-3.5 h-3.5" /> },
    { id: 'ANALYTICS', label: 'JUDGE REPORT', icon: <Activity className="w-3.5 h-3.5" /> },
  ];

  return (
    <header className="flex justify-between items-center px-3 sm:px-4 h-16 w-full z-50 bg-[#10131A] border-b border-[#524533] fixed top-0 left-0 right-0 select-none">
      {/* Left Title & Team Identity */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-7 bg-[#FFD597] hidden sm:block"></div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-mono-data text-sm sm:text-base font-extrabold text-[#FFD597] tracking-tight">
                IN-SPACe CAN-7USAT
              </h1>
              <span className="bg-[#1D2026] text-[#38FA87] border border-[#38FA87]/40 text-[10px] font-mono-data font-bold px-1.5 py-0.2">
                #332
              </span>
            </div>
            <div className="font-mono-data text-[10px] text-[#D7C4AC] opacity-80 hidden lg:block">
              {TEAM_INFO.name} • {TEAM_INFO.institution}
            </div>
          </div>
        </div>

        {/* View Navigation Tabs */}
        <nav className="hidden xl:flex items-center gap-1 h-full ml-4">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-2.5 py-1 font-mono-data text-[11px] uppercase transition-colors flex items-center gap-1.5 h-full border-b-2 cursor-pointer ${
                  isActive
                    ? 'text-[#FFD597] border-[#FFD597] font-bold bg-[#1D2026]/80'
                    : 'text-[#D7C4AC] border-transparent hover:text-[#FFD597] hover:bg-[#191C22]'
                }`}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Right Telemetry Link Indicators & Global Actions */}
      <div className="flex items-center gap-2 sm:gap-3">
        {/* Packet Activity Heartbeat Indicator */}
        <div className="hidden md:flex items-center gap-2 px-2 py-1 bg-[#161B22] border border-[#2A2E35] text-[10px] font-mono-data text-[#D7C4AC]">
          <Activity className={`w-3.5 h-3.5 transition-colors ${packetFlash ? 'text-[#38FA87]' : 'text-[#9F8E78]'}`} />
          <span>PKT #{latestPacket?.packetNumber || 1240}</span>
          <span className="text-[#38FA87] text-[10px] font-bold">10 Hz</span>
        </div>

        {/* Radio Link Status Indicators */}
        <div className="flex items-center gap-2 border-r border-[#524533] pr-2 sm:pr-3">
          <div className="flex items-center gap-1" title="Zeminet 865MHz LoRa Primary Link">
            <Radio className="w-3.5 h-3.5 text-[#38FA87] hidden sm:block" />
            <span className="font-mono-data text-[10px] text-[#D7C4AC]">LoRa 865MHz</span>
            <div className="w-2 h-2 rounded-full bg-[#38FA87] active-link-indicator"></div>
          </div>
        </div>

        {/* 2S Battery Bar Badge */}
        <div className="hidden lg:flex items-center gap-1.5 bg-[#161B22] border border-[#2A2E35] px-2 py-0.5 text-[10px] font-mono-data">
          <span className="text-[#9F8E78]">2S BATT:</span>
          <span className="text-[#38FA87] font-bold">
            {latestPacket?.batteryVoltage.toFixed(2) || '7.85'}V ({latestPacket?.batterySoc.toFixed(0) || '85'}%)
          </span>
        </div>

        {/* UTC Clock Display */}
        <div className="font-mono-data text-xs text-[#FFD597] font-semibold pr-2 border-r border-[#524533] hidden sm:block">
          {utcTime}
        </div>

        {/* Reset Simulation Quick Button */}
        <button
          onClick={onResetSimulation}
          title="Reset Telemetry Engine"
          className="p-1.5 text-[#D7C4AC] hover:text-[#FFD597] hover:bg-[#272A31] transition-colors cursor-pointer border border-[#2A2E35]"
        >
          <RefreshCw className="w-4 h-4" />
        </button>

        {/* Primary Mission Action: DISREEF OVERRIDE / DEPLOY */}
        <button
          onClick={onOpenDeployModal}
          className="bg-[#FFB000] text-[#000] font-mono-data text-xs font-extrabold px-3 py-1.5 uppercase hover:bg-[#FFD597] transition-all cursor-pointer active:opacity-80 tracking-wider flex items-center gap-1.5 shadow-lg"
        >
          <Rocket className="w-4 h-4" />
          <span>COMMANDS</span>
        </button>

        {/* Console Terminal Toggle */}
        <button
          onClick={onToggleTerminal}
          title="Toggle Command & Raw Stream Terminal"
          className={`p-1.5 transition-colors cursor-pointer border border-[#2A2E35] ${
            isTerminalOpen
              ? 'text-[#FFD597] bg-[#272A31] border-[#FFD597]'
              : 'text-[#D7C4AC] hover:text-[#FFD597] hover:bg-[#272A31]'
          }`}
        >
          <Terminal className="w-4 h-4" />
        </button>

        {/* Settings Modal Toggle */}
        <button
          onClick={onOpenSettingsModal}
          title="Team & Hardware Specifications"
          className="p-1.5 text-[#D7C4AC] hover:text-[#FFD597] hover:bg-[#272A31] transition-colors cursor-pointer border border-[#2A2E35]"
        >
          <Settings className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
};
