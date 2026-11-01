import React from 'react';
import {
  Activity,
  Compass,
  Gauge,
  Zap,
} from 'lucide-react';
import { TelemetryPacket, TelemetrySource } from '../types';
import {
  DEFAULT_OPTIONAL_TELEMETRY_SETTINGS,
  OptionalTelemetrySettings,
} from '../services/optionalTelemetrySettings';

interface RawReadoutsPanelProps {
  latestPacket: TelemetryPacket | null;
  historyPackets?: TelemetryPacket[];
  telemetrySource?: TelemetrySource;
  isStale?: boolean;
  optionalTelemetrySettings?: OptionalTelemetrySettings;
}

const fmtNum = (
  val: number | null | undefined,
  decimals: number = 2
): string => {
  if (val === null || val === undefined || !Number.isFinite(val)) {
    return 'UNAVAILABLE';
  }
  return val.toFixed(decimals);
};

const fmtInt = (val: number | null | undefined): string => {
  if (val === null || val === undefined || !Number.isFinite(val)) {
    return 'UNAVAILABLE';
  }
  return Math.round(val).toString();
};

const fmtSigned = (
  val: number | null | undefined,
  decimals: number = 1
): string => {
  if (val === null || val === undefined || !Number.isFinite(val)) {
    return 'UNAVAILABLE';
  }
  const s = val.toFixed(decimals);
  return val > 0 ? `+${s}` : s;
};

const renderReadoutLabel = (label: string): React.ReactNode => {
  const parenIdx = label.indexOf('(');
  if (parenIdx <= 0) {
    return label;
  }
  const primaryText = label.slice(0, parenIdx).trim();
  const identifierText = label.slice(parenIdx).trim();
  return (
    <>
      <span>{primaryText}</span>{' '}
      <span className="inline-block font-mono-data text-[10px] text-[var(--text-tertiary)] font-normal break-all sm:break-normal">
        {identifierText}
      </span>
    </>
  );
};

export const RawReadoutsPanel: React.FC<RawReadoutsPanelProps> = ({
  latestPacket,
  telemetrySource = 'SIMULATION',
  optionalTelemetrySettings = DEFAULT_OPTIONAL_TELEMETRY_SETTINGS,
}) => {
  const p = latestPacket;
  const isSim = telemetrySource === 'SIMULATION';

  const hasValidGps = Boolean(
    p &&
      p.gpsValid &&
      typeof p.latitude === 'number' &&
      typeof p.longitude === 'number'
  );

  // In 24-field CAN7USAT_FSW packets, FLYWHEEL_RPM is always transmitted in live serial
  const showWheelRpm =
    (!isSim && p !== null && typeof p.wheelRpm === 'number' && Number.isFinite(p.wheelRpm)) ||
    optionalTelemetrySettings.enableWheelRpm;

  const readoutGroups = [
    {
      category: 'Flight Dynamics & Baro (MS5611)',
      icon: <Gauge className="w-3.5 h-3.5 text-[var(--accent-cobalt)] shrink-0" />,
      items: [
        {
          label: 'Altitude (BARO_ALT_M)',
          value: p ? fmtNum(p.altitude, 2) : 'AWAITING',
          unit: 'm',
          highlight: true,
        },
        {
          label: 'Descent / Ascent Rate',
          value: p ? fmtNum(p.velocity, 1) : 'AWAITING',
          unit: 'm/s',
          highlight: true,
        },
        {
          label: 'Total Acceleration',
          value: p ? fmtNum(p.acceleration, 2) : 'AWAITING',
          unit: 'G',
          highlight: false,
        },
        {
          label: 'Accel X / Y / Z (MPS2)',
          value: p
            ? p.accelX !== null && p.accelY !== null && p.accelZ !== null
              ? `${p.accelX.toFixed(2)} / ${p.accelY.toFixed(2)} / ${p.accelZ.toFixed(2)}`
              : 'UNAVAILABLE'
            : 'AWAITING',
          unit: isSim ? 'G' : 'm/s²',
          highlight: false,
        },
        {
          label: 'Baro Pressure [Measured] (PRESSURE_PA)',
          value: p ? fmtNum(p.pressure, 2) : 'AWAITING',
          unit: 'hPa',
          highlight: false,
        },
        {
          label: 'Baro Temp [Measured] (BARO_TEMP_C)',
          value: p ? fmtNum(p.temperature, 2) : 'AWAITING',
          unit: '°C',
          highlight: false,
        },
      ],
    },
    {
      category: 'Orientation, IMU & Actuators (MPU6050 + FSW)',
      icon: <Compass className="w-3.5 h-3.5 text-[var(--accent-teal)] shrink-0" />,
      items: [
        {
          label: 'Pitch [Accel-Derived] (PITCH_DEG)',
          value: p && p.pitch !== null ? `${fmtSigned(p.pitch, 1)}°` : 'AWAITING',
          unit: 'deg',
          highlight: false,
        },
        {
          label: 'Roll [Accel-Derived] (ROLL_DEG)',
          value: p && p.roll !== null ? `${fmtSigned(p.roll, 1)}°` : 'AWAITING',
          unit: 'deg',
          highlight: false,
        },
        {
          label: 'Yaw [Gyro Dead-Reckoning] (YAW_DEG)',
          value: p && p.yaw !== null ? `${p.yaw.toFixed(1)}°` : 'AWAITING',
          unit: 'deg',
          highlight: true,
        },
        {
          label: 'Gyro Spin Rate [Measured] (GYRO_SPIN_RATE)',
          value: p ? fmtNum(p.spinRate, 2) : 'AWAITING',
          unit: 'deg/s',
          highlight: true,
        },
        {
          label: 'Flywheel [Commanded ESC] (FLYWHEEL_RPM)',
          value: !showWheelRpm
            ? 'DISABLED'
            : p
            ? `${fmtInt(p.wheelRpm)} (CMD)`
            : 'AWAITING',
          unit: 'RPM',
          highlight: showWheelRpm,
        },
        {
          label: 'Brake Servos [Commanded] (L / R)',
          value: p
            ? typeof p.leftBrakeCmd === 'number' && typeof p.rightBrakeCmd === 'number'
              ? `${(p.leftBrakeCmd * 100).toFixed(0)}% / ${(p.rightBrakeCmd * 100).toFixed(0)}%`
              : typeof p.leftServoDeg === 'number' && typeof p.rightServoDeg === 'number'
              ? `${p.leftServoDeg.toFixed(1)}° / ${p.rightServoDeg.toFixed(1)}°`
              : 'STANDBY'
            : 'AWAITING',
          unit: 'Pins 2 & 3',
          highlight: false,
        },
        {
          label: 'MOSFET Triggers [Commanded] (BW / BZ)',
          value: p
            ? typeof p.burnwireActive === 'boolean' && typeof p.buzzerMosfet === 'boolean'
              ? `BW:${p.burnwireActive ? 'ON' : 'OFF'} | BZ:${p.buzzerMosfet ? 'ON' : 'OFF'}`
              : 'STANDBY'
            : 'AWAITING',
          unit: 'Pins 4 & 5',
          highlight: Boolean(p?.burnwireActive || p?.buzzerMosfet),
        },
      ],
    },
    {
      category: 'GNSS (u-blox NEO-M9N) & 2S Power Subsystem',
      icon: <Zap className="w-3.5 h-3.5 text-[var(--status-warning)] shrink-0" />,
      items: [
        {
          label: 'GNSS Latitude (LAT_DEG)',
          value: p
            ? hasValidGps
              ? `${p.latitude!.toFixed(7)}° N`
              : 'INVALID / NO FIX'
            : 'AWAITING',
          unit: '',
          highlight: false,
        },
        {
          label: 'GNSS Longitude (LON_DEG)',
          value: p
            ? hasValidGps
              ? `${p.longitude!.toFixed(7)}° E`
              : 'INVALID / NO FIX'
            : 'AWAITING',
          unit: '',
          highlight: false,
        },
        {
          label: 'GNSS Alt (GPS_ALT_MSL_M)',
          value: p
            ? hasValidGps && p.gpsAltitude !== null
              ? fmtNum(p.gpsAltitude, 2)
              : 'INVALID / NO FIX'
            : 'AWAITING',
          unit: 'm AMSL',
          highlight: false,
        },
        {
          label: 'Satellites (SATELLITES)',
          value: p
            ? p.gpsSats !== null
              ? `${p.gpsSats} (${p.gpsFixType})`
              : 'UNAVAILABLE'
            : 'AWAITING',
          unit: 'SVs',
          highlight: false,
        },
        {
          label: '2S Battery [Measured A0] (BATTERY_V)',
          value: !optionalTelemetrySettings.enableBatteryVoltage
            ? 'DISABLED'
            : p
            ? fmtNum(p.batteryVoltage, 2)
            : 'AWAITING',
          unit: 'V',
          highlight: optionalTelemetrySettings.enableBatteryVoltage,
        },
        {
          label: 'GNSS UTC (GPS_TIME_UTC)',
          value: p ? p.timestampUtc || 'UNAVAILABLE' : 'AWAITING',
          unit: p?.timestampUtc === 'UNAVAILABLE' ? 'NO PVT' : 'UTC',
          highlight: false,
        },
        {
          label: 'GNSS IST Time (+05:30)',
          value: p ? p.gnssTimeIst ?? 'UNAVAILABLE' : 'AWAITING',
          unit: p?.gnssTimeIst ? 'IST' : '',
          highlight: true,
        },
        {
          label: 'Packet # / Mission Time',
          value: p ? `#${p.packetNumber} (${p.missionTimeSeconds}s)` : 'AWAITING',
          unit: p?.packetFormat ?? '',
          highlight: false,
        },
      ],
    },
  ];

  return (
    <div
      data-testid="raw-readouts-panel"
      className="ops-card raw-readouts-container p-3 sm:p-4 select-none"
    >
      <div className="flex justify-between items-start border-b border-[var(--border-subtle)] pb-2.5 mb-3 flex-wrap gap-2 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <Activity className="w-4 h-4 text-[var(--accent-cobalt)] shrink-0" />
          <span className="text-xs font-bold uppercase tracking-wider text-[var(--text-primary)] leading-snug break-words">
            Complete Subsystem &amp; Sensor Readout Matrix
          </span>
        </div>
        <div className="flex items-center gap-x-3 gap-y-1 text-[11px] font-mono-data text-[var(--text-secondary)] flex-wrap min-w-0">
          <span className="min-w-0 break-words">
            SOURCE:{' '}
            <strong
              className={
                isSim
                  ? 'text-[var(--accent-cobalt)]'
                  : 'text-[var(--accent-teal)]'
              }
            >
              {isSim
                ? 'SIMULATION'
                : `LIVE USB-SERIAL (${p?.packetFormat ?? '24-FIELD KV / CSV'})`}
            </strong>
          </span>
          <span className="min-w-0 break-all sm:break-normal">
            TEAM ID:{' '}
            <strong className="text-[var(--text-primary)]">
              {p ? p.teamId : 'NONE'}
            </strong>
          </span>
          <span className="shrink-0">
            GNSS UTC:{' '}
            <strong className="text-[var(--text-primary)]">
              {p ? p.timestampUtc : 'NONE'}
            </strong>
          </span>
          <span className="shrink-0">
            GNSS IST:{' '}
            <strong className="text-[var(--accent-cobalt)]">
              {p ? p.gnssTimeIst ?? 'UNAVAILABLE' : 'NONE'}
            </strong>
          </span>
        </div>
      </div>

      <div data-testid="raw-readouts-grid" className="raw-readouts-grid">
        {readoutGroups.map((group) => (
          <div
            key={group.category}
            data-testid="raw-readout-subsystem-card"
            className="raw-readout-card bg-[var(--bg-surface-2)] border border-[var(--border-subtle)] p-2.5 sm:p-3 flex flex-col justify-between rounded-[var(--radius-md)]"
          >
            <div className="flex items-start gap-2 border-b border-[var(--border-subtle)] pb-2 mb-2 min-w-0">
              <span className="mt-0.5 shrink-0">{group.icon}</span>
              <span
                data-testid="raw-readout-category-heading"
                className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-primary)] leading-snug break-words min-w-0"
              >
                {group.category}
              </span>
            </div>

            <div className="space-y-1.5 min-w-0">
              {group.items.map((item) => {
                const isUnavailable =
                  item.value === 'UNAVAILABLE' ||
                  item.value === 'AWAITING' ||
                  item.value === 'DISABLED' ||
                  item.value === 'INVALID / NO FIX';
                return (
                  <div
                    key={item.label}
                    data-testid="raw-readout-row"
                    className="raw-readout-row text-xs py-1.5 px-2.5 bg-[var(--bg-surface-1)] border border-[var(--border-subtle)] rounded-[var(--radius-xs)]"
                  >
                    <span
                      data-testid="raw-readout-label"
                      className="raw-readout-label text-[var(--text-secondary)] text-[11px] font-medium"
                    >
                      {renderReadoutLabel(item.label)}
                    </span>
                    <span
                      data-testid="raw-readout-value"
                      className={`raw-readout-value font-mono-data font-bold tabular-nums text-[11px] ${
                        isUnavailable
                          ? 'text-[var(--text-tertiary)] font-normal'
                          : item.highlight
                          ? 'text-[var(--accent-cobalt)]'
                          : 'text-[var(--text-primary)]'
                      }`}
                    >
                      <span>{item.value}</span>
                      {!isUnavailable && item.unit && (
                        <span className="ml-1 text-[10px] font-normal text-[var(--text-secondary)]">
                          {item.unit}
                        </span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
