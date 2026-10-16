import React, { useEffect, useState } from 'react';
import { HeaderBar } from './components/HeaderBar';
import { TelemetryChartPanel } from './components/TelemetryChartPanel';
import { ThreeAttitudeViewport } from './components/ThreeAttitudeViewport';
import { GpsTrackingMap } from './components/GpsTrackingMap';
import { SerialLinkPanel } from './components/SerialLinkPanel';
import { MissionControlPanel } from './components/MissionControlPanel';
import { FlightStatePanel } from './components/FlightStatePanel';
import { RawReadoutsPanel } from './components/RawReadoutsPanel';
import { TerminalDrawer } from './components/TerminalDrawer';
import { DeployConfirmationModal } from './components/DeployConfirmationModal';
import { SettingsModal } from './components/SettingsModal';
import { PreflightChecklistPanel } from './components/PreflightChecklistPanel';
import { JudgeReportPanel } from './components/JudgeReportPanel';

import { globalTelemetryEngine } from './services/telemetrySimulator';
import { ActiveTab, FlightStateCode, SerialConfig, TelemetryPacket } from './types';
import { TEAM_INFO } from './constants';

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('MISSION');
  const [latestPacket, setLatestPacket] = useState<TelemetryPacket | null>(null);
  const [historyPackets, setHistoryPackets] = useState<TelemetryPacket[]>([]);
  const [rawLogs, setRawLogs] = useState<{ time: string; text: string; type: 'rx' | 'tx' | 'sys' }[]>([]);

  // Modals & Drawers
  const [isTerminalOpen, setIsTerminalOpen] = useState<boolean>(false);
  const [isDeployModalOpen, setIsDeployModalOpen] = useState<boolean>(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState<boolean>(false);

  // Serial Port Config
  const [serialConfig, setSerialConfig] = useState<SerialConfig>({
    port: 'COM10 (Zeminet LoRa 865MHz)',
    baudRate: 115200,
    connected: true,
    rxCount: 1240,
    txCount: 42,
  });

  const [isRunning, setIsRunning] = useState<boolean>(true);

  // Subscribe to Telemetry Engine
  useEffect(() => {
    const unsubscribe = globalTelemetryEngine.subscribe((packet, rawSentence) => {
      setLatestPacket(packet);

      setHistoryPackets((prev) => {
        const next = [...prev, packet];
        if (next.length > 300) next.shift(); // Keep latest 300 data points
        return next;
      });

      // Append Rx raw sentence
      setRawLogs((prev) => {
        const next = [
          ...prev,
          {
            time: packet.timestampUtc,
            text: rawSentence,
            type: 'rx' as const,
          },
        ];
        if (next.length > 300) next.shift();
        return next;
      });

      setSerialConfig((prev) => ({
        ...prev,
        rxCount: packet.packetNumber,
      }));
    });

    return () => unsubscribe();
  }, []);

  const handleTogglePlay = () => {
    globalTelemetryEngine.togglePlay();
    setIsRunning(globalTelemetryEngine.getIsRunning());
    addLog(`[SYSTEM] Telemetry streaming ${globalTelemetryEngine.getIsRunning() ? 'RESUMED' : 'PAUSED'}`, 'sys');
  };

  const handleResetSimulation = () => {
    globalTelemetryEngine.resetMission();
    setHistoryPackets([]);
    addLog('[SYSTEM] Mission simulation parameters reset to T=0.0s', 'sys');
  };

  const handleCalibrateSensors = () => {
    handleSendCommand(`CMD,${TEAM_INFO.id},CALIBRATE,1`);
    setTimeout(() => {
      addLog(`[SIM_ACK] (${TEAM_INFO.id}) Simulated IMU zero & MS5611 baro calibration applied locally (no hardware OBC link).`, 'rx');
    }, 800);
  };

  const handleInjectTurbulence = () => {
    globalTelemetryEngine.injectDisturbance(1.5);
    addLog('[SIM_ENV] Disturbance impulse injected: 1.5G pitch/roll aerodynamic disturbance (local simulator)', 'sys');
  };

  const handleOverrideState = (state: FlightStateCode | null) => {
    globalTelemetryEngine.setStateOverride(state);
    addLog(`[SIM_FSW] Simulated flight software state set to: ${state !== null ? FlightStateCode[state] : 'AUTO (SIM TIMELINE)'}`, 'sys');
  };

  const handleToggleConnect = () => {
    setSerialConfig((prev) => {
      const nextConn = !prev.connected;
      addLog(
        `[SIM_LINK] Simulated stream (${prev.port}) ${nextConn ? `RESUMED @ ${prev.baudRate} 8N1 profile` : 'PAUSED'} — no physical serial connection`,
        'sys'
      );
      if (!nextConn) {
        globalTelemetryEngine.pause();
        setIsRunning(false);
      } else {
        globalTelemetryEngine.start();
        setIsRunning(true);
      }
      return { ...prev, connected: nextConn };
    });
  };

  const handleSendCommand = (cmd: string) => {
    addLog(cmd, 'tx');
    setSerialConfig((prev) => ({ ...prev, txCount: prev.txCount + 1 }));
    setTimeout(() => {
      addLog(`[SIM_ACK] (${TEAM_INFO.id}) Command '${cmd.split(',')[2] || cmd}' processed by local simulator (no RF hardware transmission).`, 'rx');
    }, 400);
  };

  const addLog = (text: string, type: 'rx' | 'tx' | 'sys') => {
    const now = new Date();
    const timeStr = now.toISOString().split('T')[1].slice(0, 8);
    setRawLogs((prev) => {
      const next = [...prev, { time: timeStr, text, type }];
      if (next.length > 300) next.shift();
      return next;
    });
  };

  const handleConfirmDeploy = () => {
    globalTelemetryEngine.triggerBurnwireDisreef();
    handleSendCommand(`CMD,${TEAM_INFO.id},DISREEF,OVERRIDE`);
    handleOverrideState(FlightStateCode.AEROBREAK_RELEASE);
  };

  return (
    <div className="bg-[var(--bg-base)] text-[var(--text-primary)] h-screen flex flex-col overflow-hidden select-none">
      {/* Top Header Bar */}
      <HeaderBar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        latestPacket={latestPacket}
        onOpenDeployModal={() => setIsDeployModalOpen(true)}
        onOpenSettingsModal={() => setIsSettingsModalOpen(true)}
        onToggleTerminal={() => setIsTerminalOpen(!isTerminalOpen)}
        isTerminalOpen={isTerminalOpen}
        onResetSimulation={handleResetSimulation}
      />

      {/* Main Dashboard Workspace Content Area */}
      <main className="flex-1 mt-14 p-1.5 bg-[var(--bg-base)] overflow-y-auto lg:overflow-hidden h-[calc(100vh-3.5rem)]">
        {/* TAB 1: MISSION CONTROL (Full Dashboard Console) */}
        {activeTab === 'MISSION' && (
          <div className="flex flex-col lg:flex-row gap-1.5 h-full overflow-y-auto lg:overflow-hidden">
            {/* Left & Center Main Column */}
            <div className="flex-1 flex flex-col gap-1.5 overflow-hidden min-h-[540px] lg:min-h-0 lg:h-full">
              {/* 2x2 Telemetry Graph Grid (Top 58% height) */}
              <div className="h-[58%] min-h-[300px]">
                <TelemetryChartPanel history={historyPackets} latestPacket={latestPacket} />
              </div>

              {/* Spatial Row (3D Orientation + GPS Map) (Bottom 42% height) */}
              <div className="h-[42%] grid grid-cols-1 sm:grid-cols-2 gap-1.5 min-h-[220px]">
                <ThreeAttitudeViewport latestPacket={latestPacket} />
                <GpsTrackingMap latestPacket={latestPacket} historyPackets={historyPackets} />
              </div>
            </div>

            {/* Right Sidebar Column (320px fixed width on desktop, smoothly scrollable on small vertical displays) */}
            <div className="w-full lg:w-80 flex flex-col gap-1.5 overflow-y-auto h-full pr-0.5">
              <SerialLinkPanel
                config={serialConfig}
                onUpdateConfig={(cfg) => setSerialConfig((prev) => ({ ...prev, ...cfg }))}
                onToggleConnect={handleToggleConnect}
              />

              <MissionControlPanel
                isRunning={isRunning}
                onTogglePlay={handleTogglePlay}
                onCalibrateSensors={handleCalibrateSensors}
                onInjectDisturbance={handleInjectTurbulence}
                onResetSimulation={handleResetSimulation}
              />

              <FlightStatePanel
                latestPacket={latestPacket}
                onOverrideState={handleOverrideState}
              />

              <RawReadoutsPanel latestPacket={latestPacket} historyPackets={historyPackets} />
            </div>
          </div>
        )}

        {/* TAB 2: TELEMETRY CHARTS & EXPANDED METRICS */}
        {activeTab === 'TELEMETRY' && (
          <div className="h-full w-full p-1 bg-[var(--bg-base)] flex flex-col gap-1">
            <div className="flex-1">
              <TelemetryChartPanel history={historyPackets} latestPacket={latestPacket} />
            </div>
          </div>
        )}

        {/* TAB 3: GPS MAP & SATELLITE TRACKING */}
        {activeTab === 'GPS_MAP' && (
          <div className="h-full w-full p-1 bg-[var(--bg-base)] grid grid-cols-1 lg:grid-cols-3 gap-1.5">
            <div className="lg:col-span-2 h-full min-h-[350px]">
              <GpsTrackingMap latestPacket={latestPacket} historyPackets={historyPackets} />
            </div>
            <div className="h-full min-h-[350px]">
              <ThreeAttitudeViewport latestPacket={latestPacket} />
            </div>
          </div>
        )}

        {/* TAB 4: PRE-FLIGHT GO/NO-GO CHECKLIST */}
        {activeTab === 'CHECKLIST' && (
          <PreflightChecklistPanel
            latestPacket={latestPacket}
            onStartLaunch={() => {
              globalTelemetryEngine.resetMission();
              handleOverrideState(FlightStateCode.ASCENT);
              setActiveTab('MISSION');
            }}
          />
        )}

        {/* TAB 5: COMPETITION JUDGE MISSION REPORT */}
        {activeTab === 'ANALYTICS' && (
          <JudgeReportPanel historyPackets={historyPackets} latestPacket={latestPacket} />
        )}
      </main>

      {/* Terminal Slide-out Drawer */}
      <TerminalDrawer
        isOpen={isTerminalOpen}
        onClose={() => setIsTerminalOpen(false)}
        rawLogEntries={rawLogs}
        historyPackets={historyPackets}
        onSendCommand={handleSendCommand}
        onClearLogs={() => setRawLogs([])}
      />

      {/* Deploy Critical Safety Modal */}
      <DeployConfirmationModal
        isOpen={isDeployModalOpen}
        onClose={() => setIsDeployModalOpen(false)}
        onConfirmDeploy={handleConfirmDeploy}
      />

      {/* Ground Station Settings Modal */}
      <SettingsModal
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
      />
    </div>
  );
}
