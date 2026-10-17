import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Battery,
  CheckCircle2,
  Crosshair,
  ExternalLink,
  Layers,
  Radio,
  Satellite,
  ShieldAlert,
  Terminal,
} from 'lucide-react';
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
import { LandingPredictorWorkspace } from './components/LandingPredictorWorkspace';

import { globalTelemetryEngine } from './services/telemetrySimulator';
import { globalSerialTelemetry } from './services/serialTelemetry';
import {
  DEFAULT_PREDICTOR_CONFIG,
  computeLocalPhysicsPrediction,
} from './services/landingPredictorClient';
import {
  ActiveTab,
  FlightStateCode,
  RawLogEntry,
  SerialConfig,
  SerialConnectionState,
  SerialMetrics,
  TelemetryPacket,
  TelemetrySource,
} from './types';
import { TEAM_INFO } from './constants';

const STALE_PACKET_THRESHOLD_SEC = 3.0;

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('OVERVIEW');
  const [telemetrySource, setTelemetrySource] =
    useState<TelemetrySource>('SIMULATION');
  const telemetrySourceRef = useRef<TelemetrySource>('SIMULATION');

  // Isolated Simulation Telemetry State
  const [simLatestPacket, setSimLatestPacket] =
    useState<TelemetryPacket | null>(null);
  const [simHistoryPackets, setSimHistoryPackets] = useState<TelemetryPacket[]>(
    []
  );

  // Isolated Live USB-Serial Telemetry State
  const [liveLatestPacket, setLiveLatestPacket] =
    useState<TelemetryPacket | null>(null);
  const [liveHistoryPackets, setLiveHistoryPackets] = useState<
    TelemetryPacket[]
  >([]);
  const [liveBaudRate, setLiveBaudRate] = useState<number>(115200);
  const [serialState, setSerialState] = useState<SerialConnectionState>(
    globalSerialTelemetry.getState()
  );
  const [serialMetrics, setSerialMetrics] = useState<SerialMetrics>(
    globalSerialTelemetry.getMetrics()
  );
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  // Terminal Log Buffer
  const [rawLogs, setRawLogs] = useState<RawLogEntry[]>([]);

  // Modals & Drawers
  const [isTerminalOpen, setIsTerminalOpen] = useState<boolean>(false);
  const [isDeployModalOpen, setIsDeployModalOpen] = useState<boolean>(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] =
    useState<boolean>(false);

  // Simulation Serial Port Config
  const [serialConfig, setSerialConfig] = useState<SerialConfig>({
    port: 'COM10 (Zeminet LoRa 865MHz)',
    baudRate: 115200,
    connected: true,
    rxCount: 1240,
    txCount: 0,
  });

  const [isRunning, setIsRunning] = useState<boolean>(true);

  useEffect(() => {
    telemetrySourceRef.current = telemetrySource;
  }, [telemetrySource]);

  // Periodic clock tick for live packet age and staleness detection
  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 250);
    return () => window.clearInterval(timer);
  }, []);

  const addLog = (
    text: string,
    type: 'rx' | 'tx' | 'sys' | 'err',
    source: TelemetrySource = telemetrySourceRef.current
  ) => {
    const now = new Date();
    const timeStr = now.toISOString().split('T')[1].slice(0, 8);
    setRawLogs((prev) => {
      const next = [...prev, { time: timeStr, text, type, source }];
      if (next.length > 300) next.shift();
      return next;
    });
  };

  // Subscribe to Simulation Telemetry Engine
  useEffect(() => {
    const unsubscribe = globalTelemetryEngine.subscribe(
      (packet, rawSentence) => {
        // Never allow simulator updates to overwrite or log while LIVE_SERIAL is selected
        if (telemetrySourceRef.current !== 'SIMULATION') {
          return;
        }

        setSimLatestPacket(packet);

        setSimHistoryPackets((prev) => {
          const next = [...prev, packet];
          if (next.length > 300) next.shift();
          return next;
        });

        setRawLogs((prev) => {
          const next: RawLogEntry[] = [
            ...prev,
            {
              time: packet.timestampUtc,
              text: rawSentence,
              type: 'rx',
              source: 'SIMULATION',
            },
          ];
          if (next.length > 300) next.shift();
          return next;
        });

        setSerialConfig((prev) => ({
          ...prev,
          rxCount: packet.packetNumber,
        }));
      }
    );

    return () => unsubscribe();
  }, []);

  // Subscribe to Live Web Serial Telemetry Service
  useEffect(() => {
    const unsubscribe = globalSerialTelemetry.subscribe({
      onPacket: (packet, rawLine) => {
        setLiveLatestPacket(packet);
        setNowMs(Date.now());

        setLiveHistoryPackets((prev) => {
          const next = [...prev, packet];
          if (next.length > 300) next.shift();
          return next;
        });

        const rxTimeStr =
          packet.receivedAtTimeStr ??
          new Date(packet.receivedAtMs ?? Date.now())
            .toISOString()
            .slice(11, 19);
        setRawLogs((prev) => {
          const next: RawLogEntry[] = [
            ...prev,
            {
              time: rxTimeStr,
              text: rawLine,
              type: 'rx',
              source: 'LIVE_SERIAL',
            },
          ];
          if (next.length > 300) next.shift();
          return next;
        });
      },
      onMalformedLine: (rawLine, reason) => {
        const now = new Date();
        const timeStr = now.toISOString().split('T')[1].slice(0, 8);
        setRawLogs((prev) => {
          const next: RawLogEntry[] = [
            ...prev,
            {
              time: timeStr,
              text: `${rawLine}  [REJECTED: ${reason}]`,
              type: 'err',
              source: 'LIVE_SERIAL',
            },
          ];
          if (next.length > 300) next.shift();
          return next;
        });
      },
      onStatusChange: (state, metrics, message) => {
        setSerialState(state);
        setSerialMetrics(metrics);
        if (message) {
          addLog(
            `[USB_SERIAL] ${message}`,
            state === 'ERROR' ? 'err' : 'sys',
            'LIVE_SERIAL'
          );
        }
      },
    });

    return () => {
      unsubscribe();
      void globalSerialTelemetry.disconnect();
    };
  }, []);

  // Switch between SIMULATION and LIVE_SERIAL cleanly
  const handleSelectSource = (nextSource: TelemetrySource) => {
    if (nextSource === telemetrySource) return;

    telemetrySourceRef.current = nextSource;
    setTelemetrySource(nextSource);

    if (nextSource === 'LIVE_SERIAL') {
      // Stop simulator from ticking while in live serial mode
      globalTelemetryEngine.pause();
      setIsRunning(false);
      addLog(
        '[SYSTEM] Switched source to LIVE SERIAL (receive-only). Click CONNECT USB SERIAL to open COM port.',
        'sys',
        'LIVE_SERIAL'
      );
    } else {
      // Disconnect live serial if active and resume simulation cleanly
      if (
        globalSerialTelemetry.getState() === 'CONNECTED' ||
        globalSerialTelemetry.getState() === 'CONNECTING'
      ) {
        void globalSerialTelemetry.disconnect();
      }
      if (serialConfig.connected) {
        globalTelemetryEngine.start();
        setIsRunning(true);
      }
      addLog(
        '[SYSTEM] Switched source to SIMULATION ENGINE (10 Hz loopback).',
        'sys',
        'SIMULATION'
      );
    }
  };

  const handleConnectLiveSerial = () => {
    if (telemetrySourceRef.current !== 'LIVE_SERIAL') {
      handleSelectSource('LIVE_SERIAL');
    }
    void globalSerialTelemetry.connect(liveBaudRate);
  };

  const handleDisconnectLiveSerial = () => {
    // Disconnecting live serial must NOT switch back to simulation
    void globalSerialTelemetry.disconnect();
  };

  // Simulation-only handlers (strictly blocked in LIVE_SERIAL mode)
  const handleTogglePlay = () => {
    if (telemetrySource !== 'SIMULATION') return;
    globalTelemetryEngine.togglePlay();
    setIsRunning(globalTelemetryEngine.getIsRunning());
    addLog(
      `[SIM_ENGINE] Simulated telemetry streaming ${
        globalTelemetryEngine.getIsRunning() ? 'RESUMED' : 'PAUSED'
      }`,
      'sys',
      'SIMULATION'
    );
  };

  const handleResetSimulation = () => {
    if (telemetrySource !== 'SIMULATION') return;
    globalTelemetryEngine.resetMission();
    setSimHistoryPackets([]);
    addLog(
      '[SIM_ENGINE] Mission simulation parameters reset to T=0.0s',
      'sys',
      'SIMULATION'
    );
  };

  const handleCalibrateSensors = () => {
    if (telemetrySource !== 'SIMULATION') return;
    handleSendCommand(`CMD,${TEAM_INFO.id},CALIBRATE,1`);
    setTimeout(() => {
      if (telemetrySourceRef.current !== 'SIMULATION') return;
      addLog(
        `[SIM_ACK] (${TEAM_INFO.id}) Simulated IMU zero & MS5611 baro calibration applied locally (no hardware OBC link).`,
        'rx',
        'SIMULATION'
      );
    }, 800);
  };

  const handleInjectTurbulence = () => {
    if (telemetrySource !== 'SIMULATION') return;
    globalTelemetryEngine.injectDisturbance(1.5);
    addLog(
      '[SIM_ENV] Disturbance impulse injected: 1.5G pitch/roll aerodynamic disturbance (local simulator)',
      'sys',
      'SIMULATION'
    );
  };

  const handleOverrideState = (state: FlightStateCode | null) => {
    if (telemetrySource !== 'SIMULATION') return;
    globalTelemetryEngine.setStateOverride(state);
    addLog(
      `[SIM_FSW] Simulated flight software state set to: ${
        state !== null ? FlightStateCode[state] : 'AUTO (SIM TIMELINE)'
      }`,
      'sys',
      'SIMULATION'
    );
  };

  const handleToggleSimConnect = () => {
    if (telemetrySource !== 'SIMULATION') return;
    setSerialConfig((prev) => {
      const nextConn = !prev.connected;
      addLog(
        `[SIM_LINK] Simulated stream (${prev.port}) ${
          nextConn
            ? `RESUMED @ ${prev.baudRate} 8N1 profile`
            : 'PAUSED'
        } — no physical serial connection`,
        'sys',
        'SIMULATION'
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
    // Strictly block command transmission or fake ACKs in LIVE_SERIAL mode
    if (telemetrySource !== 'SIMULATION') {
      addLog(
        '[SECURITY] Command transmission blocked: Live Serial mode is strictly receive-only.',
        'err',
        'LIVE_SERIAL'
      );
      return;
    }
    addLog(cmd, 'tx', 'SIMULATION');
    setSerialConfig((prev) => ({ ...prev, txCount: prev.txCount + 1 }));
    setTimeout(() => {
      if (telemetrySourceRef.current !== 'SIMULATION') return;
      addLog(
        `[SIM_ACK] (${TEAM_INFO.id}) Command '${
          cmd.split(',')[2] || cmd
        }' processed by local simulator (no RF hardware transmission).`,
        'rx',
        'SIMULATION'
      );
    }, 400);
  };

  const handleConfirmDeploy = () => {
    if (telemetrySource !== 'SIMULATION') return;
    globalTelemetryEngine.triggerBurnwireDisreef();
    handleSendCommand(`CMD,${TEAM_INFO.id},DISREEF,OVERRIDE`);
    handleOverrideState(FlightStateCode.AEROBREAK_RELEASE);
  };

  // Active telemetry state based on selected source
  const activeLatestPacket =
    telemetrySource === 'SIMULATION' ? simLatestPacket : liveLatestPacket;
  const activeHistoryPackets =
    telemetrySource === 'SIMULATION' ? simHistoryPackets : liveHistoryPackets;

  const packetAgeSeconds =
    telemetrySource === 'LIVE_SERIAL' &&
    liveLatestPacket?.receivedAtMs !== undefined
      ? Math.max(0, (nowMs - liveLatestPacket.receivedAtMs) / 1000)
      : null;

  const isLiveStale =
    telemetrySource === 'LIVE_SERIAL' &&
    liveLatestPacket !== null &&
    (serialState !== 'CONNECTED' ||
      (packetAgeSeconds !== null &&
        packetAgeSeconds > STALE_PACKET_THRESHOLD_SEC));

  // Overview Landing Predictor summary (source-isolated and gated)
  const overviewPrediction = useMemo(() => {
    return computeLocalPhysicsPrediction(
      activeHistoryPackets,
      DEFAULT_PREDICTOR_CONFIG,
      telemetrySource,
      packetAgeSeconds,
      isLiveStale
    );
  }, [activeHistoryPackets, telemetrySource, packetAgeSeconds, isLiveStale]);

  return (
    <div className="bg-[var(--bg-base)] text-[var(--text-primary)] h-screen flex flex-col overflow-hidden select-none">
      {/* Top Header Bar */}
      <HeaderBar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        latestPacket={activeLatestPacket}
        telemetrySource={telemetrySource}
        onSelectSource={handleSelectSource}
        serialState={serialState}
        serialMetrics={serialMetrics}
        liveBaudRate={liveBaudRate}
        isStale={isLiveStale}
        packetAgeSeconds={packetAgeSeconds}
        onOpenDeployModal={() => setIsDeployModalOpen(true)}
        onOpenSettingsModal={() => setIsSettingsModalOpen(true)}
        onToggleTerminal={() => setIsTerminalOpen(!isTerminalOpen)}
        isTerminalOpen={isTerminalOpen}
        onResetSimulation={handleResetSimulation}
      />

      {/* Main Dashboard Workspace Content Area */}
      <main className="flex-1 mt-15 p-2.5 bg-[var(--bg-base)] overflow-y-auto lg:overflow-hidden h-[calc(100vh-3.75rem)]">
        {/* WORKSPACE 1: MISSION OVERVIEW */}
        {activeTab === 'OVERVIEW' && (
          <div className="flex flex-col gap-2.5 h-full overflow-y-auto lg:overflow-hidden">
            {/* Top Mission Health & Landing Predictor Status Summary Strip */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 shrink-0">
              {/* 1. Flight Phase */}
              <div className="ops-card px-3 py-2 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)] flex items-center gap-1">
                    <Layers className="w-3 h-3 text-[var(--accent-cobalt)]" />
                    Flight Phase (FSW)
                  </div>
                  <div className="font-mono-data text-xs sm:text-sm font-bold text-[var(--text-primary)] truncate mt-0.5">
                    {activeLatestPacket?.fswStateName ?? 'STANDBY / NO DATA'}
                  </div>
                </div>
                <span className="font-mono-data text-[10px] px-1.5 py-0.5 rounded-[var(--radius-xs)] bg-[var(--bg-surface-2)] text-[var(--text-secondary)] border border-[var(--border-subtle)] shrink-0">
                  PKT #{activeLatestPacket?.packetNumber ?? '--'}
                </span>
              </div>

              {/* 2. Altitude & Vertical Rate */}
              <div className="ops-card px-3 py-2 flex items-center justify-between gap-2">
                <div>
                  <div className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)] flex items-center gap-1">
                    <Activity className="w-3 h-3 text-[var(--accent-teal)]" />
                    Baro Alt / Rate
                  </div>
                  <div className="font-mono-data text-xs sm:text-sm font-bold text-[var(--text-primary)] mt-0.5 tabular-nums">
                    {typeof activeLatestPacket?.altitude === 'number'
                      ? `${activeLatestPacket.altitude.toFixed(1)} m`
                      : 'UNAVAILABLE'}
                  </div>
                </div>
                <div className="text-right font-mono-data text-[11px] text-[var(--accent-teal)] font-semibold tabular-nums">
                  {typeof activeLatestPacket?.velocity === 'number'
                    ? `${activeLatestPacket.velocity.toFixed(1)} m/s`
                    : '--'}
                </div>
              </div>

              {/* 3. GNSS Lock & Time */}
              <div className="ops-card px-3 py-2 flex items-center justify-between gap-2">
                <div>
                  <div className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)] flex items-center gap-1">
                    <Satellite className="w-3 h-3 text-[var(--accent-cobalt)]" />
                    GNSS Fix &amp; Sats
                  </div>
                  <div className="font-mono-data text-xs sm:text-sm font-bold text-[var(--text-primary)] mt-0.5">
                    {activeLatestPacket?.gpsValid
                      ? `${activeLatestPacket.gpsFixType} (${
                          activeLatestPacket.gpsSats ?? 0
                        } SATS)`
                      : 'NO VALID FIX'}
                  </div>
                </div>
                <div className="text-right font-mono-data text-[10px] text-[var(--text-secondary)] tabular-nums">
                  <div>UTC {activeLatestPacket?.timestampUtc ?? '--:--:--'}</div>
                  <div className="text-[var(--accent-cobalt)] font-semibold">
                    IST {activeLatestPacket?.gnssTimeIst ?? '--:--:--'}
                  </div>
                </div>
              </div>

              {/* 4. Electrical Power & Link Health */}
              <div className="ops-card px-3 py-2 flex items-center justify-between gap-2">
                <div>
                  <div className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)] flex items-center gap-1">
                    <Battery className="w-3 h-3 text-[var(--status-nominal)]" />
                    2S Battery Pack
                  </div>
                  <div className="font-mono-data text-xs sm:text-sm font-bold text-[var(--status-nominal)] mt-0.5 tabular-nums">
                    {typeof activeLatestPacket?.batteryVoltage === 'number'
                      ? `${activeLatestPacket.batteryVoltage.toFixed(2)} V`
                      : 'UNAVAILABLE'}
                  </div>
                </div>
                <span
                  className={`font-mono-data text-[10px] px-1.5 py-0.5 rounded-[var(--radius-xs)] border font-semibold ${
                    telemetrySource === 'SIMULATION'
                      ? 'bg-[var(--status-info-bg)] text-[var(--accent-cobalt)] border-[var(--accent-cobalt)]/25'
                      : isLiveStale
                      ? 'bg-[var(--status-warning-bg)] text-[var(--status-warning)] border-[var(--status-warning)]/40'
                      : 'bg-[var(--status-nominal-bg)] text-[var(--status-nominal)] border-[var(--status-nominal)]/30'
                  }`}
                >
                  {telemetrySource === 'SIMULATION'
                    ? 'SIM 10Hz'
                    : isLiveStale
                    ? 'STALE'
                    : 'LIVE RX'}
                </span>
              </div>

              {/* 5. Landing Predictor Summary Card with Quick Action */}
              <div className="col-span-2 md:col-span-1 ops-card px-3 py-2 flex items-center justify-between gap-2 bg-[var(--bg-surface-2)]/60">
                <div className="min-w-0">
                  <div className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)] flex items-center gap-1">
                    <Crosshair className="w-3 h-3 text-[var(--accent-teal)]" />
                    Landing Predictor
                  </div>
                  {overviewPrediction.valid && overviewPrediction.prediction ? (
                    <div className="font-mono-data text-[11px] font-bold text-[var(--accent-teal)] truncate mt-0.5 tabular-nums">
                      {overviewPrediction.prediction.predicted_lat_deg.toFixed(4)}°N,{' '}
                      {overviewPrediction.prediction.predicted_lon_deg.toFixed(4)}°E (T-
                      {overviewPrediction.prediction.estimated_time_to_landing_s.toFixed(
                        0
                      )}
                      s)
                    </div>
                  ) : (
                    <div className="font-mono-data text-[11px] font-semibold text-[var(--status-warning)] truncate mt-0.5 flex items-center gap-1">
                      <ShieldAlert className="w-3 h-3 shrink-0" />
                      <span>GATED: {overviewPrediction.reason_code}</span>
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab('LANDING_PREDICTOR')}
                  title="Open Dedicated Landing Predictor Workspace"
                  className="px-2 py-1 bg-[var(--accent-teal)] hover:opacity-95 text-white rounded-[var(--radius-xs)] text-[10px] font-semibold cursor-pointer flex items-center gap-1 shrink-0 transition-opacity"
                >
                  {overviewPrediction.valid ? (
                    <CheckCircle2 className="w-3 h-3" />
                  ) : (
                    <ExternalLink className="w-3 h-3" />
                  )}
                  <span>Open</span>
                </button>
              </div>
            </div>

            {/* Main Overview Body: Left/Center Charts + Spatial & Right Control Rail */}
            <div className="flex-1 flex flex-col lg:flex-row gap-2.5 overflow-hidden min-h-[520px] lg:min-h-0">
              {/* Left & Center Main Column */}
              <div className="flex-1 flex flex-col gap-2.5 overflow-hidden min-h-[500px] lg:min-h-0 lg:h-full">
                <div className="h-[58%] min-h-[290px]">
                  <TelemetryChartPanel
                    history={activeHistoryPackets}
                    latestPacket={activeLatestPacket}
                    telemetrySource={telemetrySource}
                    isStale={isLiveStale}
                  />
                </div>

                <div className="h-[42%] grid grid-cols-1 sm:grid-cols-2 gap-2.5 min-h-[210px]">
                  <ThreeAttitudeViewport
                    latestPacket={activeLatestPacket}
                    telemetrySource={telemetrySource}
                    isStale={isLiveStale}
                  />
                  <GpsTrackingMap
                    latestPacket={activeLatestPacket}
                    historyPackets={activeHistoryPackets}
                    telemetrySource={telemetrySource}
                    isStale={isLiveStale}
                    onOpenLandingPredictor={() =>
                      setActiveTab('LANDING_PREDICTOR')
                    }
                  />
                </div>
              </div>

              {/* Right Sidebar Column */}
              <div className="w-full lg:w-80 xl:w-84 flex flex-col gap-2.5 overflow-y-auto h-full pr-0.5">
                <SerialLinkPanel
                  telemetrySource={telemetrySource}
                  onSelectSource={handleSelectSource}
                  config={serialConfig}
                  onUpdateConfig={(cfg) =>
                    setSerialConfig((prev) => ({ ...prev, ...cfg }))
                  }
                  onToggleConnect={handleToggleSimConnect}
                  serialState={serialState}
                  serialMetrics={serialMetrics}
                  liveBaudRate={liveBaudRate}
                  onChangeLiveBaudRate={setLiveBaudRate}
                  onConnectLiveSerial={handleConnectLiveSerial}
                  onDisconnectLiveSerial={handleDisconnectLiveSerial}
                  isStale={isLiveStale}
                  packetAgeSeconds={packetAgeSeconds}
                />

                <MissionControlPanel
                  telemetrySource={telemetrySource}
                  isRunning={isRunning}
                  onTogglePlay={handleTogglePlay}
                  onCalibrateSensors={handleCalibrateSensors}
                  onInjectDisturbance={handleInjectTurbulence}
                  onResetSimulation={handleResetSimulation}
                />

                <FlightStatePanel
                  latestPacket={activeLatestPacket}
                  telemetrySource={telemetrySource}
                  isStale={isLiveStale}
                  onOverrideState={handleOverrideState}
                />

                <RawReadoutsPanel
                  latestPacket={activeLatestPacket}
                  historyPackets={activeHistoryPackets}
                  telemetrySource={telemetrySource}
                  isStale={isLiveStale}
                />
              </div>
            </div>
          </div>
        )}

        {/* WORKSPACE 2: DEDICATED LANDING PREDICTOR (STAGE 3) */}
        {activeTab === 'LANDING_PREDICTOR' && (
          <LandingPredictorWorkspace
            latestPacket={activeLatestPacket}
            historyPackets={activeHistoryPackets}
            telemetrySource={telemetrySource}
            isStale={isLiveStale}
            packetAgeSeconds={packetAgeSeconds}
          />
        )}

        {/* WORKSPACE 3: TELEMETRY EXPLORER */}
        {activeTab === 'TELEMETRY' && (
          <div className="h-full w-full p-0.5 bg-[var(--bg-base)] flex flex-col gap-2.5">
            <div className="flex-1">
              <TelemetryChartPanel
                history={activeHistoryPackets}
                latestPacket={activeLatestPacket}
                telemetrySource={telemetrySource}
                isStale={isLiveStale}
                expandedMode={true}
              />
            </div>
          </div>
        )}

        {/* WORKSPACE 4: ATTITUDE & SENSORS */}
        {activeTab === 'ATTITUDE_SENSORS' && (
          <div className="h-full w-full p-0.5 bg-[var(--bg-base)] grid grid-cols-1 lg:grid-cols-3 gap-2.5 overflow-y-auto lg:overflow-hidden">
            <div className="lg:col-span-2 h-full min-h-[380px]">
              <ThreeAttitudeViewport
                latestPacket={activeLatestPacket}
                telemetrySource={telemetrySource}
                isStale={isLiveStale}
              />
            </div>
            <div className="flex flex-col gap-2.5 overflow-y-auto h-full pr-0.5">
              <FlightStatePanel
                latestPacket={activeLatestPacket}
                telemetrySource={telemetrySource}
                isStale={isLiveStale}
                onOverrideState={handleOverrideState}
              />
              <RawReadoutsPanel
                latestPacket={activeLatestPacket}
                historyPackets={activeHistoryPackets}
                telemetrySource={telemetrySource}
                isStale={isLiveStale}
              />
            </div>
          </div>
        )}

        {/* WORKSPACE 5: COMMUNICATIONS & LOGS */}
        {activeTab === 'COMMS_LOGS' && (
          <div className="h-full w-full p-0.5 bg-[var(--bg-base)] grid grid-cols-1 lg:grid-cols-12 gap-2.5 overflow-y-auto">
            {/* Left Column: Serial Link, Controls & Pre-Flight Checklist (5 cols) */}
            <div className="lg:col-span-5 flex flex-col gap-2.5">
              <SerialLinkPanel
                telemetrySource={telemetrySource}
                onSelectSource={handleSelectSource}
                config={serialConfig}
                onUpdateConfig={(cfg) =>
                  setSerialConfig((prev) => ({ ...prev, ...cfg }))
                }
                onToggleConnect={handleToggleSimConnect}
                serialState={serialState}
                serialMetrics={serialMetrics}
                liveBaudRate={liveBaudRate}
                onChangeLiveBaudRate={setLiveBaudRate}
                onConnectLiveSerial={handleConnectLiveSerial}
                onDisconnectLiveSerial={handleDisconnectLiveSerial}
                isStale={isLiveStale}
                packetAgeSeconds={packetAgeSeconds}
              />

              <PreflightChecklistPanel
                latestPacket={activeLatestPacket}
                telemetrySource={telemetrySource}
                onStartLaunch={() => {
                  if (telemetrySource !== 'SIMULATION') return;
                  globalTelemetryEngine.resetMission();
                  handleOverrideState(FlightStateCode.ASCENT);
                  setActiveTab('OVERVIEW');
                }}
              />
            </div>

            {/* Right Column: Live Frame Stream Inspector & Post-Flight Judge Report (7 cols) */}
            <div className="lg:col-span-7 flex flex-col gap-2.5">
              {/* Inline Recent Raw Frame Stream Inspector */}
              <div className="ops-card p-3.5 flex flex-col gap-2">
                <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-2">
                  <div className="flex items-center gap-2">
                    <Terminal className="w-4 h-4 text-[var(--accent-cobalt)]" />
                    <div>
                      <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-primary)]">
                        Recent Telemetry Frame Stream (
                        {telemetrySource === 'SIMULATION'
                          ? 'SIMULATION'
                          : 'LIVE USB SERIAL'}
                        )
                      </h3>
                      <p className="text-[11px] text-[var(--text-secondary)]">
                        Showing latest {Math.min(rawLogs.length, 12)} of{' '}
                        {rawLogs.length} buffered frames • Receive-only hardware
                        protection active
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsTerminalOpen(true)}
                    className="px-2.5 py-1 bg-[var(--bg-surface-2)] hover:bg-[var(--bg-surface-3)] text-[var(--text-primary)] border border-[var(--border-subtle)] rounded-[var(--radius-sm)] text-xs font-semibold cursor-pointer flex items-center gap-1.5"
                  >
                    <Radio className="w-3.5 h-3.5 text-[var(--accent-cobalt)]" />
                    <span>Open Full Log Console &amp; CSV Export</span>
                  </button>
                </div>

                <div className="bg-[var(--bg-surface-2)] border border-[var(--border-subtle)] rounded-[var(--radius-sm)] p-2.5 h-40 overflow-y-auto font-mono-data text-[11px] space-y-1 select-text">
                  {rawLogs.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-[var(--text-tertiary)]">
                      No telemetry frames logged yet.
                    </div>
                  ) : (
                    rawLogs.slice(-12).map((entry, idx) => (
                      <div
                        key={idx}
                        className="flex items-baseline gap-2 border-b border-[var(--border-subtle)]/60 pb-0.5 last:border-b-0"
                      >
                        <span className="text-[10px] text-[var(--text-tertiary)] shrink-0 tabular-nums">
                          [{entry.time}]
                        </span>
                        <span
                          className={`text-[9px] font-bold uppercase px-1.5 py-0.2 rounded-[var(--radius-xs)] shrink-0 ${
                            entry.type === 'err'
                              ? 'bg-[var(--status-alert-bg)] text-[var(--status-alert)]'
                              : entry.type === 'sys'
                              ? 'bg-[var(--status-info-bg)] text-[var(--accent-cobalt)]'
                              : 'bg-[var(--status-nominal-bg)] text-[var(--status-nominal)]'
                          }`}
                        >
                          {entry.source === 'SIMULATION'
                            ? `SIM-${entry.type.toUpperCase()}`
                            : entry.type.toUpperCase()}
                        </span>
                        <span className="text-[var(--text-primary)] truncate">
                          {entry.text}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="flex-1">
                <JudgeReportPanel
                  historyPackets={activeHistoryPackets}
                  latestPacket={activeLatestPacket}
                  telemetrySource={telemetrySource}
                />
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Terminal Slide-out Drawer */}
      <TerminalDrawer
        isOpen={isTerminalOpen}
        onClose={() => setIsTerminalOpen(false)}
        telemetrySource={telemetrySource}
        rawLogEntries={rawLogs}
        historyPackets={activeHistoryPackets}
        onSendCommand={handleSendCommand}
        onClearLogs={() => setRawLogs([])}
      />

      {/* Deploy Critical Safety Modal */}
      <DeployConfirmationModal
        isOpen={isDeployModalOpen}
        telemetrySource={telemetrySource}
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
