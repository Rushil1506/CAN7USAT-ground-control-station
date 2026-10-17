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

export const PreflightChecklistPanel: React.FC<PreflightChecklistPanelProps> = ({
  latestPacket,
  telemetrySource = 'SIMULATION',
  onStartLaunch,
}) => {
  const p = latestPacket;
  const isSim = telemetrySource === 'SIMULATION';

  const [checkedItems, setCheckedItems] = useState<Record<number, boolean>>({
    1: true,
    2: true,
    3: true,
    4: true,
    5: true,
    6: true,
    7: true,
    8: true,
  });

  // Never use `||` fallbacks that turn 0 readings into nominal values
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
  const wheelStatusText = hasWheelTelemetry
    ? `${Math.round(p!.wheelRpm!).toLocaleString()} RPM`
    : isSim
    ? 'AWAITING SIM'
    : 'NOT IN LIVE CSV';

  const checklistSpecs = [
    {
      id: 1,
      title: 'GNSS 3D Fix & Satellite Lock',
      requirement:
        'NEO-M9N GNSS Receiver >= 4 Satellites with valid non-zero coordinates',
      status: gpsStatusText,
      pass: hasGpsLock,
      icon: <Radio className="w-4 h-4 text-[var(--accent-cobalt)]" />,
    },
    {
      id: 2,
      title: 'MS5611 Barometer & GY-SHT40 Calibration',
      requirement:
        'Non-zero atmospheric pressure (> 100 hPa) & air temperature verified',
      status: baroStatusText,
      pass: hasValidBaro,
      icon: <Cpu className="w-4 h-4 text-[var(--accent-teal)]" />,
    },
    {
      id: 3,
      title: '2S Molicel INR-18650-P30B Battery Pack',
      requirement: 'Pack Voltage >= 7.0V (Capacity Margin > 1700 mAh)',
      status: battStatusText,
      pass: hasValidBatt,
      icon: <Battery className="w-4 h-4 text-[var(--status-nominal)]" />,
    },
    {
      id: 4,
      title: 'Onboard MicroSD Card Data Logging',
      requirement: 'Teensy 4.1 microSD slot mounted and writable for flight backup',
      status: isSim ? 'MOUNTED (SIMULATED)' : 'MANUAL VERIFICATION REQUIRED',
      pass: true,
      icon: <ClipboardCheck className="w-4 h-4 text-[var(--accent-cobalt)]" />,
    },
    {
      id: 5,
      title: 'Parachute Reefing & Dual Burnwire Circuits',
      requirement:
        'Stage 1 Reefed Parachute line secured & MOSFET burnwires armed',
      status: isSim
        ? 'DUAL MOSFET ARMED (SIM)'
        : 'MANUAL VERIFICATION REQUIRED',
      pass: true,
      icon: <ShieldCheck className="w-4 h-4 text-[var(--status-warning)]" />,
    },
    {
      id: 6,
      title: 'Z-Axis Momentum Bias Wheel Assembly',
      requirement:
        'MT2204 2300KV motor & 63.4g brass flywheel spin test (12,000 RPM)',
      status: wheelStatusText,
      pass: isSim ? true : hasWheelTelemetry,
      icon: <Cpu className="w-4 h-4 text-[var(--accent-teal)]" />,
    },
    {
      id: 7,
      title: '865MHz LoRa Primary Telemetry Link',
      requirement: 'Point-to-point telemetry packets actively received',
      status: p ? `ACTIVE (PKT #${p.packetNumber})` : 'NO PACKETS RECEIVED',
      pass: Boolean(p),
      icon: <Radio className="w-4 h-4 text-[var(--status-nominal)]" />,
    },
    {
      id: 8,
      title: 'Audio Beacon (>=92dB) & GSM Recovery Module',
      requirement:
        'Post-touchdown acoustic buzzer & SMS coordinate alert armed',
      status: isSim
        ? 'ARMED FOR TOUCHDOWN (SIM)'
        : 'MANUAL VERIFICATION REQUIRED',
      pass: true,
      icon: <Volume2 className="w-4 h-4 text-[var(--accent-cobalt)]" />,
    },
  ];

  const toggleCheck = (id: number) => {
    setCheckedItems((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const allGo = checklistSpecs.every(
    (item) => checkedItems[item.id] && item.pass
  );

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
              Automated telemetry verification + manual hardware inspection
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
        {checklistSpecs.map((item) => {
          const isChecked = !!checkedItems[item.id];
          const itemOk = isChecked && item.pass;
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
                  {item.icon}
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

      {/* Launch Trigger Button (Simulation Only) */}
      <div className="bg-[var(--bg-surface-2)] border border-[var(--border-subtle)] rounded-[var(--radius-sm)] p-2.5 flex justify-between items-center gap-2 flex-wrap">
        <div className="text-[11px] text-[var(--text-secondary)]">
          {isSim
            ? 'Initiate simulated 20s rocket boost launch phase to 1000m AGL'
            : 'Simulated launch trigger disabled in Live Serial receive-only mode'}
        </div>
        <button
          type="button"
          onClick={() => {
            if (isSim) onStartLaunch();
          }}
          disabled={!isSim || !allGo}
          className={`px-3.5 py-1.5 font-semibold uppercase flex items-center gap-1.5 text-xs rounded-[var(--radius-sm)] transition-colors ${
            isSim && allGo
              ? 'go-button cursor-pointer'
              : 'bg-[var(--bg-surface-3)] text-[var(--text-tertiary)] opacity-50 cursor-not-allowed'
          }`}
        >
          <Rocket className="w-3.5 h-3.5" />
          <span>{isSim ? 'Initiate Sim Launch' : 'Sim Launch Disabled'}</span>
        </button>
      </div>
    </div>
  );
};
