import React, { useEffect, useRef, useState } from 'react';
import { PlaneTakeoff, Gauge, Activity, RotateCw, Pause, Play, Cpu, Zap, Wind, Sparkles } from 'lucide-react';
import { TelemetryPacket } from '../types';

interface TelemetryChartPanelProps {
  history: TelemetryPacket[];
  latestPacket: TelemetryPacket | null;
}

interface SingleGraphProps {
  title: string;
  unit: string;
  currentValue: number;
  dataKey: keyof TelemetryPacket;
  color: string;
  icon: React.ReactNode;
  history: TelemetryPacket[];
  timeframeSeconds: number;
  thresholdValue?: number;
  thresholdLabel?: string;
}

// Convert 6-character hex color to RGBA string
function hexToRgba(hex: string, alpha: number): string {
  const cleanHex = hex.replace('#', '');
  const r = parseInt(cleanHex.substring(0, 2), 16) || 0;
  const g = parseInt(cleanHex.substring(2, 4), 16) || 0;
  const b = parseInt(cleanHex.substring(4, 6), 16) || 0;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

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
  const [hoverData, setHoverData] = useState<{ time: string; val: number; x: number; y: number } | null>(null);
  const [isPaused, setIsPaused] = useState(false);

  // Calculate statistics from the active timeframe buffer
  const recentSlice = history.slice(-Math.max(10, timeframeSeconds * 10));
  const values = recentSlice.map((p) => Number(p[dataKey]) || 0);
  const maxVal = values.length > 0 ? Math.max(...values) : currentValue;
  const minVal = values.length > 0 ? Math.min(...values) : 0;

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

    if (recentSlice.length < 2) return;

    // 1. Subtle Background Grid (4 divisions)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
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
    ctx.setLineDash([]);

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

    const getX = (idx: number) => (idx / (recentSlice.length - 1)) * width;
    const getY = (val: number) => height - ((val - yMin) / (yMax - yMin)) * height;

    // 3. Draw Threshold Line if Specified
    if (thresholdValue !== undefined) {
      const thresholdY = getY(thresholdValue);
      ctx.beginPath();
      ctx.setLineDash([5 * dpr, 4 * dpr]);
      ctx.moveTo(0, thresholdY);
      ctx.lineTo(width, thresholdY);
      ctx.strokeStyle = 'rgba(234, 84, 85, 0.75)'; // Restrained fault/warning red
      ctx.lineWidth = 1.2 * dpr;
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 4. Draw Area Fill (Restrained 6% opacity fading to 0%)
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, hexToRgba(color, 0.06));
    gradient.addColorStop(1, hexToRgba(color, 0.00));

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

    // 6. Highlight Latest Real-time Point Marker
    const lastX = getX(values.length - 1);
    const lastY = getY(values[values.length - 1]);

    ctx.beginPath();
    ctx.arc(lastX, lastY, 3 * dpr, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(lastX, lastY, 5.5 * dpr, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1 * dpr;
    ctx.stroke();
  }, [history, isPaused, timeframeSeconds, color, dataKey, thresholdValue]);

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || recentSlice.length === 0) return;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const index = Math.min(
      recentSlice.length - 1,
      Math.max(0, Math.round((mouseX / rect.width) * (recentSlice.length - 1)))
    );
    const item = recentSlice[index];
    if (item) {
      setHoverData({
        time: item.timestampUtc,
        val: Number(item[dataKey]),
        x: mouseX,
        y: e.clientY - rect.top,
      });
    }
  };

  return (
    <div className="bg-[var(--bg-surface-1)] border border-[var(--border-subtle)] hover:border-[var(--border-focus)] transition-colors rounded-[var(--radius-md)] p-2.5 sm:p-3 flex flex-col justify-between select-none group h-full">
      {/* Header Info */}
      <div className="flex justify-between items-center mb-1">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
          <span className="font-mono-data text-xs font-semibold text-[var(--text-secondary)] tracking-tight">
            {title}
          </span>
          <span className="text-[10px] text-[var(--text-tertiary)] font-mono-data">
            ({unit})
          </span>
          {thresholdLabel && (
            <span className="font-mono-data text-[9px] text-[var(--status-alert)] border border-[var(--status-alert)]/30 px-1 py-0.2 bg-[var(--status-alert-bg)] rounded-[var(--radius-xs)]">
              {thresholdLabel}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {isPaused && (
            <span className="font-mono-data text-[9px] text-[var(--status-warning)] bg-[var(--status-warning-bg)] border border-[var(--status-warning)]/30 px-1 py-0.2 rounded-[var(--radius-xs)]">
              PAUSED
            </span>
          )}
          <button
            onClick={() => setIsPaused(!isPaused)}
            title={isPaused ? 'Resume live chart' : 'Pause chart updates'}
            aria-label={isPaused ? 'Resume live chart' : 'Pause chart updates'}
            className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-2)] p-1 rounded-[var(--radius-xs)] transition-colors cursor-pointer"
          >
            {isPaused ? <Play className="w-3 h-3 text-[var(--status-nominal)]" /> : <Pause className="w-3 h-3" />}
          </button>
          <div className="text-[var(--text-tertiary)] group-hover:text-[var(--text-secondary)] transition-colors">
            {icon}
          </div>
        </div>
      </div>

      {/* Numerical Telemetry Readout with Tabular Numerals */}
      <div className="flex items-baseline justify-between my-1">
        <div className="font-mono-data text-2xl sm:text-3xl font-bold tracking-tight tabular-nums" style={{ color }}>
          {currentValue.toFixed(1)}
        </div>
        <div className="text-right font-mono-data text-[10px] text-[var(--text-tertiary)] tabular-nums space-y-0.5">
          <div>MAX: <span className="text-[var(--text-secondary)] font-medium">{maxVal.toFixed(1)}</span></div>
          <div>MIN: <span className="text-[var(--text-secondary)] font-medium">{minVal.toFixed(1)}</span></div>
        </div>
      </div>

      {/* Real-time Canvas Graph View */}
      <div className="relative w-full h-24 sm:h-28 mt-1 overflow-hidden bg-[var(--bg-base)] border border-[var(--border-muted)] rounded-[var(--radius-xs)]">
        <canvas
          ref={canvasRef}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoverData(null)}
          className="w-full h-full cursor-crosshair block"
        />

        {/* Hover Crosshair Overlay */}
        {hoverData && (
          <div
            className="absolute z-10 pointer-events-none bg-[var(--bg-surface-elevated)] border border-[var(--border-focus)] px-2 py-1 text-[11px] font-mono-data text-[var(--text-primary)] shadow-md rounded-[var(--radius-xs)] tabular-nums"
            style={{
              left: Math.min(hoverData.x + 10, 160),
              top: Math.max(hoverData.y - 30, 5),
            }}
          >
            <div className="text-[var(--text-tertiary)] text-[9px]">{hoverData.time}</div>
            <div className="font-bold" style={{ color }}>
              {hoverData.val.toFixed(2)} {unit}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export const TelemetryChartPanel: React.FC<TelemetryChartPanelProps> = ({ history, latestPacket }) => {
  const [timeframe, setTimeframe] = useState<number>(30); // 30 seconds default
  const [activePreset, setActivePrimaryPreset] = useState<'PRIMARY' | 'STABILIZATION' | 'ENVIRONMENTAL'>('PRIMARY');

  const currentPacket = latestPacket || {
    altitude: 450.2,
    velocity: 12.4,
    acceleration: 9.81,
    spinRate: 3.18,
    wheelRpm: 12000,
    temperature: 24.2,
    pressure: 958.4,
    co2: 412.0,
    pm2_5: 11.5,
    uv: 4.2,
    humidity: 58.0,
    batteryVoltage: 7.85,
    currentDraw: 2.45,
    power: 19.2,
    batterySoc: 85.0,
  };

  return (
    <div className="flex flex-col h-full gap-1">
      {/* Timeframe & Chart Category Toolbar */}
      <div className="flex justify-between items-center px-2.5 py-1.5 bg-[var(--bg-surface-1)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] flex-wrap gap-2">
        {/* Preset Selector */}
        <div className="flex items-center gap-1 font-mono-data text-[10px]">
          <button
            onClick={() => setActivePrimaryPreset('PRIMARY')}
            className={`px-2 py-0.5 border cursor-pointer font-semibold rounded-[var(--radius-xs)] transition-colors ${
              activePreset === 'PRIMARY'
                ? 'bg-[var(--bg-surface-elevated)] text-[var(--action-amber)] border-[var(--border-amber)]'
                : 'bg-[var(--bg-surface-2)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:text-[var(--text-primary)]'
            }`}
          >
            PRIMARY METRICS
          </button>
          <button
            onClick={() => setActivePrimaryPreset('STABILIZATION')}
            className={`px-2 py-0.5 border cursor-pointer font-semibold rounded-[var(--radius-xs)] transition-colors ${
              activePreset === 'STABILIZATION'
                ? 'bg-[var(--bg-surface-elevated)] text-[var(--status-nominal)] border-[var(--border-nominal)]'
                : 'bg-[var(--bg-surface-2)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:text-[var(--text-primary)]'
            }`}
          >
            DCS & POWER
          </button>
          <button
            onClick={() => setActivePrimaryPreset('ENVIRONMENTAL')}
            className={`px-2 py-0.5 border cursor-pointer font-semibold rounded-[var(--radius-xs)] transition-colors ${
              activePreset === 'ENVIRONMENTAL'
                ? 'bg-[var(--bg-surface-elevated)] text-[var(--status-info)] border-[var(--status-info)]'
                : 'bg-[var(--bg-surface-2)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:text-[var(--text-primary)]'
            }`}
          >
            ENVIRONMENTAL BONUS
          </button>
        </div>

        {/* Timeframe Duration Selector */}
        <div className="flex items-center gap-1 font-mono-data text-[10px]">
          <span className="text-[var(--text-tertiary)] mr-1">WINDOW:</span>
          {[10, 30, 60, 120].map((sec) => (
            <button
              key={sec}
              onClick={() => setTimeframe(sec)}
              className={`px-2 py-0.5 border cursor-pointer rounded-[var(--radius-xs)] tabular-nums transition-colors ${
                timeframe === sec
                  ? 'bg-[var(--bg-surface-elevated)] text-[var(--action-amber)] border-[var(--border-amber)] font-bold'
                  : 'bg-[var(--bg-surface-2)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:text-[var(--text-primary)]'
              }`}
            >
              {sec}s
            </button>
          ))}
        </div>
      </div>

      {/* 2x2 Telemetry Graph Grid based on Active Category */}
      {activePreset === 'PRIMARY' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 grid-rows-2 gap-1.5 flex-1 h-full min-h-[380px]">
          {/* 1. Altitude */}
          <SingleGraph
            title="BAROMETRIC ALTITUDE"
            unit="m"
            currentValue={currentPacket.altitude}
            dataKey="altitude"
            color="#E5A93C"
            icon={<PlaneTakeoff className="w-3.5 h-3.5 text-[#E5A93C]" />}
            history={history}
            timeframeSeconds={timeframe}
            thresholdValue={600}
            thresholdLabel="DISREEF @ 600m"
          />

          {/* 2. Velocity */}
          <SingleGraph
            title="DESCENT RATE / VELOCITY"
            unit="m/s"
            currentValue={currentPacket.velocity}
            dataKey="velocity"
            color="#388BFD"
            icon={<Gauge className="w-3.5 h-3.5 text-[#388BFD]" />}
            history={history}
            timeframeSeconds={timeframe}
            thresholdValue={17}
            thresholdLabel="STAGE 1 TARGET: 17m/s"
          />

          {/* 3. Acceleration Gs */}
          <SingleGraph
            title="IMU ACCELERATION FORCE"
            unit="G"
            currentValue={currentPacket.acceleration}
            dataKey="acceleration"
            color="#8A99AD"
            icon={<Activity className="w-3.5 h-3.5 text-[#8A99AD]" />}
            history={history}
            timeframeSeconds={timeframe}
            thresholdValue={15}
            thresholdLabel="LAUNCH 15G / EJECT 30G"
          />

          {/* 4. Gyro Spin Rate */}
          <SingleGraph
            title="GYRO YAW PRECESSION RATE"
            unit="deg/s"
            currentValue={currentPacket.spinRate}
            dataKey="spinRate"
            color="#28C76F"
            icon={<RotateCw className="w-3.5 h-3.5 text-[#28C76F]" />}
            history={history}
            timeframeSeconds={timeframe}
            thresholdValue={3.18}
            thresholdLabel="TARGET: ~3.18°/s"
          />
        </div>
      )}

      {activePreset === 'STABILIZATION' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 grid-rows-2 gap-1.5 flex-1 h-full min-h-[380px]">
          {/* 1. Momentum Wheel RPM */}
          <SingleGraph
            title="MOMENTUM WHEEL SPEED"
            unit="RPM"
            currentValue={currentPacket.wheelRpm}
            dataKey="wheelRpm"
            color="#28C76F"
            icon={<RotateCw className="w-3.5 h-3.5 text-[#28C76F]" />}
            history={history}
            timeframeSeconds={timeframe}
            thresholdValue={12000}
            thresholdLabel="CRUISE: 12,000 RPM"
          />

          {/* 2. Current Draw */}
          <SingleGraph
            title="ACS712 CURRENT DRAW"
            unit="A"
            currentValue={currentPacket.currentDraw}
            dataKey="currentDraw"
            color="#E5A93C"
            icon={<Zap className="w-3.5 h-3.5 text-[#E5A93C]" />}
            history={history}
            timeframeSeconds={timeframe}
          />

          {/* 3. Battery Voltage */}
          <SingleGraph
            title="2S MOLICEL PACK VOLTAGE"
            unit="V"
            currentValue={currentPacket.batteryVoltage}
            dataKey="batteryVoltage"
            color="#388BFD"
            icon={<Zap className="w-3.5 h-3.5 text-[#388BFD]" />}
            history={history}
            timeframeSeconds={timeframe}
            thresholdValue={6.4}
            thresholdLabel="CUTOFF 6.4V"
          />

          {/* 4. Power Output */}
          <SingleGraph
            title="TOTAL SYSTEM POWER"
            unit="W"
            currentValue={currentPacket.power}
            dataKey="power"
            color="#8A99AD"
            icon={<Cpu className="w-3.5 h-3.5 text-[#8A99AD]" />}
            history={history}
            timeframeSeconds={timeframe}
          />
        </div>
      )}

      {activePreset === 'ENVIRONMENTAL' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 grid-rows-2 gap-1.5 flex-1 h-full min-h-[380px]">
          {/* 1. CO2 */}
          <SingleGraph
            title="SCD40 CO₂ CONCENTRATION"
            unit="ppm"
            currentValue={currentPacket.co2}
            dataKey="co2"
            color="#28C76F"
            icon={<Sparkles className="w-3.5 h-3.5 text-[#28C76F]" />}
            history={history}
            timeframeSeconds={timeframe}
          />

          {/* 2. PM2.5 */}
          <SingleGraph
            title="SPS30 PARTICULATE PM2.5"
            unit="µg/m³"
            currentValue={currentPacket.pm2_5}
            dataKey="pm2_5"
            color="#388BFD"
            icon={<Wind className="w-3.5 h-3.5 text-[#388BFD]" />}
            history={history}
            timeframeSeconds={timeframe}
          />

          {/* 3. UV Index */}
          <SingleGraph
            title="LTR390 UV INDEX"
            unit="Index"
            currentValue={currentPacket.uv}
            dataKey="uv"
            color="#E5A93C"
            icon={<Sparkles className="w-3.5 h-3.5 text-[#E5A93C]" />}
            history={history}
            timeframeSeconds={timeframe}
          />

          {/* 4. Humidity */}
          <SingleGraph
            title="GY-SHT40 HUMIDITY"
            unit="%RH"
            currentValue={currentPacket.humidity}
            dataKey="humidity"
            color="#388BFD"
            icon={<Wind className="w-3.5 h-3.5 text-[#388BFD]" />}
            history={history}
            timeframeSeconds={timeframe}
          />
        </div>
      )}
    </div>
  );
};
