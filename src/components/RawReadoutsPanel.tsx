import React from 'react';
import { ListFilter, Battery, Volume2, Radio, Activity } from 'lucide-react';
import { TelemetryPacket } from '../types';

interface RawReadoutsPanelProps {
  latestPacket: TelemetryPacket | null;
  historyPackets?: TelemetryPacket[];
}

const isValidNum = (val: unknown): val is number => typeof val === 'number' && Number.isFinite(val);

export const RawReadoutsPanel: React.FC<RawReadoutsPanelProps> = ({ latestPacket }) => {
  const hasPacket = latestPacket !== null;

  const tempStr = isValidNum(latestPacket?.temperature) ? `${latestPacket.temperature.toFixed(1)}°C` : '--';
  const presStr = isValidNum(latestPacket?.pressure) ? `${latestPacket.pressure.toFixed(1)} hPa` : '--';
  const humStr = isValidNum(latestPacket?.humidity) ? `${latestPacket.humidity.toFixed(1)}% RH` : '--';
  const rpmStr = isValidNum(latestPacket?.wheelRpm)
    ? `${Math.round(latestPacket.wheelRpm).toLocaleString()} RPM`
    : '--';

  const voltStr = isValidNum(latestPacket?.batteryVoltage) ? `${latestPacket.batteryVoltage.toFixed(2)}V` : '--';
  const socStr = isValidNum(latestPacket?.batterySoc) ? `${latestPacket.batterySoc.toFixed(0)}%` : '--';
  const currStr = isValidNum(latestPacket?.currentDraw) ? `${latestPacket.currentDraw.toFixed(2)}A` : '--';
  const pwrStr = isValidNum(latestPacket?.power) ? `${latestPacket.power.toFixed(1)}W` : '--';

  const co2Str = isValidNum(latestPacket?.co2) ? `${latestPacket.co2.toFixed(1)} ppm` : '--';
  const pm25Str = isValidNum(latestPacket?.pm2_5) ? `${latestPacket.pm2_5.toFixed(1)} µg/m³` : '--';
  const uvStr = isValidNum(latestPacket?.uv) ? `${latestPacket.uv.toFixed(1)} Index` : '--';

  const buzzerActive = hasPacket && Boolean(latestPacket?.audioBeaconActive);
  const gsmActive = hasPacket && Boolean(latestPacket?.gsmModuleActive);

  return (
    <div className="telemetry-panel panel-gray-accent p-2.5 select-none flex flex-col gap-2">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-1.5">
          <ListFilter className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
          <span className="font-mono-data text-[11px] font-bold text-[var(--text-primary)] uppercase tracking-wider">
            SENSOR READOUTS
          </span>
        </div>
        <span
          className={`font-mono-data text-[9px] px-1.5 py-0.5 border rounded-[var(--radius-xs)] uppercase ${
            hasPacket
              ? 'bg-[var(--bg-surface-2)] text-[var(--status-info)] border-[var(--border-subtle)]'
              : 'bg-[var(--status-alert-bg)] text-[var(--status-alert)] border-[var(--status-alert)]/40 font-bold'
          }`}
        >
          {hasPacket ? 'SIMULATED SENSORS' : 'NO TELEMETRY'}
        </span>
      </div>

      {/* Primary Sensor Readout Grid */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 font-mono-data text-[11px]">
        {/* Air Temp (SHT40) */}
        <div className="flex justify-between border-b border-[var(--border-subtle)] pb-1 items-center">
          <span className="text-[var(--text-secondary)]">TEMP (SHT40):</span>
          <span
            className={`font-semibold tabular-nums ${
              isValidNum(latestPacket?.temperature) ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]'
            }`}
          >
            {tempStr}
          </span>
        </div>

        {/* Pressure (MS5611) */}
        <div className="flex justify-between border-b border-[var(--border-subtle)] pb-1 items-center">
          <span className="text-[var(--text-secondary)]">BARO PRES:</span>
          <span
            className={`font-semibold tabular-nums ${
              isValidNum(latestPacket?.pressure) ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]'
            }`}
          >
            {presStr}
          </span>
        </div>

        {/* Humidity (SHT40) */}
        <div className="flex justify-between border-b border-[var(--border-subtle)] pb-1 items-center">
          <span className="text-[var(--text-secondary)]">HUMIDITY:</span>
          <span
            className={`font-semibold tabular-nums ${
              isValidNum(latestPacket?.humidity) ? 'text-[var(--status-info)]' : 'text-[var(--text-tertiary)]'
            }`}
          >
            {humStr}
          </span>
        </div>

        {/* Momentum Wheel RPM */}
        <div className="flex justify-between border-b border-[var(--border-subtle)] pb-1 items-center">
          <span className="text-[var(--text-secondary)]">DCS FLYWHEEL:</span>
          <span
            className={`font-bold tabular-nums ${
              isValidNum(latestPacket?.wheelRpm) ? 'text-[var(--status-nominal)]' : 'text-[var(--text-tertiary)]'
            }`}
          >
            {rpmStr}
          </span>
        </div>

        {/* 2S Molicel Battery Pack */}
        <div className="col-span-2 flex justify-between items-center bg-[var(--bg-base)] px-2 py-1.5 my-0.5 border border-[var(--border-subtle)] border-l-2 border-l-[var(--status-nominal)] rounded-[var(--radius-xs)]">
          <div className="flex items-center gap-1.5">
            <Battery className="w-3.5 h-3.5 text-[var(--status-nominal)] shrink-0" />
            <span className="text-[var(--text-secondary)]">2S BATT:</span>
            <span
              className={`font-bold text-xs tabular-nums ${
                isValidNum(latestPacket?.batteryVoltage) ? 'text-[var(--status-nominal)]' : 'text-[var(--text-tertiary)]'
              }`}
            >
              {voltStr}
            </span>
            <span className="text-[10px] text-[var(--text-secondary)] tabular-nums">({socStr})</span>
          </div>

          <div className="flex items-center gap-2 text-[10px]">
            <span className="text-[var(--text-secondary)]">
              I:{' '}
              <strong
                className={`tabular-nums ${
                  isValidNum(latestPacket?.currentDraw) ? 'text-[var(--action-amber)]' : 'text-[var(--text-tertiary)]'
                }`}
              >
                {currStr}
              </strong>
            </span>
            <span className="text-[var(--text-secondary)]">
              P:{' '}
              <strong
                className={`tabular-nums ${
                  isValidNum(latestPacket?.power) ? 'text-[var(--action-amber)]' : 'text-[var(--text-tertiary)]'
                }`}
              >
                {pwrStr}
              </strong>
            </span>
          </div>
        </div>

        {/* Environmental Bonus Sensors Section */}
        <div className="col-span-2 pt-0.5">
          <div className="text-[10px] text-[var(--text-secondary)] font-semibold uppercase mb-1 flex items-center justify-between">
            <span className="flex items-center gap-1">
              <Activity className="w-3 h-3 text-[var(--action-amber)]" />
              ENVIRONMENTAL SENSORS
            </span>
            <span className="text-[9px] text-[var(--text-tertiary)]">SIMULATED</span>
          </div>
          <div className="grid grid-cols-3 gap-1.5 bg-[var(--bg-base)] p-1.5 border border-[var(--border-subtle)] rounded-[var(--radius-xs)] text-[10px]">
            <div>
              <span className="text-[var(--text-tertiary)] block text-[9px]">CO₂ (SCD40)</span>
              <span
                className={`font-bold tabular-nums ${
                  isValidNum(latestPacket?.co2) ? 'text-[var(--status-nominal)]' : 'text-[var(--text-tertiary)]'
                }`}
              >
                {co2Str}
              </span>
            </div>
            <div>
              <span className="text-[var(--text-tertiary)] block text-[9px]">PM2.5 (SPS30)</span>
              <span
                className={`font-bold tabular-nums ${
                  isValidNum(latestPacket?.pm2_5) ? 'text-[var(--status-nominal)]' : 'text-[var(--text-tertiary)]'
                }`}
              >
                {pm25Str}
              </span>
            </div>
            <div>
              <span className="text-[var(--text-tertiary)] block text-[9px]">UV (LTR390)</span>
              <span
                className={`font-bold tabular-nums ${
                  isValidNum(latestPacket?.uv) ? 'text-[var(--action-amber)]' : 'text-[var(--text-tertiary)]'
                }`}
              >
                {uvStr}
              </span>
            </div>
          </div>
        </div>

        {/* Recovery Subsystem Status */}
        <div className="col-span-2 flex justify-between items-center pt-1.5 border-t border-[var(--border-subtle)] mt-0.5 text-[10px]">
          <div className="flex items-center gap-1">
            <Volume2 className={`w-3.5 h-3.5 ${buzzerActive ? 'text-[var(--status-nominal)]' : 'text-[var(--text-tertiary)]'}`} />
            <span className="text-[var(--text-secondary)]">
              92dB BUZZER:{' '}
              <strong
                className={
                  !hasPacket
                    ? 'text-[var(--text-tertiary)]'
                    : buzzerActive
                    ? 'text-[var(--status-nominal)]'
                    : 'text-[var(--text-secondary)]'
                }
              >
                {!hasPacket ? 'UNAVAILABLE' : buzzerActive ? 'BUZZING' : 'STANDBY'}
              </strong>
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Radio className={`w-3.5 h-3.5 ${gsmActive ? 'text-[var(--status-nominal)]' : 'text-[var(--text-tertiary)]'}`} />
            <span className="text-[var(--text-secondary)]">
              GSM SMS:{' '}
              <strong
                className={
                  !hasPacket
                    ? 'text-[var(--text-tertiary)]'
                    : gsmActive
                    ? 'text-[var(--status-nominal)]'
                    : 'text-[var(--text-secondary)]'
                }
              >
                {!hasPacket ? 'UNAVAILABLE' : gsmActive ? 'TRANSMITTING' : 'READY'}
              </strong>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
