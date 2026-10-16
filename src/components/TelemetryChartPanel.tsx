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
  accentClass: string;
  icon: React.ReactNode;
  history: TelemetryPacket[];
  timeframeSeconds: number;
  thresholdValue?: number;
  thresholdLabel?: string;
}

const SingleGraph: React.FC<SingleGraphProps> = ({
  title,
  unit,
  currentValue,
  dataKey,
  color,
  accentClass,
  icon,
  history,
  timeframeSeconds,
  thresholdValue,
  thresholdLabel,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hoverData, setHoverData] = useState<{ time: string; val: number; x: number; y: number } | null>(null);
  const [isPaused, setIsPaused] = useState(false);

  // Calculate statistics
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
    const width = (canvas.width = rect.width * window.devicePixelRatio);
    const height = (canvas.height = rect.height * window.devicePixelRatio);

    ctx.clearRect(0, 0, width, height);

    if (recentSlice.length < 2) return;

    // Draw background grid
    ctx.strokeStyle = '#272A31';
    ctx.lineWidth = 1 * window.devicePixelRatio;
    const gridRows = 4;
    for (let i = 1; i < gridRows; i++) {
      const y = (height / gridRows) * i;
      ctx.beginPath();
      ctx.setLineDash([4 * window.devicePixelRatio, 4 * window.devicePixelRatio]);
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Compute Y range
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

    // Draw threshold line if specified (e.g. 600m disreefing or 12000 RPM)
    if (thresholdValue !== undefined) {
      const thresholdY = getY(thresholdValue);
      ctx.beginPath();
      ctx.setLineDash([6 * window.devicePixelRatio, 4 * window.devicePixelRatio]);
      ctx.moveTo(0, thresholdY);
      ctx.lineTo(width, thresholdY);
      ctx.strokeStyle = '#FF5252';
      ctx.lineWidth = 1.5 * window.devicePixelRatio;
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Draw area fill gradient
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, color + '40'); // 25% opacity
    gradient.addColorStop(1, color + '00'); // 0% opacity

    ctx.beginPath();
    ctx.moveTo(getX(0), getY(values[0]));
    for (let i = 1; i < values.length; i++) {
      const x = getX(i);
      const y = getY(values[i]);
      ctx.lineTo(x, y);
    }
    ctx.lineTo(width, height);
    ctx.lineTo(0, height);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    // Draw line path
    ctx.beginPath();
    ctx.moveTo(getX(0), getY(values[0]));
    for (let i = 1; i < values.length; i++) {
      const x = getX(i);
      const y = getY(values[i]);
      ctx.lineTo(x, y);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5 * window.devicePixelRatio;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Highlight latest point
    const lastX = getX(values.length - 1);
    const lastY = getY(values[values.length - 1]);

    ctx.beginPath();
    ctx.arc(lastX, lastY, 4 * window.devicePixelRatio, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(lastX, lastY, 7 * window.devicePixelRatio, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5 * window.devicePixelRatio;
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
    <div className={`telemetry-panel ${accentClass} p-3 sm:p-3.5 flex flex-col justify-between select-none group h-full`}>
      {/* Header Info */}
      <div className="flex justify-between items-center mb-1">
        <div className="flex items-center gap-2">
          <span className="font-mono-data text-xs font-bold text-[#D7C4AC] uppercase tracking-wider">
            {title} ({unit})
          </span>
          {thresholdLabel && (
            <span className="font-mono-data text-[9px] text-[#FF5252] border border-[#FF5252]/40 px-1 bg-[#1D2026]">
              {thresholdLabel}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsPaused(!isPaused)}
            title={isPaused ? 'Resume Chart' : 'Pause Chart'}
            className="text-[#9F8E78] hover:text-[#FFD597] transition-colors p-0.5 cursor-pointer"
          >
            {isPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
          </button>
          <div className="text-[#9F8E78] opacity-70 group-hover:opacity-100 transition-opacity">
            {icon}
          </div>
        </div>
      </div>

      {/* Numerical Telemetry Readout */}
      <div className="flex items-baseline justify-between my-1">
        <div className="font-mono-data text-2xl sm:text-3xl lg:text-4xl font-extrabold tracking-tight" style={{ color }}>
          {currentValue.toFixed(1)}
        </div>
        <div className="text-right font-mono-data text-[10px] text-[#9F8E78]">
          <div>MAX: {maxVal.toFixed(1)}</div>
          <div>MIN: {minVal.toFixed(1)}</div>
        </div>
      </div>

      {/* Real-time Canvas Graph View */}
      <div className="relative w-full h-24 sm:h-28 mt-1 overflow-hidden bg-[#0B0E14]/40 border border-[#272A31]">
        <canvas
          ref={canvasRef}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoverData(null)}
          className="w-full h-full cursor-crosshair block"
        />

        {/* Hover Crosshair Overlay */}
        {hoverData && (
          <div
            className="absolute z-10 pointer-events-none bg-[#1D2026]/95 border border-[#FFD597] px-2 py-1 text-[11px] font-mono-data text-[#E1E2EB] shadow-lg"
            style={{
              left: Math.min(hoverData.x + 10, 160),
              top: Math.max(hoverData.y - 30, 5),
            }}
          >
            <div className="text-[#9F8E78] text-[9px]">{hoverData.time}</div>
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
    batteryVoltage: 7.85,
    currentDraw: 2.45,
    power: 19.2,
    batterySoc: 85.0,
  };

  return (
    <div className="flex flex-col h-full gap-1">
      {/* Timeframe & Chart Category Toolbar */}
      <div className="flex justify-between items-center px-2.5 py-1.5 bg-[#10131A] border-b border-[#2A2E35] flex-wrap gap-2">
        {/* Preset Selector */}
        <div className="flex items-center gap-1 font-mono-data text-[10px]">
          <button
            onClick={() => setActivePrimaryPreset('PRIMARY')}
            className={`px-2 py-0.5 border cursor-pointer font-bold ${
              activePreset === 'PRIMARY'
                ? 'bg-[#FFD597] text-[#000] border-[#FFD597]'
                : 'bg-[#161B22] text-[#9F8E78] border-[#2A2E35] hover:text-[#E1E2EB]'
            }`}
          >
            PRIMARY METRICS
          </button>
          <button
            onClick={() => setActivePrimaryPreset('STABILIZATION')}
            className={`px-2 py-0.5 border cursor-pointer font-bold ${
              activePreset === 'STABILIZATION'
                ? 'bg-[#38FA87] text-[#000] border-[#38FA87]'
                : 'bg-[#161B22] text-[#9F8E78] border-[#2A2E35] hover:text-[#E1E2EB]'
            }`}
          >
            DCS & POWER
          </button>
          <button
            onClick={() => setActivePrimaryPreset('ENVIRONMENTAL')}
            className={`px-2 py-0.5 border cursor-pointer font-bold ${
              activePreset === 'ENVIRONMENTAL'
                ? 'bg-[#00A2FD] text-[#000] border-[#00A2FD]'
                : 'bg-[#161B22] text-[#9F8E78] border-[#2A2E35] hover:text-[#E1E2EB]'
            }`}
          >
            ENVIRONMENTAL BONUS
          </button>
        </div>

        {/* Timeframe Duration Selector */}
        <div className="flex items-center gap-1 font-mono-data text-[10px]">
          <span className="text-[#9F8E78] mr-1">TIMEFRAME:</span>
          {[10, 30, 60, 120].map((sec) => (
            <button
              key={sec}
              onClick={() => setTimeframe(sec)}
              className={`px-2 py-0.5 border cursor-pointer ${
                timeframe === sec
                  ? 'bg-[#272A31] text-[#FFD597] border-[#FFD597]'
                  : 'bg-[#161B22] text-[#9F8E78] border-[#2A2E35] hover:text-[#E1E2EB]'
              }`}
            >
              {sec}s
            </button>
          ))}
        </div>
      </div>

      {/* 2x2 Telemetry Graph Grid based on Active Category */}
      {activePreset === 'PRIMARY' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 grid-rows-2 gap-1 flex-1 h-full min-h-[380px]">
          {/* 1. Altitude */}
          <SingleGraph
            title="BAROMETRIC ALTITUDE"
            unit="m"
            currentValue={currentPacket.altitude}
            dataKey="altitude"
            color="#FFD597"
            accentClass="panel-amber-accent"
            icon={<PlaneTakeoff className="w-4 h-4 text-[#FFD597]" />}
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
            color="#98CBFF"
            accentClass="panel-blue-accent"
            icon={<Gauge className="w-4 h-4 text-[#98CBFF]" />}
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
            color="#D7C4AC"
            accentClass="panel-gray-accent"
            icon={<Activity className="w-4 h-4 text-[#D7C4AC]" />}
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
            color="#38FA87"
            accentClass="panel-green-accent"
            icon={<RotateCw className="w-4 h-4 text-[#38FA87]" />}
            history={history}
            timeframeSeconds={timeframe}
            thresholdValue={3.18}
            thresholdLabel="TARGET: ~3.18°/s"
          />
        </div>
      )}

      {activePreset === 'STABILIZATION' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 grid-rows-2 gap-1 flex-1 h-full min-h-[380px]">
          {/* 1. Momentum Wheel RPM */}
          <SingleGraph
            title="MOMENTUM WHEEL SPEED"
            unit="RPM"
            currentValue={currentPacket.wheelRpm}
            dataKey="wheelRpm"
            color="#38FA87"
            accentClass="panel-green-accent"
            icon={<RotateCw className="w-4 h-4 text-[#38FA87]" />}
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
            color="#FFD597"
            accentClass="panel-amber-accent"
            icon={<Zap className="w-4 h-4 text-[#FFD597]" />}
            history={history}
            timeframeSeconds={timeframe}
          />

          {/* 3. Battery Voltage */}
          <SingleGraph
            title="2S MOLICEL PACK VOLTAGE"
            unit="V"
            currentValue={currentPacket.batteryVoltage}
            dataKey="batteryVoltage"
            color="#00A2FD"
            accentClass="panel-blue-accent"
            icon={<Zap className="w-4 h-4 text-[#00A2FD]" />}
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
            color="#D7C4AC"
            accentClass="panel-gray-accent"
            icon={<Cpu className="w-4 h-4 text-[#D7C4AC]" />}
            history={history}
            timeframeSeconds={timeframe}
          />
        </div>
      )}

      {activePreset === 'ENVIRONMENTAL' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 grid-rows-2 gap-1 flex-1 h-full min-h-[380px]">
          {/* 1. CO2 */}
          <SingleGraph
            title="SCD40 CO₂ CONCENTRATION"
            unit="ppm"
            currentValue={currentPacket.co2}
            dataKey="co2"
            color="#38FA87"
            accentClass="panel-green-accent"
            icon={<Sparkles className="w-4 h-4 text-[#38FA87]" />}
            history={history}
            timeframeSeconds={timeframe}
          />

          {/* 2. PM2.5 */}
          <SingleGraph
            title="SPS30 PARTICULATE PM2.5"
            unit="µg/m³"
            currentValue={currentPacket.pm2_5}
            dataKey="pm2_5"
            color="#00A2FD"
            accentClass="panel-blue-accent"
            icon={<Wind className="w-4 h-4 text-[#00A2FD]" />}
            history={history}
            timeframeSeconds={timeframe}
          />

          {/* 3. UV Index */}
          <SingleGraph
            title="LTR390 UV INDEX"
            unit="Index"
            currentValue={currentPacket.uv}
            dataKey="uv"
            color="#FFD597"
            accentClass="panel-amber-accent"
            icon={<Sparkles className="w-4 h-4 text-[#FFD597]" />}
            history={history}
            timeframeSeconds={timeframe}
          />

          {/* 4. Humidity */}
          <SingleGraph
            title="GY-SHT40 HUMIDITY"
            unit="%RH"
            currentValue={currentPacket.humidity}
            dataKey="humidity"
            color="#98CBFF"
            accentClass="panel-blue-accent"
            icon={<Wind className="w-4 h-4 text-[#98CBFF]" />}
            history={history}
            timeframeSeconds={timeframe}
          />
        </div>
      )}
    </div>
  );
};
