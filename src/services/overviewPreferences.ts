/**
 * Local GCS display preferences for the Mission Overview workspace.
 * These control only which widgets this browser renders; they never configure onboard hardware.
 */

import { TelemetrySource } from '../types';

export type OverviewWidgetId =
  | 'missionStrip'
  | 'landingPrediction'
  | 'telemetryCharts'
  | 'attitude'
  | 'gpsMap'
  | 'linkStatus'
  | 'flightState'
  | 'rawReadouts'
  | 'simControls';

export type OverviewPreferences = Record<OverviewWidgetId, boolean>;

export interface OverviewWidgetDefinition {
  id: OverviewWidgetId;
  label: string;
  description: string;
  /** If set, the widget only exists in that telemetry source. */
  onlyIn?: 'SIMULATION';
}

export const OVERVIEW_PREFS_STORAGE_KEY = 'cansat-gcs.overview-widgets.v1';

export const OVERVIEW_WIDGETS: OverviewWidgetDefinition[] = [
  { id: 'missionStrip', label: 'Mission status strip', description: 'Flight phase, altitude, GNSS fix, battery' },
  { id: 'landingPrediction', label: 'Landing prediction summary', description: 'Predicted landing card' },
  { id: 'telemetryCharts', label: 'Telemetry charts', description: 'Altitude / velocity / sensor charts' },
  { id: 'attitude', label: 'Attitude visualization', description: '3D CanSat orientation viewport' },
  { id: 'gpsMap', label: 'GPS map', description: 'GNSS track and target map' },
  { id: 'linkStatus', label: 'Communications / link status', description: 'Serial link panel' },
  { id: 'flightState', label: 'Flight state', description: 'FSW phase and sequence' },
  { id: 'rawReadouts', label: 'Raw sensor readouts', description: 'Latest sensor values' },
  {
    id: 'simControls',
    label: 'Simulator controls',
    description: 'Start/stop, turbulence, restart (Simulation mode only)',
    onlyIn: 'SIMULATION',
  },
];

export const DEFAULT_OVERVIEW_PREFERENCES: OverviewPreferences = OVERVIEW_WIDGETS.reduce(
  (acc, w) => ({ ...acc, [w.id]: true }),
  {} as OverviewPreferences
);

/** Merge unknown/partial/corrupt stored values onto defaults. Unknown keys are dropped. */
export function sanitizeOverviewPreferences(raw: unknown): OverviewPreferences {
  const next: OverviewPreferences = { ...DEFAULT_OVERVIEW_PREFERENCES };
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const w of OVERVIEW_WIDGETS) {
      const v = (raw as Record<string, unknown>)[w.id];
      if (typeof v === 'boolean') next[w.id] = v;
    }
  }
  return next;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export function loadOverviewPreferences(storage: StorageLike | null | undefined): OverviewPreferences {
  if (!storage) return { ...DEFAULT_OVERVIEW_PREFERENCES };
  try {
    const text = storage.getItem(OVERVIEW_PREFS_STORAGE_KEY);
    if (!text) return { ...DEFAULT_OVERVIEW_PREFERENCES };
    return sanitizeOverviewPreferences(JSON.parse(text));
  } catch {
    return { ...DEFAULT_OVERVIEW_PREFERENCES };
  }
}

export function saveOverviewPreferences(
  storage: StorageLike | null | undefined,
  prefs: OverviewPreferences
): void {
  if (!storage) return;
  try {
    storage.setItem(OVERVIEW_PREFS_STORAGE_KEY, JSON.stringify(sanitizeOverviewPreferences(prefs)));
  } catch {
    // Storage may be unavailable (private mode / quota); preferences then apply for this session only.
  }
}

export function getBrowserStorage(): StorageLike | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** Whether a widget should render for the given telemetry source and preferences. */
export function isOverviewWidgetVisible(
  prefs: OverviewPreferences,
  id: OverviewWidgetId,
  telemetrySource: TelemetrySource
): boolean {
  const def = OVERVIEW_WIDGETS.find((w) => w.id === id);
  if (def?.onlyIn === 'SIMULATION' && telemetrySource !== 'SIMULATION') return false;
  return prefs[id];
}

/** Whether a live-link alert must be shown even though the link-status widget is hidden. */
export function shouldShowLinkAlertBanner(args: {
  telemetrySource: TelemetrySource;
  linkWidgetVisible: boolean;
  serialState: string;
  isStale: boolean;
  lastError: string | null;
}): boolean {
  if (args.telemetrySource !== 'LIVE_SERIAL' || args.linkWidgetVisible) return false;
  return (
    args.serialState === 'ERROR' ||
    args.serialState === 'UNSUPPORTED' ||
    args.serialState === 'DISCONNECTED' ||
    args.isStale ||
    Boolean(args.lastError)
  );
}

/** Resolves Tailwind grid responsive classes for the overview top status strip. */
export function resolveOverviewStripColumnsClass(
  showMissionStrip: boolean,
  showPrediction: boolean
): string {
  if (showMissionStrip && showPrediction) {
    return 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5';
  }
  if (showMissionStrip) {
    return 'grid-cols-2 sm:grid-cols-2 lg:grid-cols-4';
  }
  if (showPrediction) {
    return 'grid-cols-1 max-w-sm';
  }
  return 'grid-cols-1';
}
