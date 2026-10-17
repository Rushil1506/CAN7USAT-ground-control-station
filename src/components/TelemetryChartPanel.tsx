import React, { useEffect, useRef, useState } from 'react';
import {
  Activity,
  Compass,
  Cpu,
  Gauge,
  Pause,
  PlaneTakeoff,
  Play,
  RotateCw,
  Sparkles,
  Wind,
  Zap,
} from 'lucide-react';
import { TelemetryPacket, TelemetrySource } from '../types';

interface TelemetryChartPanelProps {
  history: TelemetryPacket[];
  latestPacket: TelemetryPacket | null;
  telemetrySource?: TelemetrySource;
  isStale?: boolean;
  expandedMode?: boolean;
}

interface SingleGraphProps {
  title: string;
  unit: string;
  currentValue: number | null | undefined;
  dataKey: keyof TelemetryPacket;
  color: string;
  icon: React.ReactNode;
  history: TelemetryPacket[];
  timeframeSeconds: number;
  thresholdValue?: number;
  thresholdLabel?: string;
}

function hexToRgba(hex: string, alpha: number): string {
  const cleanHex = hex.replace('#', '');
  const r = parseInt(cleanHex.substring(0, 2), 16) || 0;
  const g = parseInt(cleanHex.substring(2, 4), 16) || 0;
  const b = parseInt(cleanHex.substring(4, 6), 16) || 0;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const isValidNum = (val: unknown): val is number =>
  typeof val === 'number' && Number.isFinite(val);

const SingleGraph: React.FC<SingleGraphProps> = ({
  title,
  unit,
  currentValue,
  dataKey,
  color,
  icon,
  history,
  timeframeSeconds,
  thresholdValue,
  thresholdLabel,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hoverData, setHoverData] = useState<{
    time: string;
    val: number;
    x: number;
    y: number;
  } | null>(null);
  const [isPaused, setIsPaused] = useState(false);

  // Calculate statistics only from valid finite measurements in the active timeframe buffer
  const recentSlice = history.slice(-Math.max(10, timeframeSeconds * 10));
  const validEntries = recentSlice
    .map((p) => ({ time: p.timestampUtc, val: p[dataKey] }))
    .filter((entry): entry is { time: string; val: number } =>
      isValidNum(entry.val)
    );

  const values = validEntries.map((e) => e.val);
  const hasCurrent = isValidNum(currentValue);
  const maxVal =
    values.length > 0 ? Math.max(...values) : hasCurrent ? currentValue : null;
  const minVal =
    values.length > 0 ? Math.min(...values) : hasCurrent ? currentValue : null;
  const avgVal =
    values.length > 0
      ? values.reduce((acc, v) => acc + v, 0) / values.length
      : hasCurrent
      ? currentValue
      : null;

  useEffect(() => {
    if (isPaused) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = (canvas.width = rect.width * dpr);
    const height = (canvas.height = rect.height * dpr);

    ctx.clearRect(0, 0, width, height);

    // 1. Subtle Light-First Engineering Grid (4 horizontal + 4 vertical divisions)
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.065)';
    ctx.lineWidth = 1 * dpr;
    const gridRows = 4;
    for (let i = 1; i < gridRows; i++) {
      const y = (height / gridRows) * i;
      ctx.beginPath();
      ctx.setLineDash([3 * dpr, 3 * dpr]);
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    const gridCols = 4;
    for (let i = 1; i < gridCols; i++) {
      const x = (width / gridCols) * i;
      ctx.beginPath();
      ctx.setLineDash([3 * dpr, 3 * dpr]);
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    if (values.length === 0) return;

    // 2. Compute Dynamic Y Range with Threshold and 15% Padding
    let yMin = Math.min(...values);
    let yMax = Math.max(...values);
    if (thresholdValue !== undefined) {
      yMin = Math.min(yMin, thresholdValue);
      yMax = Math.max(yMax, thresholdValue);
    }
    if (yMin === yMax) {
      yMin = yMin - 1;
      yMax = yMax + 1;
    }
    const padding = (yMax - yMin) * 0.15;
    yMin -= padding;
    yMax += padding;

    const getX = (idx: number) =>
      values.length === 1 ? width / 2 : (idx / (values.length - 1)) * width;
    const getY = (val: number) =>
      height - ((val - yMin) / (yMax - yMin)) * height;

    // 3. Draw Reference Threshold Line if Specified
    if (thresholdValue !== undefined) {
      const thresholdY = getY(thresholdValue);
      ctx.beginPath();
      ctx.setLineDash([5 * dpr, 4 * dpr]);
      ctx.moveTo(0, thresholdY);
      ctx.lineTo(width, thresholdY);
      ctx.strokeStyle = 'rgba(180, 83, 9, 0.65)';
      ctx.lineWidth = 1.25 * dpr;
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (values.length >= 2) {
      // 4. Draw Soft Area Fill (10% opacity fading to 0%)
      const gradient = ctx.createLinearGradient(0, 0, 0, height);
      gradient.addColorStop(0, hexToRgba(color, 0.12));
      gradient.addColorStop(1, hexToRgba(color, 0.0));

      ctx.beginPath();
      ctx.moveTo(getX(0), getY(values[0]));
      for (let i = 1; i < values.length; i++) {
        ctx.lineTo(getX(i), getY(values[i]));
      }
      ctx.lineTo(width, height);
      ctx.lineTo(0, height);
      ctx.closePath();
      ctx.fillStyle = gradient;
      ctx.fill();

      // 5. Draw Primary Telemetry Trace Line
      ctx.beginPath();
      ctx.moveTo(getX(0), getY(values[0]));
      for (let i = 1; i < values.length; i++) {
        ctx.lineTo(getX(i), getY(values[i]));
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 2 * dpr;
      ctx.lineJoin = 'round';
      ctx.stroke();
    }

    // 6. Highlight Latest Real-time Point Marker
    const lastX = getX(values.length - 1);
    const lastY = getY(values[values.length - 1]);

    ctx.beginPath();
    ctx.arc(lastX, lastY, 3.2 * dpr, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(lastX, lastY, 6 * dpr, 0, Math.PI * 2);
    ctx.strokeStyle = hexToRgba(color, 0.45);
    ctx.lineWidth = 1.5 * dpr;
    ctx.stroke();
  }, [
    history,
    isPaused,
    timeframeSeconds,
    color,
    dataKey,
    thresholdValue,
    values.length,
  ]);

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || validEntries.length === 0) return;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const index = Math.min(
      validEntries.length - 1,
      Math.max(0, Math.round((mouseX / rect.width) * (validEntries.length - 1)))
    );
    const item = validEntries[index];
    if (item) {
      setHoverData({
        time: item.time,
        val: item.val,
        x: mouseX,
        y: e.clientY - rect.top,
      });
    }
  };

  return (
    <div className="ops-card p-3 flex flex-col justify-between select-none group h-full transition-shadow hover:shadow-[var(--shadow-md)]">
      {/* Header Info */}
      <div className="flex justify-between items-center mb-1">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className="w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: color }}
          />
          <span className="text-xs font-semibold text-[var(--text-primary)] tracking-tight truncate">
            {title}
          </span>
          <span className="text-[11px] text-[var(--text-tertiary)] font-mono-data shrink-0">
            ({unit})
          </span>
          {thresholdLabel && (
            <span className="hidden xl:inline-block font-mono-data text-[9px] text-[var(--status-warning)] border border-[var(--status-warning)]/30 px-1.5 py-0.5 bg-[var(--status-warning-bg)] rounded-[var(--radius-xs)] shrink-0">
              {thresholdLabel}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {isPaused && (
            <span className="font-mono-data text-[9px] font-semibold text-[var(--status-warning)] bg-[var(--status-warning-bg)] border border-[var(--status-warning)]/30 px-1.5 py-0.5 rounded-[var(--radius-xs)]">
              PAUSED
            </span>
          )}
          <button
            type="button"
            onClick={() => setIsPaused(!isPaused)}
            title={isPaused ? 'Resume live chart' : 'Pause chart updates'}
            aria-label={isPaused ? 'Resume live chart' : 'Pause chart updates'}
            className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-2)] p-1 rounded-[var(--radius-xs)] transition-colors cursor-pointer"
          >
            {isPaused ? (
              <Play className="w-3.5 h-3.5 text-[var(--status-nominal)]" />
            ) : (
              <Pause className="w-3.5 h-3.5" />
            )}
          </button>
          <div className="text-[var(--text-tertiary)] group-hover:text-[var(--text-secondary)] transition-colors">
            {icon}
          </div>
        </div>
      </div>

      {/* Numerical Telemetry Readout with Tabular Numerals */}
      <div className="flex items-baseline justify-between my-1">
        {hasCurrent ? (
          <div
            className="font-mono-data text-2xl sm:text-3xl font-bold tracking-tight tabular-nums"
            style={{ color }}
          >
            {currentValue.toFixed(1)}
            <span className="text-xs font-normal text-[var(--text-tertiary)] ml-1">
              {unit}
            </span>
          </div>
        ) : (
          <div className="font-mono-data text-base sm:text-lg font-semibold tracking-tight text-[var(--text-tertiary)] uppercase">
            UNAVAILABLE
          </div>
        )}
        <div className="flex items-center gap-3 text-right font-mono-data text-[10px] text-[var(--text-tertiary)] tabular-nums">
          <div>
            <span className="block text-[9px] uppercase">MIN</span>
            <span className="text-[var(--text-secondary)] font-semibold">
              {minVal !== null ? minVal.toFixed(1) : '--'}
            </span>
          </div>
          <div>
            <span className="block text-[9px] uppercase">AVG</span>
            <span className="text-[var(--text-secondary)] font-semibold">
              {avgVal !== null ? avgVal.toFixed(1) : '--'}
            </span>
          </div>
          <div>
            <span className="block text-[9px] uppercase">MAX</span>
            <span className="text-[var(--text-secondary)] font-semibold">
              {maxVal !== null ? maxVal.toFixed(1) : '--'}
            </span>
          </div>
        </div>
      </div>

      {/* Real-time Canvas Graph View */}
      <div className="relative w-full flex-1 min-h-[96px] sm:min-h-[112px] mt-1 overflow-hidden bg-[var(--bg-surface-2)]/70 border border-[var(--border-subtle)] rounded-[var(--radius-sm)]">
        <canvas
          ref={canvasRef}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoverData(null)}
          className="w-full h-full cursor-crosshair block"
        />

        {values.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none px-2 text-center">
            <span className="font-mono-data text-[11px] text-[var(--text-tertiary)]">
              {history.length === 0
                ? 'Awaiting incoming telemetry packets...'
                : 'Channel not transmitted in active telemetry stream'}
            </span>
          </div>
        )}

        {/* Hover Crosshair Overlay */}
        {hoverData && (
          <div
            className="absolute z-10 pointer-events-none bg-[var(--bg-surface-1)] border border-[var(--border-strong)] px-2.5 py-1 text-[11px] font-mono-data text-[var(--text-primary)] shadow-[var(--shadow-md)] rounded-[var(--radius-xs)] tabular-nums"
            style={{
              left: Math.min(hoverData.x + 10, 180),
              top: Math.max(hoverData.y - 34, 6),
            }}
          >
            <div className="text-[var(--text-tertiary)] text-[9px]">
              UTC {hoverData.time}
            </div>
            <div className="font-bold" style={{ color }}>
              {hoverData.val.toFixed(2)} {unit}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export const TelemetryChartPanel: React.FC<TelemetryChartPanelProps> = ({
  history,
  latestPacket,
  telemetrySource = 'SIMULATION',
  isStale = false,
  expandedMode = false,
}) => {
  const [timeframe, setTimeframe] = useState<number>(30);
  const [activePreset, setActivePrimaryPreset] = useState<
    'PRIMARY' | 'BARO_IMU' | 'STABILIZATION' | 'ENVIRONMENTAL'
  >('PRIMARY');

  const isSim = telemetrySource === 'SIMULATION';

  return (
    <div className="flex flex-col h-full gap-2">
      {/* Timeframe & Chart Category Toolbar */}
      <div className="flex justify-between items-center px-3 py-2 bg-[var(--bg-surface-1)] border border-[var(--border-subtle)] shadow-[var(--shadow-xs)] rounded-[var(--radius-md)] flex-wrap gap-2">
        {/* Preset Selector */}
        <div className="flex items-center gap-1.5 text-xs flex-wrap">
          {(
            [
              { id: 'PRIMARY', label: 'Primary Flight Metrics' },
              { id: 'BARO_IMU', label: 'Barometric & IMU' },
              { id: 'STABILIZATION', label: 'DCS & Electrical Power' },
              { id: 'ENVIRONMENTAL', label: 'Environmental Payload' },
            ] as const
          ).map((tab) => {
            const isActive = activePreset === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActivePrimaryPreset(tab.id)}
                className={`px-2.5 py-1 border cursor-pointer font-semibold rounded-[var(--radius-sm)] transition-colors text-xs ${
                  isActive
                    ? 'bg-[var(--accent-cobalt-soft)] text-[var(--accent-cobalt)] border-[var(--accent-cobalt)]/30'
                    : 'bg-[var(--bg-surface-2)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:text-[var(--text-primary)]'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Source & Timeframe Duration Selector */}
        <div className="flex items-center gap-2 font-mono-data text-[11px]">
          <span
            className={`hidden md:inline-block px-2 py-0.5 border rounded-[var(--radius-xs)] text-[10px] font-semibold uppercase ${
              isSim
                ? 'bg-[var(--status-info-bg)] text-[var(--accent-cobalt)] border-[var(--accent-cobalt)]/25'
                : isStale
                ? 'bg-[var(--status-warning-bg)] text-[var(--status-warning)] border-[var(--status-warning)]/40'
                : 'bg-[var(--accent-teal-soft)] text-[var(--accent-teal)] border-[var(--accent-teal)]/30'
            }`}
          >
            {isSim
              ? 'SIMULATION (10 Hz)'
              : isStale
              ? 'LIVE SERIAL (STALE)'
              : 'LIVE USB SERIAL'}
          </span>
          <span className="text-[var(--text-tertiary)] text-[10px] uppercase">
            Window:
          </span>
          <div className="flex items-center bg-[var(--bg-surface-2)] border border-[var(--border-subtle)] rounded-[var(--radius-sm)] p-0.5">
            {[10, 30, 60, 120].map((sec) => (
              <button
                key={sec}
                type="button"
                onClick={() => setTimeframe(sec)}
                className={`px-2 py-0.5 cursor-pointer rounded-[var(--radius-xs)] tabular-nums transition-colors text-[11px] ${
                  timeframe === sec
                    ? 'bg-[var(--bg-surface-1)] text-[var(--accent-cobalt)] font-bold shadow-[var(--shadow-xs)]'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                {sec}s
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Optional Expanded Telemetry Summary Strip when in full TELEMETRY workspace */}
      {expandedMode && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
          <div className="ops-card px-3 py-2">
            <div className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)]">
              Buffered Frames
            </div>
            <div className="font-mono-data text-sm font-bold text-[var(--text-primary)] mt-0.5">
              {history.length} pkts
            </div>
          </div>
          <div className="ops-card px-3 py-2">
            <div className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)]">
              Latest Packet #
            </div>
            <div className="font-mono-data text-sm font-bold text-[var(--accent-cobalt)] mt-0.5">
              {latestPacket ? `#${latestPacket.packetNumber}` : 'NONE'}
            </div>
          </div>
          <div className="ops-card px-3 py-2">
            <div className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)]">
              GNSS Time (UTC / IST)
            </div>
            <div className="font-mono-data text-xs font-bold text-[var(--text-primary)] mt-0.5">
              {latestPacket?.timestampUtc ?? '--:--:--'} /{' '}
              <span className="text-[var(--accent-cobalt)]">
                {latestPacket?.gnssTimeIst ?? '--:--:--'}
              </span>
            </div>
          </div>
          <div className="ops-card px-3 py-2">
            <div className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)]">
              Baro Pressure
            </div>
            <div className="font-mono-data text-sm font-bold text-[var(--text-primary)] mt-0.5">
              {isValidNum(latestPacket?.pressure)
                ? `${latestPacket.pressure.toFixed(2)} hPa`
                : 'UNAVAILABLE'}
            </div>
          </div>
          <div className="ops-card px-3 py-2">
            <div className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)]">
              GNSS Altitude (AMSL)
            </div>
            <div className="font-mono-data text-sm font-bold text-[var(--text-primary)] mt-0.5">
              {isValidNum(latestPacket?.gpsAltitude)
                ? `${latestPacket.gpsAltitude.toFixed(1)} m`
                : 'UNAVAILABLE'}
            </div>
          </div>
          <div className="ops-card px-3 py-2">
            <div className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)]">
              Flight Software State
            </div>
            <div className="font-mono-data text-sm font-bold text-[var(--accent-teal)] mt-0.5 truncate">
              {latestPacket?.fswStateName ?? 'STANDBY'}
            </div>
          </div>
        </div>
      )}

      {/* 2x2 Telemetry Graph Grid based on Active Category */}
      {activePreset === 'PRIMARY' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 grid-rows-2 gap-2.5 flex-1 h-full min-h-[360px]">
          <SingleGraph
            title="Barometric Altitude"
            unit="m"
            currentValue={latestPacket?.altitude}
            dataKey="altitude"
            color="#1d4ed8"
            icon={<PlaneTakeoff className="w-4 h-4 text-[#1d4ed8]" />}
            history={history}
            timeframeSeconds={timeframe}
            thresholdValue={600}
            thresholdLabel="REF: 600m"
          />

          <SingleGraph
            title="Vertical Velocity / Descent Rate"
            unit="m/s"
            currentValue={latestPacket?.velocity}
            dataKey="velocity"
            color="#0f766e"
            icon={<Gauge className="w-4 h-4 text-[#0f766e]" />}
            history={history}
            timeframeSeconds={timeframe}
            thresholdValue={17}
            thresholdLabel="STAGE 1: 17 m/s"
          />

          {isSim || isValidNum(latestPacket?.acceleration) ? (
            <SingleGraph
              title="IMU Total Acceleration"
              unit="G"
              currentValue={latestPacket?.acceleration}
              dataKey="acceleration"
              color="#4338ca"
              icon={<Activity className="w-4 h-4 text-[#4338ca]" />}
              history={history}
              timeframeSeconds={timeframe}
              thresholdValue={15}
              thresholdLabel="BOOST 15G"
            />
          ) : (
            <SingleGraph
              title="IMU Z-Axis Acceleration"
              unit="m/s²"
              currentValue={latestPacket?.accelZ}
              dataKey="accelZ"
              color="#4338ca"
              icon={<Activity className="w-4 h-4 text-[#4338ca]" />}
              history={history}
              timeframeSeconds={timeframe}
            />
          )}

          <SingleGraph
            title="Gyro Spin / Precession Rate"
            unit="deg/s"
            currentValue={latestPacket?.spinRate}
            dataKey="spinRate"
            color="#b45309"
            icon={<RotateCw className="w-4 h-4 text-[#b45309]" />}
            history={history}
            timeframeSeconds={timeframe}
            thresholdValue={3.18}
            thresholdLabel="REF: 3.18°/s"
          />
        </div>
      )}

      {activePreset === 'BARO_IMU' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 grid-rows-2 gap-2.5 flex-1 h-full min-h-[360px]">
          <SingleGraph
            title="Barometric Pressure"
            unit="hPa"
            currentValue={latestPacket?.pressure}
            dataKey="pressure"
            color="#1d4ed8"
            icon={<Gauge className="w-4 h-4 text-[#1d4ed8]" />}
            history={history}
            timeframeSeconds={timeframe}
          />

          <SingleGraph
            title="Ambient Temperature"
            unit="°C"
            currentValue={latestPacket?.temperature}
            dataKey="temperature"
            color="#0f766e"
            icon={<Wind className="w-4 h-4 text-[#0f766e]" />}
            history={history}
            timeframeSeconds={timeframe}
          />

          <SingleGraph
            title="IMU Roll Angle"
            unit="deg"
            currentValue={latestPacket?.roll}
            dataKey="roll"
            color="#4338ca"
            icon={<Compass className="w-4 h-4 text-[#4338ca]" />}
            history={history}
            timeframeSeconds={timeframe}
          />

          <SingleGraph
            title="IMU Pitch Angle"
            unit="deg"
            currentValue={latestPacket?.pitch}
            dataKey="pitch"
            color="#b91c1c"
            icon={<Compass className="w-4 h-4 text-[#b91c1c]" />}
            history={history}
            timeframeSeconds={timeframe}
          />
        </div>
      )}

      {activePreset === 'STABILIZATION' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 grid-rows-2 gap-2.5 flex-1 h-full min-h-[360px]">
          <SingleGraph
            title="Momentum Wheel Speed"
            unit="RPM"
            currentValue={latestPacket?.wheelRpm}
            dataKey="wheelRpm"
            color="#0f766e"
            icon={<RotateCw className="w-4 h-4 text-[#0f766e]" />}
            history={history}
            timeframeSeconds={timeframe}
            thresholdValue={12000}
            thresholdLabel="CRUISE: 12,000 RPM"
          />

          <SingleGraph
            title="System Current Draw"
            unit="A"
            currentValue={latestPacket?.currentDraw}
            dataKey="currentDraw"
            color="#b45309"
            icon={<Zap className="w-4 h-4 text-[#b45309]" />}
            history={history}
            timeframeSeconds={timeframe}
          />

          <SingleGraph
            title="2S Battery Pack Voltage"
            unit="V"
            currentValue={latestPacket?.batteryVoltage}
            dataKey="batteryVoltage"
            color="#15803d"
            icon={<Zap className="w-4 h-4 text-[#15803d]" />}
            history={history}
            timeframeSeconds={timeframe}
            thresholdValue={6.4}
            thresholdLabel="CUTOFF 6.4V"
          />

          <SingleGraph
            title="Total Electrical Power"
            unit="W"
            currentValue={latestPacket?.power}
            dataKey="power"
            color="#1d4ed8"
            icon={<Cpu className="w-4 h-4 text-[#1d4ed8]" />}
            history={history}
            timeframeSeconds={timeframe}
          />
        </div>
      )}

      {activePreset === 'ENVIRONMENTAL' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 grid-rows-2 gap-2.5 flex-1 h-full min-h-[360px]">
          <SingleGraph
            title="SCD40 CO₂ Concentration"
            unit="ppm"
            currentValue={latestPacket?.co2}
            dataKey="co2"
            color="#0f766e"
            icon={<Sparkles className="w-4 h-4 text-[#0f766e]" />}
            history={history}
            timeframeSeconds={timeframe}
          />

          <SingleGraph
            title="SPS30 Particulate PM2.5"
            unit="µg/m³"
            currentValue={latestPacket?.pm2_5}
            dataKey="pm2_5"
            color="#1d4ed8"
            icon={<Wind className="w-4 h-4 text-[#1d4ed8]" />}
            history={history}
            timeframeSeconds={timeframe}
          />

          <SingleGraph
            title="LTR390 UV Index"
            unit="Index"
            currentValue={latestPacket?.uv}
            dataKey="uv"
            color="#b45309"
            icon={<Sparkles className="w-4 h-4 text-[#b45309]" />}
            history={history}
            timeframeSeconds={timeframe}
          />

          <SingleGraph
            title="GY-SHT40 Relative Humidity"
            unit="%RH"
            currentValue={latestPacket?.humidity}
            dataKey="humidity"
            color="#4338ca"
            icon={<Wind className="w-4 h-4 text-[#4338ca]" />}
            history={history}
            timeframeSeconds={timeframe}
          />
        </div>
      )}
    </div>
  );
};
