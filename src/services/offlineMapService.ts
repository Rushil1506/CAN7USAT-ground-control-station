/**
 * CAN-7USAT Ground Control Station — Offline Map Service
 * Team Parikshit (Team 017 | 2026-IN-SPACe-CAN-7USAT-017)
 *
 * Implements high-reliability offline map tile storage, download orchestration,
 * geographic bounding box math, deduplication, and Leaflet layer integration.
 *
 * Designed for field recovery operations at Manipal, Kushinagar, and Tamkuhi Raj
 * with zero dependency on active internet connectivity.
 */

import { isValidCoordinateFix } from './landingPredictorClient';
import { TelemetryPacket } from '../types';

// ============================================================
// TYPES & INTERFACES
// ============================================================

export type OfflinePackId = 'manipal' | 'kushinagar' | 'tamkuhi_raj' | string;

export type OfflinePackStatus =
  | 'NOT_DOWNLOADED'
  | 'DOWNLOADING'
  | 'READY'
  | 'ERROR'
  | 'PARTIAL';

export interface OfflineMapPack {
  id: OfflinePackId;
  name: string;
  purpose: string;
  center: [number, number]; // [lat, lon]
  bounds: [number, number, number, number]; // [south, west, north, east]
  minZoom: number;
  maxZoom: number;
  status: OfflinePackStatus;
  totalTiles: number;
  downloadedTiles: number;
  failedTiles: number;
  estimatedSizeBytes: number;
  actualSizeBytes: number;
  lastDownloadedAt: number | null;
  error: string | null;
  isRealGeographic?: boolean;
  tileFormat?: 'PNG_RASTER' | 'SYNTHETIC_SVG' | string;
}

export interface OfflineTileRecord {
  key: string; // `${z}/${x}/${y}`
  z: number;
  x: number;
  y: number;
  packIds: string[];
  blob: Blob | ArrayBuffer;
  contentType: string;
  sizeBytes: number;
  timestamp: number;
}

export interface OfflineMapSettings {
  forceOffline: boolean;
  showCoverageBounds: boolean;
  tileSourceTemplate: string;
  maxConcurrentDownloads: number;
  storageBudgetMb: number;
}

export interface StorageEstimateInfo {
  usageBytes: number;
  quotaBytes: number;
  availableBytes: number;
  totalStoredTiles: number;
  isQuotaWarning: boolean;
}

export interface DownloadProgress {
  packId: string;
  downloaded: number;
  failed: number;
  total: number;
  percent: number;
  currentTile: { z: number; x: number; y: number } | null;
}

// ============================================================
// PRE-CONFIGURED REGIONAL MAP PACKS
// ============================================================

export const DEFAULT_OFFLINE_PACKS: Record<string, OfflineMapPack> = {
  manipal: {
    id: 'manipal',
    name: 'Manipal Test Bench & Field',
    purpose: 'Development, flat-sat testing, and local MIT field verification',
    center: [13.3525, 74.7928],
    bounds: [13.325, 74.765, 13.380, 74.820], // ~6 km x 6 km
    minZoom: 11,
    maxZoom: 15,
    status: 'NOT_DOWNLOADED',
    totalTiles: 69,
    downloadedTiles: 0,
    failedTiles: 0,
    estimatedSizeBytes: 69 * 20480, // ~1.38 MB
    actualSizeBytes: 0,
    lastDownloadedAt: null,
    error: null,
  },
  kushinagar: {
    id: 'kushinagar',
    name: 'Kushinagar Launch Site',
    purpose: 'Primary competition launch pad & main landing recovery envelope',
    center: [26.7400, 83.8900],
    bounds: [26.690, 83.830, 26.790, 83.950], // ~11 km x 12 km
    minZoom: 11,
    maxZoom: 15,
    status: 'NOT_DOWNLOADED',
    totalTiles: 194,
    downloadedTiles: 0,
    failedTiles: 0,
    estimatedSizeBytes: 194 * 20480, // ~3.88 MB
    actualSizeBytes: 0,
    lastDownloadedAt: null,
    error: null,
  },
  tamkuhi_raj: {
    id: 'tamkuhi_raj',
    name: 'Tamkuhi Raj Downrange Site',
    purpose: 'Downrange tracking & secondary eastern recovery zone',
    center: [26.6200, 84.1500],
    bounds: [26.570, 84.090, 26.670, 84.210], // ~11 km x 12 km
    minZoom: 11,
    maxZoom: 15,
    status: 'NOT_DOWNLOADED',
    totalTiles: 186,
    downloadedTiles: 0,
    failedTiles: 0,
    estimatedSizeBytes: 186 * 20480, // ~3.72 MB
    actualSizeBytes: 0,
    lastDownloadedAt: null,
    error: null,
    isRealGeographic: false,
    tileFormat: 'PNG_RASTER',
  },
};

export const LOCAL_TILE_SERVER_URL = 'http://127.0.0.1:8080';
export const DEFAULT_TILE_SOURCE_TEMPLATE = 'http://127.0.0.1:8080/tiles/{packId}/{z}/{x}/{y}.png';

export const DEFAULT_OFFLINE_SETTINGS: OfflineMapSettings = {
  forceOffline: false,
  showCoverageBounds: true,
  tileSourceTemplate: DEFAULT_TILE_SOURCE_TEMPLATE, // Connects to local offline tile server serving genuine MBTiles
  maxConcurrentDownloads: 4,
  storageBudgetMb: 250, // 250 MB warning threshold
};

// ============================================================
// GEOGRAPHIC & SLIPPY-MAP TILE MATH
// ============================================================

/** Converts longitude in decimal degrees to Slippy-map tile X coordinate. */
export function lon2tileX(lon: number, zoom: number): number {
  const n = Math.pow(2, zoom);
  return Math.floor(((lon + 180) / 360) * n);
}

/** Converts latitude in decimal degrees to Slippy-map tile Y coordinate. */
export function lat2tileY(lat: number, zoom: number): number {
  const rad = (lat * Math.PI) / 180;
  const n = Math.pow(2, zoom);
  return Math.floor(
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n
  );
}

/** Converts tile X coordinate to western-edge longitude in decimal degrees. */
export function tileX2lon(x: number, zoom: number): number {
  return (x / Math.pow(2, zoom)) * 360 - 180;
}

/** Converts tile Y coordinate to northern-edge latitude in decimal degrees. */
export function tileY2lat(y: number, zoom: number): number {
  const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, zoom);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

/** Calculates geographic lat/lon bounds for a single tile. */
export function getTileBounds(z: number, x: number, y: number): {
  north: number;
  south: number;
  east: number;
  west: number;
} {
  return {
    north: tileY2lat(y, z),
    south: tileY2lat(y + 1, z),
    west: tileX2lon(x, z),
    east: tileX2lon(x + 1, z),
  };
}

/**
 * Computes all (z, x, y) tile coordinates required to cover a bounding box
 * across a specified zoom range [minZoom..maxZoom].
 */
export function computeTilesForBounds(
  bounds: [number, number, number, number],
  minZoom: number,
  maxZoom: number
): Array<{ z: number; x: number; y: number }> {
  const [south, west, north, east] = bounds;
  const tiles: Array<{ z: number; x: number; y: number }> = [];

  for (let z = minZoom; z <= maxZoom; z++) {
    const minX = Math.max(0, lon2tileX(west, z));
    const maxX = Math.min(Math.pow(2, z) - 1, lon2tileX(east, z));
    const minY = Math.max(0, lat2tileY(north, z));
    const maxY = Math.min(Math.pow(2, z) - 1, lat2tileY(south, z));

    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        tiles.push({ z, x, y });
      }
    }
  }

  return tiles;
}

/** Returns the total tile count covering a bounding box across zoom range. */
export function countTilesForBounds(
  bounds: [number, number, number, number],
  minZoom: number,
  maxZoom: number
): number {
  const [south, west, north, east] = bounds;
  let count = 0;

  for (let z = minZoom; z <= maxZoom; z++) {
    const minX = Math.max(0, lon2tileX(west, z));
    const maxX = Math.min(Math.pow(2, z) - 1, lon2tileX(east, z));
    const minY = Math.max(0, lat2tileY(north, z));
    const maxY = Math.min(Math.pow(2, z) - 1, lat2tileY(south, z));

    count += (maxX - minX + 1) * (maxY - minY + 1);
  }

  return count;
}

/** Estimates storage size in bytes assuming average tile size. */
export function estimatePackStorage(tileCount: number, avgBytesPerTile = 20480): number {
  return tileCount * avgBytesPerTile;
}

/** Formats byte counts into human-readable string. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** Checks whether a point (lat, lon) falls within geographic bounding box. */
export function isCoordinateInBounds(
  lat: number,
  lon: number,
  bounds: [number, number, number, number]
): boolean {
  const [south, west, north, east] = bounds;
  return lat >= south && lat <= north && lon >= west && lon <= east;
}

/**
 * Expands bounding box by given latitude/longitude margin in degrees.
 * Clamps coordinates to valid Mercator projection limits [-85.0511, 85.0511].
 */
export function expandBounds(
  bounds: [number, number, number, number],
  latMarginDeg: number,
  lonMarginDeg: number
): [number, number, number, number] {
  const [south, west, north, east] = bounds;
  return [
    Math.max(-85.0511, Number((south - latMarginDeg).toFixed(5))),
    Math.max(-180, Number((west - lonMarginDeg).toFixed(5))),
    Math.min(85.0511, Number((north + latMarginDeg).toFixed(5))),
    Math.min(180, Number((east + lonMarginDeg).toFixed(5))),
  ];
}

/**
 * Expands bounding box symmetrically by a specified ground distance in kilometers.
 * Computes exact geodesic delta based on center latitude.
 */
export function expandBoundsByKm(
  bounds: [number, number, number, number],
  km: number
): [number, number, number, number] {
  const [south, west, north, east] = bounds;
  const midLat = (north + south) / 2;
  const latDelta = km / 111.32;
  const rad = (midLat * Math.PI) / 180;
  const cosLat = Math.cos(rad);
  const lonDelta = cosLat > 0.001 ? km / (111.32 * cosLat) : latDelta;
  return expandBounds(bounds, latDelta, lonDelta);
}

/** Constructs the canonical tile storage key: `${z}/${x}/${y}`. */
export function makeTileKey(z: number, x: number, y: number): string {
  return `${z}/${x}/${y}`;
}

// ============================================================
// TACTICAL & MISSING TILE SVG/IMAGE GENERATION
// ============================================================

/**
 * Generates a clean tactical topographic/grid tile SVG.
 * Used for standalone offline operation without external network dependency,
 * or as a verified base map for testing.
 */
export function generateTacticalTileSvg(
  z: number,
  x: number,
  y: number,
  packName = 'CAN-7USAT'
): string {
  const bounds = getTileBounds(z, x, y);
  const midLat = (bounds.north + bounds.south) / 2;
  const midLon = (bounds.east + bounds.west) / 2;

  const latStr = `${midLat >= 0 ? '+' : ''}${midLat.toFixed(4)}°`;
  const lonStr = `${midLon >= 0 ? '+' : ''}${midLon.toFixed(4)}°`;

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
      <defs>
        <pattern id="grid_${z}_${x}_${y}" width="32" height="32" patternUnits="userSpaceOnUse">
          <path d="M 32 0 L 0 0 0 32" fill="none" stroke="#253246" stroke-width="0.8" opacity="0.6"/>
        </pattern>
        <linearGradient id="bg_${z}_${x}_${y}" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#0f172a"/>
          <stop offset="100%" stop-color="#141f32"/>
        </linearGradient>
      </defs>
      <rect width="256" height="256" fill="url(#bg_${z}_${x}_${y})"/>
      <rect width="256" height="256" fill="url(#grid_${z}_${x}_${y})"/>
      
      <!-- Coordinate crosshair at tile center -->
      <line x1="128" y1="116" x2="128" y2="140" stroke="#3b82f6" stroke-width="1.2" opacity="0.8"/>
      <line x1="116" y1="128" x2="140" y2="128" stroke="#3b82f6" stroke-width="1.2" opacity="0.8"/>
      <circle cx="128" cy="128" r="6" fill="none" stroke="#3b82f6" stroke-width="1" opacity="0.6"/>

      <!-- Border outline -->
      <rect x="0.5" y="0.5" width="255" height="255" fill="none" stroke="#334155" stroke-width="1" opacity="0.7"/>

      <!-- Tactical tile metadata readout -->
      <text x="10" y="20" font-family="monospace" font-size="9" font-weight="bold" fill="#60a5fa" opacity="0.9">
        ${packName.toUpperCase()}
      </text>
      <text x="10" y="34" font-family="monospace" font-size="8" fill="#94a3b8" opacity="0.8">
        Z${z} · (${x}, ${y})
      </text>
      <text x="10" y="244" font-family="monospace" font-size="8" fill="#cbd5e1" opacity="0.85">
        ${latStr}, ${lonStr}
      </text>
    </svg>
  `.trim();
}

/**
 * Generates a prominent missing-tile warning SVG.
 * Rendered when the operator pans into an area outside the downloaded offline pack.
 */
export function generateMissingTileSvg(z: number, x: number, y: number, isDark = false): string {
  if (isDark) {
    return `
      <svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
        <defs>
          <pattern id="hatch_${z}_${x}_${y}" width="16" height="16" patternTransform="rotate(45 0 0)" patternUnits="userSpaceOnUse">
            <line x1="0" y1="0" x2="0" y2="16" stroke="#334155" stroke-width="2" />
          </pattern>
        </defs>
        <rect width="256" height="256" fill="#0f172a"/>
        <rect width="256" height="256" fill="url(#hatch_${z}_${x}_${y})" opacity="0.8"/>
        <rect x="1" y="1" width="254" height="254" fill="none" stroke="#334155" stroke-width="1" stroke-dasharray="4,4" opacity="0.6"/>
        
        <rect x="24" y="98" width="208" height="60" rx="6" fill="#1e293b" stroke="#334155" stroke-width="1.2" opacity="0.96"/>
        <text x="128" y="118" font-family="monospace" font-size="10" font-weight="bold" fill="#38bdf8" text-anchor="middle">
          OFFLINE MAP
        </text>
        <text x="128" y="133" font-family="monospace" font-size="8.5" font-weight="600" fill="#94a3b8" text-anchor="middle">
          Tile Not in Downloaded Packs
        </text>
        <text x="128" y="148" font-family="monospace" font-size="7.5" fill="#64748b" text-anchor="middle">
          Z${z} · X:${x} · Y:${y}
        </text>
      </svg>
    `.trim();
  }

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
      <defs>
        <pattern id="hatch_${z}_${x}_${y}" width="16" height="16" patternTransform="rotate(45 0 0)" patternUnits="userSpaceOnUse">
          <line x1="0" y1="0" x2="0" y2="16" stroke="#cbd5e1" stroke-width="2" />
        </pattern>
      </defs>
      <rect width="256" height="256" fill="#e2e8f0"/>
      <rect width="256" height="256" fill="url(#hatch_${z}_${x}_${y})" opacity="0.8"/>
      <rect x="1" y="1" width="254" height="254" fill="none" stroke="#94a3b8" stroke-width="1" stroke-dasharray="4,4" opacity="0.6"/>
      
      <rect x="24" y="98" width="208" height="60" rx="6" fill="#f8fafc" stroke="#94a3b8" stroke-width="1.2" opacity="0.96"/>
      <text x="128" y="118" font-family="monospace" font-size="10" font-weight="bold" fill="#0369a1" text-anchor="middle">
        OFFLINE MAP
      </text>
      <text x="128" y="133" font-family="monospace" font-size="8.5" font-weight="600" fill="#475569" text-anchor="middle">
        Tile Not in Downloaded Packs
      </text>
      <text x="128" y="148" font-family="monospace" font-size="7.5" fill="#64748b" text-anchor="middle">
        Z${z} · X:${x} · Y:${y}
      </text>
    </svg>
  `.trim();
}

export function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function svgToBlob(svg: string): Blob {
  return new Blob([svg], { type: 'image/svg+xml' });
}

/**
 * Validates whether binary buffer has genuine PNG magic signature:
 * \x89PNG\r\n\x1a\n (89 50 4E 47 0D 0A 1A 0A)
 */
export function isPngBuffer(buf: ArrayBuffer | Uint8Array): boolean {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (bytes.length < 8) return false;
  return (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  );
}

/**
 * Checks connection status to the local offline tile server (default 127.0.0.1:8080).
 */
export async function checkLocalTileServerHealth(
  baseUrl = LOCAL_TILE_SERVER_URL
): Promise<{ online: boolean; packs: Array<{ id: string; name: string }> }> {
  try {
    const res = await fetch(`${baseUrl}/api/health`, {
      signal: typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal ? AbortSignal.timeout(1000) : undefined,
    });
    if (!res.ok) return { online: false, packs: [] };
    const pRes = await fetch(`${baseUrl}/api/packs`, {
      signal: typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal ? AbortSignal.timeout(1000) : undefined,
    });
    if (pRes.ok) {
      const pData = (await pRes.json()) as { packs?: Array<{ id: string; name: string }> };
      return { online: true, packs: pData.packs || [] };
    }
    return { online: true, packs: [] };
  } catch {
    return { online: false, packs: [] };
  }
}

/**
 * Finds which offline regional pack covers a given geographic coordinate.
 * Supports passing either a pack record map or an array of packs (including custom operator packs).
 */
export function findPackForCoordinates(
  lat: number,
  lon: number,
  packs: Record<string, OfflineMapPack> | OfflineMapPack[] = DEFAULT_OFFLINE_PACKS
): OfflineMapPack | null {
  const packList = Array.isArray(packs) ? packs : Object.values(packs);
  for (const pack of packList) {
    if (isCoordinateInBounds(lat, lon, pack.bounds)) {
      return pack;
    }
  }
  return null;
}

export interface CustomPackOptions {
  id?: string;
  name: string;
  purpose: string;
  bounds: [number, number, number, number];
  minZoom: number;
  maxZoom: number;
  center?: [number, number];
}

/**
 * Creates or updates an operator-configured offline map pack.
 * Computes exact tile counts, storage estimates, and persists to storage.
 */
export async function createOrUpdateCustomPack(
  options: CustomPackOptions,
  storage: IOfflineMapStorage = getOfflineStorage()
): Promise<OfflineMapPack> {
  const id = options.id || `custom_${Date.now()}`;
  const existing = await storage.getPack(id);
  const center: [number, number] =
    options.center || [
      Number(((options.bounds[0] + options.bounds[2]) / 2).toFixed(5)),
      Number(((options.bounds[1] + options.bounds[3]) / 2).toFixed(5)),
    ];

  const totalTiles = countTilesForBounds(options.bounds, options.minZoom, options.maxZoom);
  const estimatedSizeBytes = estimatePackStorage(totalTiles);

  const pack: OfflineMapPack = {
    id,
    name: options.name,
    purpose: options.purpose,
    center,
    bounds: options.bounds,
    minZoom: options.minZoom,
    maxZoom: options.maxZoom,
    status:
      existing?.status === 'READY' &&
      existing.totalTiles === totalTiles &&
      existing.bounds[0] === options.bounds[0] &&
      existing.bounds[1] === options.bounds[1] &&
      existing.bounds[2] === options.bounds[2] &&
      existing.bounds[3] === options.bounds[3]
        ? 'READY'
        : 'NOT_DOWNLOADED',
    totalTiles,
    downloadedTiles: existing?.downloadedTiles ?? 0,
    failedTiles: existing?.failedTiles ?? 0,
    estimatedSizeBytes,
    actualSizeBytes: existing?.actualSizeBytes ?? 0,
    lastDownloadedAt: existing?.lastDownloadedAt ?? null,
    error: null,
    isRealGeographic: existing?.isRealGeographic ?? true,
    tileFormat: existing?.tileFormat ?? 'PNG_RASTER',
  };

  await storage.putPack(pack);
  return pack;
}

// ============================================================
// STORAGE ABSTRACTION (INDEXEDDB & IN-MEMORY FALLBACK)
// ============================================================

export interface IOfflineMapStorage {
  getTile(z: number, x: number, y: number): Promise<OfflineTileRecord | null>;
  putTile(record: OfflineTileRecord): Promise<void>;
  hasTile(z: number, x: number, y: number): Promise<boolean>;
  deleteTile(z: number, x: number, y: number): Promise<void>;
  deleteTilesForPack(packId: string): Promise<number>;
  getPack(id: string): Promise<OfflineMapPack | null>;
  putPack(pack: OfflineMapPack): Promise<void>;
  listPacks(): Promise<OfflineMapPack[]>;
  deletePack(id: string): Promise<void>;
  getSettings(): Promise<OfflineMapSettings>;
  putSettings(settings: OfflineMapSettings): Promise<void>;
  getStorageEstimate(): Promise<StorageEstimateInfo>;
  clearAll(): Promise<void>;
}

/** In-memory storage adapter for unit testing and non-browser environments. */
export class InMemoryOfflineMapStorage implements IOfflineMapStorage {
  private tiles = new Map<string, OfflineTileRecord>();
  private packs = new Map<string, OfflineMapPack>();
  private settings: OfflineMapSettings = { ...DEFAULT_OFFLINE_SETTINGS };

  constructor() {
    for (const [id, p] of Object.entries(DEFAULT_OFFLINE_PACKS)) {
      this.packs.set(id, { ...p });
    }
  }

  async getTile(z: number, x: number, y: number): Promise<OfflineTileRecord | null> {
    const key = makeTileKey(z, x, y);
    return this.tiles.get(key) ?? null;
  }

  async putTile(record: OfflineTileRecord): Promise<void> {
    this.tiles.set(record.key, record);
  }

  async hasTile(z: number, x: number, y: number): Promise<boolean> {
    return this.tiles.has(makeTileKey(z, x, y));
  }

  async deleteTile(z: number, x: number, y: number): Promise<void> {
    this.tiles.delete(makeTileKey(z, x, y));
  }

  async deleteTilesForPack(packId: string): Promise<number> {
    let deletedCount = 0;
    for (const [key, record] of Array.from(this.tiles.entries())) {
      const remainingPackIds = record.packIds.filter((p) => p !== packId);
      if (remainingPackIds.length === 0) {
        this.tiles.delete(key);
        deletedCount++;
      } else {
        record.packIds = remainingPackIds;
      }
    }
    return deletedCount;
  }

  async getPack(id: string): Promise<OfflineMapPack | null> {
    return this.packs.get(id) ?? null;
  }

  async putPack(pack: OfflineMapPack): Promise<void> {
    this.packs.set(pack.id, { ...pack });
  }

  async listPacks(): Promise<OfflineMapPack[]> {
    return Array.from(this.packs.values());
  }

  async deletePack(id: string): Promise<void> {
    await this.deleteTilesForPack(id);
    const p = this.packs.get(id);
    if (p) {
      p.status = 'NOT_DOWNLOADED';
      p.downloadedTiles = 0;
      p.actualSizeBytes = 0;
      p.lastDownloadedAt = null;
      p.error = null;
    }
  }

  async getSettings(): Promise<OfflineMapSettings> {
    return { ...this.settings };
  }

  async putSettings(settings: OfflineMapSettings): Promise<void> {
    this.settings = { ...settings };
  }

  async getStorageEstimate(): Promise<StorageEstimateInfo> {
    let usageBytes = 0;
    for (const t of this.tiles.values()) {
      usageBytes += t.sizeBytes;
    }
    const quotaBytes = 1024 * 1024 * 1024; // 1 GB simulated quota
    const budgetBytes = this.settings.storageBudgetMb * 1024 * 1024;
    return {
      usageBytes,
      quotaBytes,
      availableBytes: Math.max(0, quotaBytes - usageBytes),
      totalStoredTiles: this.tiles.size,
      isQuotaWarning: usageBytes > budgetBytes,
    };
  }

  async clearAll(): Promise<void> {
    this.tiles.clear();
    for (const [id, p] of Object.entries(DEFAULT_OFFLINE_PACKS)) {
      this.packs.set(id, { ...p });
    }
  }
}

/** Persistent IndexedDB storage adapter surviving browser restarts. */
export class IndexedDBOfflineMapStorage implements IOfflineMapStorage {
  private dbName = 'cansat_offline_maps_v2';
  private dbVersion = 1;
  private dbPromise: Promise<IDBDatabase> | null = null;

  private async openDb(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;

    // Purge obsolete v1 database with stale/unnamespaced tiles
    try {
      if (typeof indexedDB !== 'undefined' && typeof sessionStorage !== 'undefined') {
        if (!sessionStorage.getItem('cansat_v1_purged')) {
          indexedDB.deleteDatabase('cansat_offline_maps_v1');
          sessionStorage.setItem('cansat_v1_purged', 'true');
        }
      }
    } catch {
      // Ignore in non-browser or restricted environments
    }

    this.dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB is not available in this environment'));
        return;
      }

      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains('tiles')) {
          const tileStore = db.createObjectStore('tiles', { keyPath: 'key' });
          tileStore.createIndex('packIds', 'packIds', { multiEntry: true });
        }
        if (!db.objectStoreNames.contains('packs')) {
          db.createObjectStore('packs', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'id' });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    return this.dbPromise;
  }

  async getTile(z: number, x: number, y: number): Promise<OfflineTileRecord | null> {
    const db = await this.openDb();
    const key = makeTileKey(z, x, y);
    return new Promise((resolve, reject) => {
      const tx = db.transaction('tiles', 'readonly');
      const store = tx.objectStore('tiles');
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  }

  async putTile(record: OfflineTileRecord): Promise<void> {
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('tiles', 'readwrite');
      const store = tx.objectStore('tiles');
      const req = store.put(record);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async hasTile(z: number, x: number, y: number): Promise<boolean> {
    const t = await this.getTile(z, x, y);
    return t !== null;
  }

  async deleteTile(z: number, x: number, y: number): Promise<void> {
    const db = await this.openDb();
    const key = makeTileKey(z, x, y);
    return new Promise((resolve, reject) => {
      const tx = db.transaction('tiles', 'readwrite');
      const store = tx.objectStore('tiles');
      const req = store.delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async deleteTilesForPack(packId: string): Promise<number> {
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('tiles', 'readwrite');
      const store = tx.objectStore('tiles');
      const req = store.openCursor();
      let deletedCount = 0;

      req.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result;
        if (cursor) {
          const record = cursor.value as OfflineTileRecord;
          const remainingPackIds = record.packIds.filter((p) => p !== packId);
          if (remainingPackIds.length === 0) {
            cursor.delete();
            deletedCount++;
          } else {
            record.packIds = remainingPackIds;
            cursor.update(record);
          }
          cursor.continue();
        } else {
          resolve(deletedCount);
        }
      };
      req.onerror = () => reject(req.error);
    });
  }

  async getPack(id: string): Promise<OfflineMapPack | null> {
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('packs', 'readonly');
      const store = tx.objectStore('packs');
      const req = store.get(id);
      req.onsuccess = () => {
        if (req.result) {
          resolve(req.result);
        } else {
          // Fall back to default definition if not yet persisted
          resolve(DEFAULT_OFFLINE_PACKS[id] ?? null);
        }
      };
      req.onerror = () => reject(req.error);
    });
  }

  async putPack(pack: OfflineMapPack): Promise<void> {
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('packs', 'readwrite');
      const store = tx.objectStore('packs');
      const req = store.put(pack);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async listPacks(): Promise<OfflineMapPack[]> {
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('packs', 'readonly');
      const store = tx.objectStore('packs');
      const req = store.getAll();
      req.onsuccess = () => {
        const stored = (req.result as OfflineMapPack[]) || [];
        const map = new Map<string, OfflineMapPack>();
        for (const [id, def] of Object.entries(DEFAULT_OFFLINE_PACKS)) {
          map.set(id, { ...def });
        }
        for (const s of stored) {
          map.set(s.id, s);
        }
        resolve(Array.from(map.values()));
      };
      req.onerror = () => reject(req.error);
    });
  }

  async deletePack(id: string): Promise<void> {
    await this.deleteTilesForPack(id);
    const existing = await this.getPack(id);
    if (existing) {
      existing.status = 'NOT_DOWNLOADED';
      existing.downloadedTiles = 0;
      existing.actualSizeBytes = 0;
      existing.lastDownloadedAt = null;
      existing.error = null;
      await this.putPack(existing);
    }
  }

  async getSettings(): Promise<OfflineMapSettings> {
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('settings', 'readonly');
      const store = tx.objectStore('settings');
      const req = store.get('app_settings');
      req.onsuccess = () => {
        if (req.result) {
          resolve(req.result.settings);
        } else {
          resolve({ ...DEFAULT_OFFLINE_SETTINGS });
        }
      };
      req.onerror = () => reject(req.error);
    });
  }

  async putSettings(settings: OfflineMapSettings): Promise<void> {
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('settings', 'readwrite');
      const store = tx.objectStore('settings');
      const req = store.put({ id: 'app_settings', settings });
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async getStorageEstimate(): Promise<StorageEstimateInfo> {
    let usageBytes = 0;
    let quotaBytes = 1024 * 1024 * 1024; // 1 GB fallback

    if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.estimate) {
      try {
        const est = await navigator.storage.estimate();
        if (typeof est.usage === 'number') usageBytes = est.usage;
        if (typeof est.quota === 'number') quotaBytes = est.quota;
      } catch {
        // Fall back to counting
      }
    }

    const db = await this.openDb();
    const tileCount = await new Promise<number>((resolve, reject) => {
      const tx = db.transaction('tiles', 'readonly');
      const store = tx.objectStore('tiles');
      const req = store.count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    const settings = await this.getSettings();
    const budgetBytes = settings.storageBudgetMb * 1024 * 1024;

    return {
      usageBytes,
      quotaBytes,
      availableBytes: Math.max(0, quotaBytes - usageBytes),
      totalStoredTiles: tileCount,
      isQuotaWarning: usageBytes > budgetBytes,
    };
  }

  async clearAll(): Promise<void> {
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['tiles', 'packs'], 'readwrite');
      tx.objectStore('tiles').clear();
      tx.objectStore('packs').clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}

// Global storage singleton accessor with test injection
let globalStorageInstance: IOfflineMapStorage | null = null;

export function getOfflineStorage(): IOfflineMapStorage {
  if (!globalStorageInstance) {
    if (typeof indexedDB !== 'undefined') {
      globalStorageInstance = new IndexedDBOfflineMapStorage();
    } else {
      globalStorageInstance = new InMemoryOfflineMapStorage();
    }
  }
  return globalStorageInstance;
}

export function setOfflineStorageForTesting(storage: IOfflineMapStorage | null): void {
  globalStorageInstance = storage;
}

// ============================================================
// DOWNLOAD ORCHESTRATION & COMPLIANCE ENGINE
// ============================================================

export interface DownloadPackOptions {
  storage?: IOfflineMapStorage;
  signal?: AbortSignal;
  onProgress?: (progress: DownloadProgress) => void;
  fetchTileImpl?: (
    z: number,
    x: number,
    y: number,
    template: string,
    signal?: AbortSignal
  ) => Promise<{ blob: Blob; contentType: string; sizeBytes: number }>;
}

/**
 * Downloads and stores all tiles covering an offline map pack.
 * Enforces rate limiting, prevents duplicate downloads, supports cancellation,
 * and verifies integrity before marking pack READY.
 */
export async function downloadOfflinePack(
  packId: string,
  options: DownloadPackOptions = {}
): Promise<OfflineMapPack> {
  const storage = options.storage ?? getOfflineStorage();
  const pack = (await storage.getPack(packId)) ?? DEFAULT_OFFLINE_PACKS[packId];
  if (!pack) {
    throw new Error(`Offline map pack '${packId}' not found.`);
  }

  const settings = await storage.getSettings();

  // Compliance check: Disallow bulk scraping from OpenStreetMap standard tile servers
  if (settings.tileSourceTemplate.includes('tile.openstreetmap.org')) {
    pack.status = 'ERROR';
    pack.error =
      'OSM Policy Compliance: Bulk downloading directly from standard tile.openstreetmap.org servers is prohibited. Use an authorized local tile server, MBTiles proxy, or synthetic tactical tiles.';
    await storage.putPack(pack);
    throw new Error(pack.error);
  }

  const tilesToDownload = computeTilesForBounds(pack.bounds, pack.minZoom, pack.maxZoom);
  const totalCount = tilesToDownload.length;

  pack.totalTiles = totalCount;
  pack.status = 'DOWNLOADING';
  pack.error = null;
  await storage.putPack(pack);

  let downloadedCount = 0;
  let failedCount = 0;
  let accumulatedBytes = 0;

  const fetchTile =
    options.fetchTileImpl ??
    (async (z: number, x: number, y: number, template: string, signal?: AbortSignal) => {
      // Compliance check: Disallow bulk scraping from OpenStreetMap standard tile servers
      if (template.includes('tile.openstreetmap.org')) {
        throw new Error(
          'OSM Policy Compliance: Bulk downloading directly from standard tile.openstreetmap.org servers is prohibited. Use an authorized local tile server, MBTiles proxy, or synthetic tactical tiles.'
        );
      }

      if (template === 'TACTICAL_SYNTHETIC') {
        // High-reliability offline tactical base tile generator
        const svg = generateTacticalTileSvg(z, x, y, pack.name);
        const blob = svgToBlob(svg);
        return {
          blob,
          contentType: 'image/svg+xml',
          sizeBytes: blob.size,
        };
      }

      // External HTTP tile download from operator-configured authorized server
      const url = template
        .replace('{packId}', packId)
        .replace('{z}', String(z))
        .replace('{x}', String(x))
        .replace('{y}', String(y));

      try {
        const res = await fetch(url, { signal, headers: { Accept: 'image/png,image/jpeg,image/*' } });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status} fetching tile ${z}/${x}/${y}`);
        }
        const blob = await res.blob();
        const arrayBuf = await blob.arrayBuffer();
        const isPng = isPngBuffer(arrayBuf);
        return {
          blob,
          contentType: isPng ? 'image/png' : blob.type || 'image/png',
          sizeBytes: blob.size,
        };
      } catch (err: unknown) {
        if (template.includes('127.0.0.1:8080') || template.includes('localhost:8080')) {
          throw new Error(
            `Local tile server unreachable at ${url}. Start server/offlineServer.mjs or start_offline_gcs.bat to serve real geographic tiles.`
          );
        }
        throw err;
      }
    });

  for (let i = 0; i < totalCount; i++) {
    if (options.signal?.aborted) {
      pack.status = 'PARTIAL';
      pack.downloadedTiles = downloadedCount;
      pack.failedTiles = failedCount;
      pack.actualSizeBytes = accumulatedBytes;
      await storage.putPack(pack);
      throw new Error(`Download of pack '${packId}' cancelled by operator.`);
    }

    const { z, x, y } = tilesToDownload[i];
    const key = makeTileKey(z, x, y);

    try {
      // Deduplication check: check if tile already exists in storage
      const existing = await storage.getTile(z, x, y);
      if (existing) {
        // Tile already present: ensure this packId is recorded in its packIds list
        if (!existing.packIds.includes(packId)) {
          existing.packIds.push(packId);
          await storage.putTile(existing);
        }
        downloadedCount++;
        accumulatedBytes += existing.sizeBytes;
      } else {
        // Fetch new tile
        const result = await fetchTile(z, x, y, settings.tileSourceTemplate, options.signal);
        const record: OfflineTileRecord = {
          key,
          z,
          x,
          y,
          packIds: [packId],
          blob: result.blob,
          contentType: result.contentType,
          sizeBytes: result.sizeBytes,
          timestamp: Date.now(),
        };
        await storage.putTile(record);
        downloadedCount++;
        accumulatedBytes += result.sizeBytes;

        // Respectful download throttle (non-blocking yield)
        await new Promise((r) => setTimeout(r, 10));
      }
    } catch (err: unknown) {
      if (options.signal?.aborted) {
        pack.status = 'PARTIAL';
        pack.downloadedTiles = downloadedCount;
        pack.failedTiles = failedCount;
        pack.actualSizeBytes = accumulatedBytes;
        await storage.putPack(pack);
        throw new Error(`Download of pack '${packId}' cancelled by operator.`);
      }
      failedCount++;
    }

    if (options.onProgress) {
      options.onProgress({
        packId,
        downloaded: downloadedCount,
        failed: failedCount,
        total: totalCount,
        percent: Math.round(((downloadedCount + failedCount) / totalCount) * 100),
        currentTile: { z, x, y },
      });
    }
  }

  // Verification: Verify stored tiles match expected count and validate real raster format
  let verifiedCount = 0;
  let allRealRaster = true;
  for (const { z, x, y } of tilesToDownload) {
    const tileRecord = await storage.getTile(z, x, y);
    if (tileRecord) {
      verifiedCount++;
      if (tileRecord.contentType !== 'image/png') {
        allRealRaster = false;
      }
    }
  }

  pack.downloadedTiles = verifiedCount;
  pack.failedTiles = totalCount - verifiedCount;
  pack.actualSizeBytes = accumulatedBytes;
  pack.lastDownloadedAt = Date.now();
  pack.isRealGeographic = allRealRaster && verifiedCount === totalCount;
  pack.tileFormat = allRealRaster ? 'PNG_RASTER' : 'SYNTHETIC_SVG';

  if (verifiedCount === totalCount) {
    pack.status = 'READY';
    pack.error = null;
  } else if (verifiedCount > 0) {
    pack.status = 'PARTIAL';
    pack.error = `${totalCount - verifiedCount} tiles failed to verify.`;
  } else {
    pack.status = 'ERROR';
    pack.error = 'No tiles could be stored.';
  }

  await storage.putPack(pack);
  return pack;
}

/**
 * Checks whether given coordinates are covered by any currently READY offline pack.
 */
export async function checkOfflineCoverage(
  lat: number,
  lon: number,
  storage = getOfflineStorage()
): Promise<{
  covered: boolean;
  matchingPacks: OfflineMapPack[];
  readyPacks: OfflineMapPack[];
}> {
  const packs = await storage.listPacks();
  const readyPacks = packs.filter((p) => p.status === 'READY');
  const matchingPacks = readyPacks.filter((p) => isCoordinateInBounds(lat, lon, p.bounds));

  return {
    covered: matchingPacks.length > 0,
    matchingPacks,
    readyPacks,
  };
}

/**
 * Validates whether a telemetry packet contains a usable, genuine GPS coordinate fix.
 * Rejects nulls, NO_FIX, 0 satellites, and (0, 0) Null Island.
 */
export function isPacketGpsValid(
  p: TelemetryPacket | null | undefined
): p is TelemetryPacket & { latitude: number; longitude: number } {
  if (!p) return false;
  if (p.gpsValid === false || p.gpsFixType === 'NO_FIX') return false;
  if (typeof p.gpsSats === 'number' && p.gpsSats <= 0) return false;
  if (typeof p.latitude !== 'number' || typeof p.longitude !== 'number') return false;
  return isValidCoordinateFix(p.latitude, p.longitude, true);
}

