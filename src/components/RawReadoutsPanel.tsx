import React from 'react';
import { ListFilter, Battery, Volume2, Radio, Activity, Compass, Clock } from 'lucide-react';
import { TelemetryPacket, TelemetrySource } from '../types';
import { convertGnssUtcToIst } from '../services/telemetryParser';

interface RawReadoutsPanelProps {
  latestPacket: TelemetryPacket | null;
  historyPackets?: TelemetryPacket[];
  telemetrySource?: TelemetrySource;
  isStale?: boolean;
}

const isValidNum = (val: unknown): val is number => typeof val === 'number' && Number.isFinite(val);

export const RawReadoutsPanel: React.FC<RawReadoutsPanelProps> = ({
  latestPacket,
  telemetrySource = 'SIMULATION',
  isStale = false,
}) => {
  const hasPacket = latestPacket !== null;
  const isSim = telemetrySource === 'SIMULATION';

  const altStr = isValidNum(latestPacket?.altitude) ? `${latestPacket.altitude.toFixed(1)} m` : 'UNAVAILABLE';
  const tempStr = isValidNum(latestPacket?.temperature) ? `${latestPacket.temperature.toFixed(1)}°C` : 'UNAVAILABLE';
  const presStr = isValidNum(latestPacket?.pressure) ? `${latestPacket.pressure.toFixed(2)} hPa` : 'UNAVAILABLE';
  const rawPaStr = isValidNum(latestPacket?.rawPressurePa) ? `${Math.round(latestPacket.rawPressurePa)} Pa` : null;
  const humStr = isValidNum(latestPacket?.humidity) ? `${latestPacket.humidity.toFixed(1)}% RH` : 'UNAVAILABLE';
  const rpmStr = isValidNum(latestPacket?.wheelRpm)
    ? `${Math.round(latestPacket.wheelRpm).toLocaleString()} RPM`
    : 'UNAVAILABLE';

  const voltStr = isValidNum(latestPacket?.batteryVoltage) ? `${latestPacket.batteryVoltage.toFixed(2)}V` : 'UNAVAILABLE';
  const socStr = isValidNum(latestPacket?.batterySoc) ? `${latestPacket.batterySoc.toFixed(0)}%` : null;
  const currStr = isValidNum(latestPacket?.currentDraw) ? `${latestPacket.currentDraw.toFixed(2)}A` : 'N/A';
  const pwrStr = isValidNum(latestPacket?.power) ? `${latestPacket.power.toFixed(1)}W` : 'N/A';

  const accelXStr = isValidNum(latestPacket?.accelX) ? latestPacket.accelX.toFixed(2) : '--';
  const accelYStr = isValidNum(latestPacket?.accelY) ? latestPacket.accelY.toFixed(2) : '--';
  const accelZStr = isValidNum(latestPacket?.accelZ) ? latestPacket.accelZ.toFixed(2) : '--';
  const hasAccel =
    isValidNum(latestPacket?.accelX) && isValidNum(latestPacket?.accelY) && isValidNum(latestPacket?.accelZ);

  const rollStr = isValidNum(latestPacket?.roll) ? `${latestPacket.roll.toFixed(2)}°` : '--';
  const pitchStr = isValidNum(latestPacket?.pitch) ? `${latestPacket.pitch.toFixed(2)}°` : '--';
  const spinStr = isValidNum(latestPacket?.spinRate) ? `${latestPacket.spinRate.toFixed(1)}°/s` : '--';

  const co2Str = isValidNum(latestPacket?.co2) ? `${latestPacket.co2.toFixed(1)} ppm` : 'N/A';
  const pm25Str = isValidNum(latestPacket?.pm2_5) ? `${latestPacket.pm2_5.toFixed(1)} µg/m³` : 'N/A';
  const uvStr = isValidNum(latestPacket?.uv) ? `${latestPacket.uv.toFixed(1)} Index` : 'N/A';

  const gnssUtcStr =
    hasPacket && typeof latestPacket?.timestampUtc === 'string' && latestPacket.timestampUtc.length > 0
      ? latestPacket.timestampUtc
      : null;
  const gnssIstStr =
    hasPacket && typeof latestPacket?.gnssTimeIst === 'string' && latestPacket.gnssTimeIst.length > 0
      ? latestPacket.gnssTimeIst
      : gnssUtcStr
      ? convertGnssUtcToIst(gnssUtcStr)
      : null;

  const hasBuzzerStatus = hasPacket && typeof latestPacket?.audioBeaconActive === 'boolean';
  const buzzerActive = hasBuzzerStatus && latestPacket!.audioBeaconActive === true;

  const hasGsmStatus = hasPacket && typeof latestPacket?.gsmModuleActive === 'boolean';
  const gsmActive = hasGsmStatus && latestPacket!.gsmModuleActive === true;

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
            !hasPacket
              ? 'bg-[var(--status-alert-bg)] text-[var(--status-alert)] border-[var(--status-alert)]/40 font-bold'
              : isStale && !isSim
              ? 'bg-[var(--status-warning-bg)] text-[var(--status-warning)] border-[var(--status-warning)]/40 font-bold'
              : isSim
              ? 'bg-[var(--bg-surface-2)] text-[var(--status-info)] border-[var(--border-subtle)]'
              : 'bg-[var(--status-nominal-bg)] text-[var(--status-nominal)] border-[var(--status-nominal)]/40 font-bold'
          }`}
        >
          {!hasPacket
            ? 'NO TELEMETRY'
            : isSim
            ? 'SIMULATED SENSORS'
            : isStale
            ? 'STALE SERIAL DATA'
            : 'LIVE SERIAL RX'}
        </span>
      </div>

      {/* Primary Sensor Readout Grid */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 font-mono-data text-[11px]">
        {/* Air Temp */}
        <div className="flex justify-between border-b border-[var(--border-subtle)] pb-1 items-center">
          <span className="text-[var(--text-secondary)]">TEMP:</span>
          <span
            className={`font-semibold tabular-nums ${
              isValidNum(latestPacket?.temperature) ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]'
            }`}
          >
            {tempStr}
          </span>
        </div>

        {/* Pressure (hPa + raw Pa tooltip) */}
        <div
          className="flex justify-between border-b border-[var(--border-subtle)] pb-1 items-center"
          title={rawPaStr ? `Raw Pressure: ${rawPaStr}` : 'Barometric Pressure'}
        >
          <span className="text-[var(--text-secondary)]">BARO PRES:</span>
          <span
            className={`font-semibold tabular-nums ${
              isValidNum(latestPacket?.pressure) ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]'
            }`}
          >
            {presStr}
          </span>
        </div>

        {/* Baro Altitude */}
        <div className="flex justify-between border-b border-[var(--border-subtle)] pb-1 items-center">
          <span className="text-[var(--text-secondary)]">ALTITUDE:</span>
          <span
            className={`font-semibold tabular-nums ${
              isValidNum(latestPacket?.altitude) ? 'text-[var(--action-amber)]' : 'text-[var(--text-tertiary)]'
            }`}
          >
            {altStr}
          </span>
        </div>

        {/* GNSS Time & Satellites */}
        <div className="flex justify-between border-b border-[var(--border-subtle)] pb-1 items-center">
          <span className="text-[var(--text-secondary)]">GNSS SATS:</span>
          <span
            className={`font-semibold tabular-nums ${
              isValidNum(latestPacket?.gpsSats)
                ? latestPacket!.gpsValid
                  ? 'text-[var(--status-nominal)]'
                  : 'text-[var(--status-warning)]'
                : 'text-[var(--text-tertiary)]'
            }`}
          >
            {isValidNum(latestPacket?.gpsSats) ? `${latestPacket!.gpsSats} (${latestPacket!.gpsFixType})` : 'UNAVAILABLE'}
          </span>
        </div>

        {/* Humidity */}
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

        {/* GNSS Clock (Verified UBX-NAV-PVT UTC & Converted IST — Time-of-Day Only, No Date) */}
        <div
          className="col-span-2 bg-[var(--bg-base)] px-2 py-1.5 border border-[var(--border-subtle)] rounded-[var(--radius-xs)] text-[10px] space-y-1"
          title="Transmitted NEO-M9N UBX-NAV-PVT time (HH:MM:SS). Time-of-day only; packet contains no calendar date."
        >
          <div className="flex justify-between items-center">
            <span className="text-[var(--text-secondary)] flex items-center gap-1 font-semibold">
              <Clock className="w-3 h-3 text-[var(--action-amber)]" />
              GNSS TIME:
            </span>
            <span className="text-[9px] text-[var(--text-tertiary)] uppercase">
              TIME-OF-DAY ONLY (NO DATE)
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 border-t border-[var(--border-muted)] pt-1">
            <div className="flex justify-between items-center">
              <span className="text-[var(--text-tertiary)]">GNSS UTC:</span>
              <span
                className={`font-bold tabular-nums ${
                  gnssUtcStr ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]'
                }`}
              >
                {gnssUtcStr ?? 'UNAVAILABLE'}
              </span>
            </div>
            <div className="flex justify-between items-center border-l border-[var(--border-muted)] pl-2">
              <span className="text-[var(--text-tertiary)]">IST (+05:30):</span>
              <span
                className={`font-bold tabular-nums ${
                  gnssIstStr ? 'text-[var(--action-amber)]' : 'text-[var(--text-tertiary)]'
                }`}
              >
                {gnssIstStr ?? 'UNAVAILABLE'}
              </span>
            </div>
          </div>
        </div>

        {/* IMU Accel X/Y/Z & Roll/Pitch/Spin */}
        <div className="col-span-2 bg-[var(--bg-base)] px-2 py-1.5 border border-[var(--border-subtle)] rounded-[var(--radius-xs)] text-[10px] space-y-1">
          <div className="flex justify-between items-center">
            <span className="text-[var(--text-secondary)] flex items-center gap-1">
              <Compass className="w-3 h-3 text-[var(--status-info)]" />
              ACCEL (X/Y/Z):
            </span>
            <span className={`font-bold tabular-nums ${hasAccel ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]'}`}>
              {hasAccel ? `${accelXStr} / ${accelYStr} / ${accelZStr}` : 'UNAVAILABLE'}
            </span>
          </div>
          <div className="flex justify-between items-center border-t border-[var(--border-muted)] pt-1">
            <span className="text-[var(--text-secondary)]">R / P / SPIN:</span>
            <span
              className={`font-bold tabular-nums ${
                isValidNum(latestPacket?.roll) ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]'
              }`}
            >
              {isValidNum(latestPacket?.roll) ? `${rollStr} / ${pitchStr} / ${spinStr}` : 'UNAVAILABLE'}
            </span>
          </div>
        </div>

        {/* 2S Battery Pack */}
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
            {socStr && <span className="text-[10px] text-[var(--text-secondary)] tabular-nums">({socStr})</span>}
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
            <span className="text-[9px] text-[var(--text-tertiary)]">
              {isSim ? 'SIMULATED' : 'NOT IN CSV'}
            </span>
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
                  !hasBuzzerStatus
                    ? 'text-[var(--text-tertiary)]'
                    : buzzerActive
                    ? 'text-[var(--status-nominal)]'
                    : 'text-[var(--text-secondary)]'
                }
              >
                {!hasBuzzerStatus ? 'UNAVAILABLE' : buzzerActive ? 'BUZZING' : 'STANDBY'}
              </strong>
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Radio className={`w-3.5 h-3.5 ${gsmActive ? 'text-[var(--status-nominal)]' : 'text-[var(--text-tertiary)]'}`} />
            <span className="text-[var(--text-secondary)]">
              GSM SMS:{' '}
              <strong
                className={
                  !hasGsmStatus
                    ? 'text-[var(--text-tertiary)]'
                    : gsmActive
                    ? 'text-[var(--status-nominal)]'
                    : 'text-[var(--text-secondary)]'
                }
              >
                {!hasGsmStatus ? 'UNAVAILABLE' : gsmActive ? 'TRANSMITTING' : 'READY'}
              </strong>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
