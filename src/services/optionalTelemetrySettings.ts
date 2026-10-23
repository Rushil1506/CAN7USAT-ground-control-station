/**
 * CAN-7USAT Ground Control Station — Optional Telemetry Settings
 * Team Parikshit (Team 017 | 2026-IN-SPACe-CAN-7USAT-017)
 *
 * Configurable enable/disable settings for optional payload sensors:
 * 1. SPS30 particulate sensor (pm2_5)
 * 2. LTR390 UV sensor (uv)
 * 3. DCS Momentum wheel RPM (wheelRpm)
 * 4. 2S Battery Pack voltage divider (batteryVoltage)
 *
 * Settings are persisted to browser localStorage across restarts.
 * When disabled, displays clearly indicate DISABLED without fabricating
 * simulated or zero values.
 */

import { TelemetryPacket } from '../types';
import { StorageLike } from './overviewPreferences';

export const OPTIONAL_TELEMETRY_STORAGE_KEY = 'cansat_optional_telemetry_settings';

export interface OptionalTelemetrySettings {
  /** SPS30 particulate matter sensor (PM2.5 in µg/m³) via I2C */
  enableSps30: boolean;
  /** LTR390 ambient ultraviolet radiation index sensor via I2C */
  enableUv: boolean;
  /** Z-axis reaction wheel BLDC motor speed in RPM */
  enableWheelRpm: boolean;
  /** 2S Li-ion battery pack voltage divider monitored via ADC */
  enableBatteryVoltage: boolean;
}

export const DEFAULT_OPTIONAL_TELEMETRY_SETTINGS: OptionalTelemetrySettings = {
  enableSps30: false,       // Environmental bonus sensor (uninstalled on flat-sat breadboard)
  enableUv: false,          // Environmental bonus sensor (uninstalled on flat-sat breadboard)
  enableWheelRpm: false,    // DCS momentum wheel (uninstalled on flat-sat breadboard)
  enableBatteryVoltage: true, // Battery voltage divider (installed when battery is connected)
};

export interface OptionalFieldDescriptor {
  key: keyof OptionalTelemetrySettings;
  packetField: keyof TelemetryPacket;
  label: string;
  hardwareName: string;
  busInterface: string;
  unit: string;
  description: string;
  flatSatStatus: 'INSTALLED' | 'UNINSTALLED' | 'OPTIONAL';
}

export const OPTIONAL_TELEMETRY_FIELDS: OptionalFieldDescriptor[] = [
  {
    key: 'enableBatteryVoltage',
    packetField: 'batteryVoltage',
    label: '2S Battery Voltage',
    hardwareName: 'Resistor Voltage Divider',
    busInterface: 'Teensy ADC (A10 / Pin 24)',
    unit: 'V',
    description: 'Analog telemetry of 2S Li-ion pack (6.4V cutoff to 8.4V nominal). Strictly optional in live mode.',
    flatSatStatus: 'OPTIONAL',
  },
  {
    key: 'enableWheelRpm',
    packetField: 'wheelRpm',
    label: 'DCS Momentum Wheel',
    hardwareName: 'MT2204 BLDC + TMC2209',
    busInterface: 'UART / Tachometer pulse',
    unit: 'RPM',
    description: 'Z-axis gyroscopic stabilization wheel. Not installed on current flat-sat breadboard.',
    flatSatStatus: 'UNINSTALLED',
  },
  {
    key: 'enableSps30',
    packetField: 'pm2_5',
    label: 'SPS30 Particulate (PM2.5)',
    hardwareName: 'Sensirion SPS30',
    busInterface: 'I2C (Wire1)',
    unit: 'µg/m³',
    description: 'Optical PM2.5 air quality sensor. Bonus scientific mission payload.',
    flatSatStatus: 'OPTIONAL',
  },
  {
    key: 'enableUv',
    packetField: 'uv',
    label: 'LTR390 UV Radiation',
    hardwareName: 'Lite-On LTR-390UV-01',
    busInterface: 'I2C (Wire1)',
    unit: 'Index',
    description: 'Solar ultraviolet light intensity index sensor. Bonus scientific payload.',
    flatSatStatus: 'OPTIONAL',
  },
];

/**
 * Loads optional telemetry settings from storage with safe fallback to defaults.
 */
export function loadOptionalTelemetrySettings(
  storage?: StorageLike | Storage | null
): OptionalTelemetrySettings {
  const store = storage ?? (typeof window !== 'undefined' ? window.localStorage : null);
  if (!store) {
    return { ...DEFAULT_OPTIONAL_TELEMETRY_SETTINGS };
  }

  try {
    const raw = store.getItem(OPTIONAL_TELEMETRY_STORAGE_KEY);
    if (!raw) {
      return { ...DEFAULT_OPTIONAL_TELEMETRY_SETTINGS };
    }
    const parsed = JSON.parse(raw) as Partial<OptionalTelemetrySettings>;
    return {
      enableSps30:
        typeof parsed.enableSps30 === 'boolean'
          ? parsed.enableSps30
          : DEFAULT_OPTIONAL_TELEMETRY_SETTINGS.enableSps30,
      enableUv:
        typeof parsed.enableUv === 'boolean'
          ? parsed.enableUv
          : DEFAULT_OPTIONAL_TELEMETRY_SETTINGS.enableUv,
      enableWheelRpm:
        typeof parsed.enableWheelRpm === 'boolean'
          ? parsed.enableWheelRpm
          : DEFAULT_OPTIONAL_TELEMETRY_SETTINGS.enableWheelRpm,
      enableBatteryVoltage:
        typeof parsed.enableBatteryVoltage === 'boolean'
          ? parsed.enableBatteryVoltage
          : DEFAULT_OPTIONAL_TELEMETRY_SETTINGS.enableBatteryVoltage,
    };
  } catch {
    return { ...DEFAULT_OPTIONAL_TELEMETRY_SETTINGS };
  }
}

/**
 * Persists optional telemetry settings to storage.
 */
export function saveOptionalTelemetrySettings(
  storage: StorageLike | Storage | null | undefined,
  settings: OptionalTelemetrySettings
): void {
  const store = storage ?? (typeof window !== 'undefined' ? window.localStorage : null);
  if (!store) return;

  try {
    store.setItem(OPTIONAL_TELEMETRY_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage quota / access errors
  }
}

/**
 * Evaluates the display state of an optional telemetry field.
 * Handles disabled state, missing/null/NaN state, and valid numeric state.
 */
export function evaluateOptionalFieldState(
  isEnabled: boolean,
  value: number | null | undefined,
  formatter: (v: number) => string
): {
  status: 'DISABLED' | 'UNAVAILABLE' | 'VALID';
  displayText: string;
  numericValue: number | null;
} {
  if (!isEnabled) {
    return {
      status: 'DISABLED',
      displayText: 'DISABLED',
      numericValue: null,
    };
  }

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return {
      status: 'UNAVAILABLE',
      displayText: 'UNAVAILABLE',
      numericValue: null,
    };
  }

  return {
    status: 'VALID',
    displayText: formatter(value),
    numericValue: value,
  };
}
