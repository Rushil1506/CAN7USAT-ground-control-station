import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Compass,
  Cpu,
  Download,
  Gauge,
  Pause,
  PlaneTakeoff,
  Play,
  RotateCw,
  Sparkles,
  Wind,
  Zap,
} from 'lucide-react';
import { FLIGHT_STATES } from '../constants';
import { resolvePacketTimestampSeconds } from '../services/landingPredictorClient';
import { exportTelemetryPacketsToCsv } from '../services/telemetryExport';
import { FlightStateCode, TelemetryPacket, TelemetrySource } from '../types';

export interface TelemetryChartPanelProps {
  history: TelemetryPacket[];
  latestPacket: TelemetryPacket | null;
  telemetrySource?: TelemetrySource;
  isStale?: boolean;
  expandedMode?: boolean;
  overviewMode?: boolean;
  initialPreset?: 'PRIMARY' | 'BARO_IMU' | 'STABILIZATION' | 'ENVIRONMENTAL';
}

export interface SingleGraphProps {
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
  telemetrySource?: TelemetrySource;
}

export interface SegmentDataPoint {
  x: number;
  y: number;
  val: number;
  time: string;
  ts: number;
}

export interface PhaseTransitionMarker {
  stateCode: FlightStateCode;
  fswStateName: string;
  ts: number;
  x: number;
  label: string;
  color: string;
}

export function hexToRgba(hex: string, alpha: number): string {
  const cleanHex = hex.replace('#', '');
  const r = parseInt(cleanHex.substring(0, 2), 16) || 0;
  const g = parseInt(cleanHex.substring(2, 4), 16) || 0;
  const b = parseInt(cleanHex.substring(4, 6), 16) || 0;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export const isValidNum = (val: unknown): val is number =>
  typeof val === 'number' && Number.isFinite(val);

/**
 * Pure helper computing the active time-domain window bounds [startTs, latestTs]
 * and the subset of history packets within or immediately anchoring that span.
 */
export function computeChartWindowBounds(
  history: TelemetryPacket[],
  timeframeSeconds: number,
  telemetrySource: TelemetrySource
): { startTs: number; latestTs: number; relevantPackets: TelemetryPacket[] } {
  if (history.length === 0) {
    return { startTs: 0, latestTs: 0, relevantPackets: [] };
  }

  let latestTs = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const t = resolvePacketTimestampSeconds(history[i], telemetrySource);
    if (Number.isFinite(t) && t > 0) {
      latestTs = t;
      break;
    }
  }
  if (latestTs === 0) {
    latestTs = history.length * 0.1;
  }
  const startTs = Math.max(0, latestTs - timeframeSeconds);

  let firstIdx = 0;
  for (let i = 0; i < history.length; i++) {
    if (resolvePacketTimestampSeconds(history[i], telemetrySource) >= startTs) {
      firstIdx = Math.max(0, i - 1);
      break;
    }
  }

  return {
    startTs,
    latestTs,
    relevantPackets: history.slice(firstIdx),
  };
}

/**
 * Pure helper computing min, avg, max statistics strictly from valid samples
 * within the active time-domain window [startTs, latestTs].
 */
export function computeChartStats(
  packets: TelemetryPacket[],
  dataKey: keyof TelemetryPacket,
  startTs: number,
  latestTs: number,
  currentValue: number | null | undefined,
  telemetrySource: TelemetrySource
): {
  minVal: number | null;
  avgVal: number | null;
  maxVal: number | null;
  samplesInWindow: number[];
} {
  const samplesInWindow: number[] = [];
  for (const p of packets) {
    const ts = resolvePacketTimestampSeconds(p, telemetrySource);
    if (ts >= startTs - 0.05 && ts <= latestTs + 0.5) {
      const v = p[dataKey];
      if (isValidNum(v)) {
        samplesInWindow.push(v);
      }
    }
  }

  const hasCurrent = isValidNum(currentValue);
  const minVal =
    samplesInWindow.length > 0
      ? Math.min(...samplesInWindow)
      : hasCurrent
      ? currentValue
      : null;
  const maxVal =
    samplesInWindow.length > 0
      ? Math.max(...samplesInWindow)
      : hasCurrent
      ? currentValue
      : null;
  const avgVal =
    samplesInWindow.length > 0
      ? samplesInWindow.reduce((a, b) => a + b, 0) / samplesInWindow.length
      : hasCurrent
      ? currentValue
      : null;

  return { minVal, avgVal, maxVal, samplesInWindow };
}

/**
 * Segments incoming telemetry packets into continuous subpaths.
 * Breaks trace continuity whenever:
 * 1. The dataKey measurement is null, undefined, NaN, or non-finite.
 * 2. The time elapsed between consecutive packets exceeds maxAllowedGapSeconds (e.g. 2.5s dropout).
 * Never interpolates or connects lines across invalid samples or missing packets.
 */
export function segmentChartPackets(
  packets: TelemetryPacket[],
  dataKey: keyof TelemetryPacket,
  startTs: number,
  timeframeSeconds: number,
  width: number,
  height: number,
  yMin: number,
  yMax: number,
  telemetrySource: TelemetrySource,
  maxAllowedGapSeconds = 2.5
): SegmentDataPoint[][] {
  const segments: SegmentDataPoint[][] = [];
  let currentSeg: SegmentDataPoint[] = [];
  let prevTs: number | null = null;

  const yRange = yMax - yMin || 1;
  const getY = (val: number) => height - ((val - yMin) / yRange) * height;
  const getX = (ts: number) =>
    timeframeSeconds > 0 ? ((ts - startTs) / timeframeSeconds) * width : width;

  for (const pkt of packets) {
    const ts = resolvePacketTimestampSeconds(pkt, telemetrySource);
    const rawVal = pkt[dataKey];
    const valid = isValidNum(rawVal);
    const isGap = prevTs !== null && ts - prevTs > maxAllowedGapSeconds;

    if (!valid || isGap) {
      if (currentSeg.length > 0) {
        segments.push(currentSeg);
        currentSeg = [];
      }
    }

    if (valid) {
      currentSeg.push({
        x: getX(ts),
        y: getY(rawVal as number),
        val: rawVal as number,
        time: pkt.timestampUtc,
        ts,
      });
    }

    prevTs = ts;
  }

  if (currentSeg.length > 0) {
    segments.push(currentSeg);
  }

  return segments;
}

/**
 * Detects flight phase state transitions (stateCode change) within the active chart window
 * to render vertical transition boundary markers and labels.
 */
export function detectPhaseTransitions(
  packets: TelemetryPacket[],
  startTs: number,
  timeframeSeconds: number,
  width: number,
  telemetrySource: TelemetrySource
): PhaseTransitionMarker[] {
  const transitions: PhaseTransitionMarker[] = [];
  for (let i = 1; i < packets.length; i++) {
    const curr = packets[i];
    const prev = packets[i - 1];
    if (
      curr.stateCode !== null &&
      curr.stateCode !== undefined &&
      curr.stateCode !== prev.stateCode
    ) {
      const ts = resolvePacketTimestampSeconds(curr, telemetrySource);
      const x =
        timeframeSeconds > 0
          ? ((ts - startTs) / timeframeSeconds) * width
          : width;
      if (x >= 0 && x <= width) {
        const stateInfo =
          curr.stateCode in FLIGHT_STATES ? FLIGHT_STATES[curr.stateCode] : null;
        const phaseColor = stateInfo?.color || '#b45309';
        const phaseLabel =
          stateInfo?.label.split(':')[1]?.trim() ||
          curr.fswStateName ||
          `STATE ${curr.stateCode}`;

        transitions.push({
          stateCode: curr.stateCode,
          fswStateName: curr.fswStateName,
          ts,
          x,
          label: phaseLabel,
          color: phaseColor,
        });
      }
    }
  }
  return transitions;
}

export const SingleGraph: React.FC<SingleGraphProps> = ({
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
  telemetrySource = 'SIMULATION',
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [containerSize, setContainerSize] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });
  const [hoverData, setHoverData] = useState<{
    time: string;
    val: number;
    x: number;
    y: number;
  } | null>(null);
  const [isPaused, setIsPaused] = useState(false);

  // ResizeObserver on the canvas container to adapt to flex/grid container dimensions
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setContainerSize({
            width: Math.floor(width),
            height: Math.floor(height),
          });
        }
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { startTs, latestTs, relevantPackets } = useMemo(() => {
    return computeChartWindowBounds(history, timeframeSeconds, telemetrySource);
  }, [history, timeframeSeconds, telemetrySource]);

  const { minVal, avgVal, maxVal, samplesInWindow } = useMemo(() => {
    return computeChartStats(
      relevantPackets,
      dataKey,
      startTs,
      latestTs,
      currentValue,
      telemetrySource
    );
  }, [relevantPackets, dataKey, startTs, latestTs, currentValue, telemetrySource]);

  const hasCurrent = isValidNum(currentValue);

  useEffect(() => {
    if (isPaused) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const w = containerSize.width;
    const h = containerSize.height;
    if (w <= 0 || h <= 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.clearRect(0, 0, w, h);

    // Dynamic Y Range with Threshold and 15% Padding
    let yMin = samplesInWindow.length > 0 ? Math.min(...samplesInWindow) : 0;
    let yMax = samplesInWindow.length > 0 ? Math.max(...samplesInWindow) : 1;
    if (thresholdValue !== undefined) {
      yMin = Math.min(yMin, thresholdValue);
      yMax = Math.max(yMax, thresholdValue);
    }
    if (yMin === yMax) {
      yMin -= 1;
      yMax += 1;
    }
    const padding = (yMax - yMin) * 0.15;
    yMin -= padding;
    yMax += padding;

    const yRange = yMax - yMin;
    const getY = (val: number) => h - ((val - yMin) / yRange) * h;

    // 1. Subtle Engineering Grid & Axis Value Labels
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.07)';
    ctx.lineWidth = 1;

    // Horizontal grid lines + Y-axis scale markings
    const gridRows = 4;
    ctx.font = '9px "JetBrains Mono", Menlo, monospace';
    ctx.fillStyle = 'rgba(100, 116, 139, 0.7)';
    ctx.textBaseline = 'bottom';

    for (let i = 1; i < gridRows; i++) {
      const y = (h / gridRows) * i;
      ctx.beginPath();
      ctx.setLineDash([3, 3]);
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();

      const lineVal = yMax - (i / gridRows) * yRange;
      const valText = `${
        Math.abs(lineVal) >= 100 || Math.abs(lineVal) < 0.01
          ? lineVal.toFixed(0)
          : lineVal.toFixed(1)
      } ${unit}`;
      ctx.setLineDash([]);
      ctx.fillText(valText, 6, y - 2);
    }

    // Vertical time grid lines + X-axis time marks (-30s, -20s, -10s, NOW)
    const gridCols = 4;
    for (let j = 0; j <= gridCols; j++) {
      const x = (w / gridCols) * j;
      if (j > 0 && j < gridCols) {
        ctx.beginPath();
        ctx.setLineDash([3, 3]);
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }

      const offsetSec = Math.round(-timeframeSeconds * (1 - j / gridCols));
      const timeLabel = j === gridCols ? 'NOW' : `${offsetSec}s`;
      ctx.setLineDash([]);
      const textW = ctx.measureText(timeLabel).width;
      const tx = j === gridCols ? w - textW - 5 : j === 0 ? 5 : x - textW / 2;
      ctx.fillText(timeLabel, tx, h - 3);
    }
    ctx.setLineDash([]);

    // 2. Reference Threshold Line if Specified
    if (thresholdValue !== undefined) {
      const thresholdY = getY(thresholdValue);
      if (thresholdY >= 0 && thresholdY <= h) {
        ctx.beginPath();
        ctx.setLineDash([5, 4]);
        ctx.moveTo(0, thresholdY);
        ctx.lineTo(w, thresholdY);
        ctx.strokeStyle = 'rgba(180, 83, 9, 0.65)';
        ctx.lineWidth = 1.25;
        ctx.stroke();
        ctx.setLineDash([]);

        if (thresholdLabel) {
          ctx.font = 'bold 9px "JetBrains Mono", Menlo, monospace';
          ctx.fillStyle = 'rgba(180, 83, 9, 0.9)';
          const thTextW = ctx.measureText(thresholdLabel).width;
          ctx.fillText(thresholdLabel, w - thTextW - 6, thresholdY - 3);
        }
      }
    }

    // 3. Segment packet trace to prevent connecting across null/NaN or dropouts (> 2.5s)
    const segments = segmentChartPackets(
      relevantPackets,
      dataKey,
      startTs,
      timeframeSeconds,
      w,
      h,
      yMin,
      yMax,
      telemetrySource,
      2.5
    );

    // 4. Flight Phase Transitions (Annotate state transitions in visible window)
    const transitions = detectPhaseTransitions(
      relevantPackets,
      startTs,
      timeframeSeconds,
      w,
      telemetrySource
    );

    for (const tr of transitions) {
      ctx.save();
      ctx.beginPath();
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = tr.color;
      ctx.lineWidth = 1.2;
      ctx.moveTo(tr.x, 0);
      ctx.lineTo(tr.x, h);
      ctx.stroke();

      // Compact state badge at top of canvas
      ctx.font = 'bold 9px "JetBrains Mono", Menlo, monospace';
      const text = `▶ ${tr.label}`;
      const badgeTextW = ctx.measureText(text).width;
      const badgeW = badgeTextW + 8;
      const badgeH = 14;
      const badgeX = Math.min(Math.max(tr.x - badgeW / 2, 2), w - badgeW - 2);
      const badgeY = 3;

      ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
      ctx.fillRect(badgeX, badgeY, badgeW, badgeH);
      ctx.strokeStyle = tr.color;
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      ctx.strokeRect(badgeX, badgeY, badgeW, badgeH);

      ctx.fillStyle = tr.color;
      ctx.textBaseline = 'middle';
      ctx.fillText(text, badgeX + 4, badgeY + badgeH / 2);
      ctx.restore();
    }

    // 5. Draw Discontinuous Segments (Soft Area Fills & Clean Lines)
    for (const seg of segments) {
      if (seg.length === 1) {
        ctx.beginPath();
        ctx.arc(seg[0].x, seg[0].y, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
      } else if (seg.length >= 2) {
        // Area fill under segment
        const gradient = ctx.createLinearGradient(0, 0, 0, h);
        gradient.addColorStop(0, hexToRgba(color, 0.14));
        gradient.addColorStop(1, hexToRgba(color, 0.0));

        ctx.beginPath();
        ctx.moveTo(seg[0].x, h);
        for (const pt of seg) {
          ctx.lineTo(pt.x, pt.y);
        }
        ctx.lineTo(seg[seg.length - 1].x, h);
        ctx.closePath();
        ctx.fillStyle = gradient;
        ctx.fill();

        // Stroke line
        ctx.beginPath();
        ctx.moveTo(seg[0].x, seg[0].y);
        for (let k = 1; k < seg.length; k++) {
          ctx.lineTo(seg[k].x, seg[k].y);
        }
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.stroke();
      }
    }

    // 6. Highlight Latest Real-time Point Marker
    if (segments.length > 0) {
      const lastSeg = segments[segments.length - 1];
      const lastPt = lastSeg[lastSeg.length - 1];
      if (lastPt.x >= 0 && lastPt.x <= w + 4) {
        ctx.beginPath();
        ctx.arc(lastPt.x, lastPt.y, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();

        ctx.beginPath();
        ctx.arc(lastPt.x, lastPt.y, 6.5, 0, Math.PI * 2);
        ctx.strokeStyle = hexToRgba(color, 0.45);
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
  }, [
    relevantPackets,
    samplesInWindow,
    containerSize,
    isPaused,
    timeframeSeconds,
    color,
    dataKey,
    thresholdValue,
    thresholdLabel,
    telemetrySource,
    startTs,
    unit,
  ]);

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || samplesInWindow.length === 0) return;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const hoverTs = startTs + (mouseX / rect.width) * timeframeSeconds;

    // Find closest packet in relevantPackets with valid dataKey within 2.5s
    let closest: { pkt: TelemetryPacket; diff: number; val: number } | null = null;
    for (const p of relevantPackets) {
      const v = p[dataKey];
      if (isValidNum(v)) {
        const t = resolvePacketTimestampSeconds(p, telemetrySource);
        const diff = Math.abs(t - hoverTs);
        if (diff <= 2.5 && (!closest || diff < closest.diff)) {
          closest = { pkt: p, diff, val: v };
        }
      }
    }

    if (closest) {
      const t = resolvePacketTimestampSeconds(closest.pkt, telemetrySource);
      const x = ((t - startTs) / timeframeSeconds) * rect.width;
      setHoverData({
        time: closest.pkt.timestampUtc,
        val: closest.val,
        x: Math.max(0, Math.min(x, rect.width)),
        y: e.clientY - rect.top,
      });
    } else {
      setHoverData(null);
    }
  };

  return (
    <div className="ops-card p-3 flex flex-col justify-between select-none group h-full min-h-0 transition-shadow hover:shadow-[var(--shadow-md)]">
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

      {/* Real-time Canvas Graph View with Dynamic ResizeObserver Container */}
      <div
        ref={containerRef}
        className="relative w-full flex-1 min-h-[120px] mt-1 overflow-hidden bg-[var(--bg-surface-2)]/70 border border-[var(--border-subtle)] rounded-[var(--radius-sm)]"
      >
        <canvas
          ref={canvasRef}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoverData(null)}
          className="w-full h-full cursor-crosshair block"
        />

        {samplesInWindow.length === 0 && (
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
              left: Math.min(hoverData.x + 10, (containerSize.width || 200) - 110),
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

export function getChartPresetTabs(overviewMode?: boolean) {
  return overviewMode
    ? ([
        { id: 'PRIMARY', label: 'Primary (Alt/Rate)' },
        { id: 'BARO_IMU', label: 'Baro & Temp' },
        { id: 'STABILIZATION', label: 'DCS & Power' },
        { id: 'ENVIRONMENTAL', label: 'Payload' },
      ] as const)
    : ([
        { id: 'PRIMARY', label: 'Primary Flight Metrics' },
        { id: 'BARO_IMU', label: 'Barometric & IMU' },
        { id: 'STABILIZATION', label: 'DCS & Electrical Power' },
        { id: 'ENVIRONMENTAL', label: 'Environmental Payload' },
      ] as const);
}

export function getChartGridClass(overviewMode?: boolean) {
  return overviewMode
    ? 'grid grid-cols-1 sm:grid-cols-2 gap-2 flex-1 min-h-0 h-full overflow-hidden'
    : 'grid grid-cols-1 sm:grid-cols-2 sm:grid-rows-2 gap-2.5 flex-1 min-h-0 h-full overflow-y-auto sm:overflow-hidden';
}

export const TelemetryChartPanel: React.FC<TelemetryChartPanelProps> = ({
  history,
  latestPacket,
  telemetrySource = 'SIMULATION',
  isStale = false,
  expandedMode = false,
  overviewMode = false,
  initialPreset = 'PRIMARY',
}) => {
  const [timeframe, setTimeframe] = useState<number>(30);
  const [activePreset, setActivePrimaryPreset] = useState<
    'PRIMARY' | 'BARO_IMU' | 'STABILIZATION' | 'ENVIRONMENTAL'
  >(initialPreset);

  const isSim = telemetrySource === 'SIMULATION';

  const presetTabs = getChartPresetTabs(overviewMode);
  const gridClass = getChartGridClass(overviewMode);

  return (
    <div className="flex flex-col h-full min-h-0 gap-2">
      {/* Timeframe & Chart Category Toolbar */}
      <div
        className={`flex justify-between items-center ${
          overviewMode ? 'px-2.5 py-1.5' : 'px-3 py-2'
        } bg-[var(--bg-surface-1)] border border-[var(--border-subtle)] shadow-[var(--shadow-xs)] rounded-[var(--radius-md)] flex-wrap gap-1.5 shrink-0`}
      >
        {/* Preset Selector */}
        <div className="flex items-center gap-1.5 text-xs flex-wrap">
          {presetTabs.map((tab) => {
            const isActive = activePreset === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActivePrimaryPreset(tab.id)}
                className={`px-2 py-0.5 border cursor-pointer font-semibold rounded-[var(--radius-sm)] transition-colors text-xs ${
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

        {/* Source, Timeframe Duration Selector & Export Controls */}
        <div className="flex items-center gap-2 font-mono-data text-[11px] flex-wrap">
          {expandedMode && (
            <button
              type="button"
              onClick={() => exportTelemetryPacketsToCsv(history, telemetrySource)}
              disabled={history.length === 0}
              title="Export complete telemetry packet history to standard 34-column CSV"
              className="px-2.5 py-1 bg-[var(--accent-cobalt-soft)] hover:bg-[var(--accent-cobalt)] hover:text-white text-[var(--accent-cobalt)] border border-[var(--accent-cobalt)]/30 rounded-[var(--radius-sm)] font-semibold text-[11px] cursor-pointer flex items-center gap-1 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export CSV ({history.length})</span>
            </button>
          )}

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
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 shrink-0">
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

      {/* Telemetry Graph Grid: 2-graph single row in overviewMode, 4-graph 2x2 grid in standard/expanded mode */}
      {activePreset === 'PRIMARY' && (
        <div className={gridClass}>
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
            telemetrySource={telemetrySource}
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
            telemetrySource={telemetrySource}
          />

          {!overviewMode && (
            <>
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
                  telemetrySource={telemetrySource}
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
                  telemetrySource={telemetrySource}
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
                telemetrySource={telemetrySource}
              />
            </>
          )}
        </div>
      )}

      {activePreset === 'BARO_IMU' && (
        <div className={gridClass}>
          <SingleGraph
            title="Barometric Pressure"
            unit="hPa"
            currentValue={latestPacket?.pressure}
            dataKey="pressure"
            color="#1d4ed8"
            icon={<Gauge className="w-4 h-4 text-[#1d4ed8]" />}
            history={history}
            timeframeSeconds={timeframe}
            telemetrySource={telemetrySource}
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
            telemetrySource={telemetrySource}
          />

          {!overviewMode && (
            <>
              <SingleGraph
                title="IMU Roll Angle"
                unit="deg"
                currentValue={latestPacket?.roll}
                dataKey="roll"
                color="#4338ca"
                icon={<Compass className="w-4 h-4 text-[#4338ca]" />}
                history={history}
                timeframeSeconds={timeframe}
                telemetrySource={telemetrySource}
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
                telemetrySource={telemetrySource}
              />
            </>
          )}
        </div>
      )}

      {activePreset === 'STABILIZATION' && (
        <div className={gridClass}>
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
            telemetrySource={telemetrySource}
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
            telemetrySource={telemetrySource}
          />

          {!overviewMode && (
            <>
              <SingleGraph
                title="System Current Draw"
                unit="A"
                currentValue={latestPacket?.currentDraw}
                dataKey="currentDraw"
                color="#b45309"
                icon={<Zap className="w-4 h-4 text-[#b45309]" />}
                history={history}
                timeframeSeconds={timeframe}
                telemetrySource={telemetrySource}
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
                telemetrySource={telemetrySource}
              />
            </>
          )}
        </div>
      )}

      {activePreset === 'ENVIRONMENTAL' && (
        <div className={gridClass}>
          <SingleGraph
            title="SCD40 CO₂ Concentration"
            unit="ppm"
            currentValue={latestPacket?.co2}
            dataKey="co2"
            color="#0f766e"
            icon={<Sparkles className="w-4 h-4 text-[#0f766e]" />}
            history={history}
            timeframeSeconds={timeframe}
            telemetrySource={telemetrySource}
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
            telemetrySource={telemetrySource}
          />

          {!overviewMode && (
            <>
              <SingleGraph
                title="LTR390 UV Index"
                unit="Index"
                currentValue={latestPacket?.uv}
                dataKey="uv"
                color="#b45309"
                icon={<Sparkles className="w-4 h-4 text-[#b45309]" />}
                history={history}
                timeframeSeconds={timeframe}
                telemetrySource={telemetrySource}
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
                telemetrySource={telemetrySource}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
};

