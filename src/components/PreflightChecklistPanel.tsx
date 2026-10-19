import React, { useState } from 'react';
import {
  AlertOctagon,
  Battery,
  CheckCircle2,
  ClipboardCheck,
  Cpu,
  Radio,
  Rocket,
  ShieldCheck,
  Volume2,
} from 'lucide-react';
import { TelemetryPacket, TelemetrySource } from '../types';

interface PreflightChecklistPanelProps {
  latestPacket: TelemetryPacket | null;
  telemetrySource?: TelemetrySource;
  onStartLaunch: () => void;
}

const isValidNum = (val: unknown): val is number =>
  typeof val === 'number' && Number.isFinite(val);

export interface EvaluatedChecklistItem {
  id: number;
  title: string;
  requirement: string;
  status: string;
  pass: boolean;
  isManualInLive: boolean;
  isChecked: boolean;
  itemOk: boolean;
}

export function getDefaultChecklistState(
  telemetrySource: TelemetrySource
): Record<number, boolean> {
  if (telemetrySource === 'LIVE_SERIAL') {
    return {
      1: true,
      2: true,
      3: true,
      4: false,
      5: false,
      6: false,
      7: true,
      8: false,
    };
  }
  return {
    1: true,
    2: true,
    3: true,
    4: true,
    5: true,
    6: true,
    7: true,
    8: true,
  };
}

export function evaluatePreflightChecklist(
  latestPacket: TelemetryPacket | null,
  telemetrySource: TelemetrySource,
  checkedItems: Record<number, boolean>
): {
  items: EvaluatedChecklistItem[];
  allGo: boolean;
} {
  const p = latestPacket;
  const isSim = telemetrySource === 'SIMULATION';

  const hasGpsLock = Boolean(
    p && p.gpsValid && isValidNum(p.gpsSats) && p.gpsSats >= 4
  );
  const gpsStatusText = !p
    ? 'AWAITING TELEMETRY'
    : hasGpsLock
    ? `LOCKED (${p.gpsSats} SATS)`
    : `NO LOCK (${isValidNum(p.gpsSats) ? p.gpsSats : 0} SATS)`;

  const hasValidBaro = Boolean(
    p &&
      isValidNum(p.pressure) &&
      p.pressure > 100 &&
      isValidNum(p.temperature)
  );
  const baroStatusText = !p
    ? 'AWAITING TELEMETRY'
    : isValidNum(p.pressure) && isValidNum(p.temperature)
    ? `${p.pressure.toFixed(1)} hPa / ${p.temperature.toFixed(1)}°C${
        p.pressure <= 100 ? ' (UNINITIALIZED)' : ''
      }`
    : 'UNAVAILABLE';

  const hasValidBatt = Boolean(
    p && isValidNum(p.batteryVoltage) && p.batteryVoltage >= 7.0
  );
  const battStatusText = !p
    ? 'AWAITING TELEMETRY'
    : isValidNum(p.batteryVoltage)
    ? `${p.batteryVoltage.toFixed(2)}V${
        isValidNum(p.batterySoc) ? ` (${p.batterySoc.toFixed(0)}%)` : ''
      }${p.batteryVoltage < 7.0 ? ' (LOW / ZERO)' : ''}`
    : 'UNAVAILABLE';

  const hasWheelTelemetry = Boolean(p && isValidNum(p.wheelRpm));
  const wheelChecked = Boolean(checkedItems[6]);
  const wheelStatusText = hasWheelTelemetry
    ? `${Math.round(p!.wheelRpm!).toLocaleString()} RPM`
    : isSim
    ? 'AWAITING SIM'
    : wheelChecked
    ? 'VERIFIED BY OPERATOR (MANUAL)'
    : 'NOT IN LIVE CSV — MANUAL VERIFICATION REQUIRED';

  const rawItems: Omit<EvaluatedChecklistItem, 'isChecked' | 'itemOk'>[] = [
    {
      id: 1,
      title: 'GNSS 3D Fix & Satellite Lock',
      requirement:
        'NEO-M9N GNSS Receiver >= 4 Satellites with valid non-zero coordinates',
      status: gpsStatusText,
      pass: hasGpsLock,
      isManualInLive: false,
    },
    {
      id: 2,
      title: 'MS5611 Barometer & GY-SHT40 Calibration',
      requirement:
        'Non-zero atmospheric pressure (> 100 hPa) & air temperature verified',
      status: baroStatusText,
      pass: hasValidBaro,
      isManualInLive: false,
    },
    {
      id: 3,
      title: '2S Molicel INR-18650-P30B Battery Pack',
      requirement: 'Pack Voltage >= 7.0V (Capacity Margin > 1700 mAh)',
      status: battStatusText,
      pass: hasValidBatt,
      isManualInLive: false,
    },
    {
      id: 4,
      title: 'Onboard MicroSD Card Data Logging',
      requirement: 'Teensy 4.1 microSD slot mounted and writable for flight backup',
      status: isSim
        ? 'MOUNTED (SIMULATED)'
        : checkedItems[4]
        ? 'VERIFIED BY OPERATOR (MANUAL)'
        : 'MANUAL VERIFICATION REQUIRED',
      pass: isSim ? true : Boolean(checkedItems[4]),
      isManualInLive: true,
    },
    {
      id: 5,
      title: 'Drogue, Parafoil & Steering Servos',
      requirement:
        'Drogue parachute packed, main parafoil stowed, and both steering servos connected and free to move',
      status: isSim
        ? 'DROGUE / PARAFOIL / 2 SERVOS READY (SIM)'
        : checkedItems[5]
        ? 'VERIFIED BY OPERATOR (MANUAL)'
        : 'MANUAL VERIFICATION REQUIRED',
      pass: isSim ? true : Boolean(checkedItems[5]),
      isManualInLive: true,
    },
    {
      id: 6,
      title: 'Z-Axis Momentum Bias Wheel Assembly',
      requirement:
        'MT2204 2300KV motor & 63.4g brass flywheel spin test (12,000 RPM)',
      status: wheelStatusText,
      pass: isSim ? true : hasWheelTelemetry || Boolean(checkedItems[6]),
      isManualInLive: !hasWheelTelemetry,
    },
    {
      id: 7,
      title: '865.50MHz LoRa Primary Telemetry Link',
      requirement: 'Point-to-point telemetry packets actively received (Main: 865.50 MHz SF7, Sync 0x91)',
      status: p ? `ACTIVE (PKT #${p.packetNumber})` : 'NO PACKETS RECEIVED',
      pass: Boolean(p),
      isManualInLive: false,
    },
    {
      id: 8,
      title: 'Audio Beacon (>=92dB) & GSM Recovery Module',
      requirement:
        'Post-touchdown acoustic buzzer & SMS coordinate alert armed',
      status: isSim
        ? 'ARMED FOR TOUCHDOWN (SIM)'
        : checkedItems[8]
        ? 'VERIFIED BY OPERATOR (MANUAL)'
        : 'MANUAL VERIFICATION REQUIRED',
      pass: isSim ? true : Boolean(checkedItems[8]),
      isManualInLive: true,
    },
  ];

  const items: EvaluatedChecklistItem[] = rawItems.map((item) => {
    const isChecked = Boolean(checkedItems[item.id]);
    const itemOk = isChecked && item.pass;
    return {
      ...item,
      isChecked,
      itemOk,
    };
  });

  const allGo = items.every((item) => item.itemOk);
  return { items, allGo };
}

export const PreflightChecklistPanel: React.FC<PreflightChecklistPanelProps> = ({
  latestPacket,
  telemetrySource = 'SIMULATION',
  onStartLaunch,
}) => {
  const isSim = telemetrySource === 'SIMULATION';

  const [simCheckedItems, setSimCheckedItems] = useState<Record<number, boolean>>(
    () => getDefaultChecklistState('SIMULATION')
  );
  const [liveCheckedItems, setLiveCheckedItems] = useState<Record<number, boolean>>(
    () => getDefaultChecklistState('LIVE_SERIAL')
  );

  const activeCheckedItems = isSim ? simCheckedItems : liveCheckedItems;

  const toggleCheck = (id: number) => {
    if (isSim) {
      setSimCheckedItems((prev) => ({ ...prev, [id]: !prev[id] }));
    } else {
      setLiveCheckedItems((prev) => ({ ...prev, [id]: !prev[id] }));
    }
  };

  const { items: evaluatedItems, allGo } = evaluatePreflightChecklist(
    latestPacket,
    telemetrySource,
    activeCheckedItems
  );

  const itemIcons: Record<number, React.ReactNode> = {
    1: <Radio className="w-4 h-4 text-[var(--accent-cobalt)]" />,
    2: <Cpu className="w-4 h-4 text-[var(--accent-teal)]" />,
    3: <Battery className="w-4 h-4 text-[var(--status-nominal)]" />,
    4: <ClipboardCheck className="w-4 h-4 text-[var(--accent-cobalt)]" />,
    5: <ShieldCheck className="w-4 h-4 text-[var(--status-warning)]" />,
    6: <Cpu className="w-4 h-4 text-[var(--accent-teal)]" />,
    7: <Radio className="w-4 h-4 text-[var(--status-nominal)]" />,
    8: <Volume2 className="w-4 h-4 text-[var(--accent-cobalt)]" />,
  };

  return (
    <div className="ops-card p-3.5 flex flex-col gap-3 select-none">
      {/* Header */}
      <div className="flex justify-between items-center flex-wrap gap-2 border-b border-[var(--border-subtle)] pb-2.5">
        <div className="flex items-center gap-2">
          <ClipboardCheck className="w-4 h-4 text-[var(--accent-cobalt)]" />
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-primary)]">
              Pre-Flight Go / No-Go Readiness ({isSim ? 'SIMULATION' : 'LIVE SERIAL'})
            </h3>
            <p className="text-[11px] text-[var(--text-secondary)]">
              {isSim
                ? 'Automated telemetry verification + simulated hardware inspection'
                : 'Live telemetry verification + explicit operator sign-off for manual hardware checks'}
            </p>
          </div>
        </div>

        <div
          className={`px-2.5 py-1 font-mono-data font-bold text-[10px] uppercase border rounded-[var(--radius-xs)] flex items-center gap-1.5 ${
            allGo
              ? 'bg-[var(--status-nominal-bg)] text-[var(--status-nominal)] border-[var(--status-nominal)]/30'
              : 'bg-[var(--status-warning-bg)] text-[var(--status-warning)] border-[var(--status-warning)]/30'
          }`}
        >
          {allGo ? (
            <CheckCircle2 className="w-3.5 h-3.5" />
          ) : (
            <AlertOctagon className="w-3.5 h-3.5" />
          )}
          <span>{allGo ? 'ALL CHECKS GO' : 'VERIFY PENDING ITEMS'}</span>
        </div>
      </div>

      {/* Checklist Items */}
      <div className="grid grid-cols-1 gap-2 max-h-[340px] overflow-y-auto pr-0.5">
        {evaluatedItems.map((item) => {
          const { isChecked, itemOk } = item;
          return (
            <div
              key={item.id}
              onClick={() => toggleCheck(item.id)}
              className={`p-2.5 border rounded-[var(--radius-sm)] cursor-pointer transition-colors flex flex-col justify-between gap-1.5 ${
                itemOk
                  ? 'bg-[var(--bg-surface-2)]/70 border-[var(--border-subtle)] hover:border-[var(--status-nominal)]/50'
                  : 'bg-[var(--status-warning-bg)]/40 border-[var(--status-warning)]/30'
              }`}
            >
              <div className="flex justify-between items-start gap-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-primary)]">
                  {itemIcons[item.id]}
                  <span>
                    {item.id}. {item.title}
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => {}}
                  className="w-3.5 h-3.5 accent-[var(--accent-cobalt)] cursor-pointer mt-0.5"
                />
              </div>

              <div className="text-[11px] text-[var(--text-secondary)] leading-snug">
                {item.requirement}
              </div>

              <div className="flex justify-between items-center pt-1.5 border-t border-[var(--border-subtle)] font-mono-data text-[10px]">
                <span className="text-[var(--text-tertiary)]">TELEMETRY / CHECK:</span>
                <span
                  className={`font-bold ${
                    itemOk
                      ? 'text-[var(--status-nominal)]'
                      : 'text-[var(--status-warning)]'
                  }`}
                >
                  {item.status}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Simulated launch trigger: only rendered in Simulation mode (nothing in Live Serial) */}
      {isSim && (
        <div className="bg-[var(--bg-surface-2)] border border-[var(--border-subtle)] rounded-[var(--radius-sm)] p-2.5 flex justify-between items-center gap-2 flex-wrap">
          <div className="text-[11px] text-[var(--text-secondary)]">
            Initiate simulated 20s rocket boost launch phase to 1000m AGL
          </div>
          <button
            type="button"
            onClick={onStartLaunch}
            disabled={!allGo}
            className={`px-3.5 py-1.5 font-semibold uppercase flex items-center gap-1.5 text-xs rounded-[var(--radius-sm)] transition-colors ${
              allGo
                ? 'go-button cursor-pointer'
                : 'bg-[var(--bg-surface-3)] text-[var(--text-tertiary)] opacity-50 cursor-not-allowed'
            }`}
          >
            <Rocket className="w-3.5 h-3.5" />
            <span>Initiate Sim Launch</span>
          </button>
        </div>
      )}    </div>
  );
};
