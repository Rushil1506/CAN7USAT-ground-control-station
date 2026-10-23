/**
 * CAN-7USAT Ground Control Station — Clean Leaflet Tile Layer
 * Team Parikshit (Team 017 | 2026-IN-SPACe-CAN-7USAT-017)
 *
 * Implements a single, unified Leaflet TileLayer that:
 * 1. In ONLINE mode: Fetches directly from the verified geographic tile provider
 *    (OpenStreetMap, Esri Satellite, or CartoDB Dark).
 * 2. In OFFLINE mode: Resolves strictly from local MBTiles via the offline server
 *    (http://127.0.0.1:8080/tiles/{packId}/{z}/{x}/{y}.png) and IndexedDB cache.
 * 3. Gracefully delegates zoom levels > 15 to Leaflet's native auto-scaling
 *    (maxNativeZoom: 15, maxZoom: 19) without coordinate corruption.
 * 4. Renders a neutral, light-themed missing tile indicator outside coverage areas.
 */

import L from 'leaflet';
import {
  findPackForCoordinates,
  generateMissingTileSvg,
  getOfflineStorage,
  IOfflineMapStorage,
  LOCAL_TILE_SERVER_URL,
  svgToDataUrl,
  tileX2lon,
  tileY2lat,
} from './offlineMapService';

export type TileSourceMode = 'ONLINE' | 'OFFLINE';

export interface OfflineTileLayerOptions extends L.TileLayerOptions {
  onlineUrlTemplate?: string;
  sourceMode?: TileSourceMode;
  forceOffline?: boolean;
  allowOnlineFallback?: boolean;
  storage?: IOfflineMapStorage;
  packName?: string;
  activePackId?: string;
  localServerUrl?: string;
  maxNativeZoom?: number;
  maxZoom?: number;
  isDark?: boolean;
  onOnlineTileError?: (coords: L.Coords, error: Event | string) => void;
  onMissingOfflineTile?: (coords: L.Coords) => void;
  onTileResolved?: (
    coords: L.Coords,
    source: 'ONLINE' | 'INDEXEDDB' | 'LOCAL_SERVER' | 'MISSING_SVG'
  ) => void;
}

export class OfflineLeafletTileLayer extends L.TileLayer {
  private sourceMode: TileSourceMode;
  private forceOfflineMode: boolean;
  private isDark: boolean;
  private activePackId: string | null = null;
  private localServerUrl: string;
  private storageInstance: IOfflineMapStorage;
  private customOptions: OfflineTileLayerOptions;
  private objectUrls: Set<string> = new Set();

  constructor(urlTemplate: string, options: OfflineTileLayerOptions = {}) {
    const effectiveMaxNativeZoom = options.maxNativeZoom ?? 15;
    const effectiveMaxZoom = options.maxZoom ?? 19;
    const attribution =
      options.attribution || 'Data &copy; OpenStreetMap contributors | ODbL 1.0';

    super(urlTemplate, {
      maxZoom: effectiveMaxZoom,
      maxNativeZoom: effectiveMaxNativeZoom,
      subdomains: options.subdomains ?? 'abc',
      ...options,
      attribution,
    });

    this.customOptions = options;
    this.forceOfflineMode = options.forceOffline ?? false;
    this.isDark = options.isDark ?? false;
    this.sourceMode = this.forceOfflineMode
      ? 'OFFLINE'
      : options.sourceMode ??
        (typeof navigator !== 'undefined' && navigator.onLine ? 'ONLINE' : 'OFFLINE');
    this.activePackId = options.activePackId ?? options.packName ?? null;
    this.localServerUrl = options.localServerUrl ?? LOCAL_TILE_SERVER_URL;
    this.storageInstance = options.storage ?? getOfflineStorage();

    this.on('tileunload', (event: L.LeafletEvent) => {
      const tile = (event as unknown as { tile?: HTMLImageElement }).tile;
      if (tile && typeof tile.src === 'string' && tile.src.startsWith('blob:')) {
        URL.revokeObjectURL(tile.src);
        this.objectUrls.delete(tile.src);
      }
    });
  }

  public setSourceMode(mode: TileSourceMode): void {
    if (this.sourceMode !== mode) {
      this.sourceMode = mode;
      this.revokeAllObjectUrls();
      this.redraw();
    }
  }

  public getSourceMode(): TileSourceMode {
    return this.sourceMode;
  }

  public setForceOffline(enabled: boolean): void {
    this.forceOfflineMode = enabled;
    if (enabled) {
      this.sourceMode = 'OFFLINE';
    }
    this.revokeAllObjectUrls();
    this.redraw();
  }

  public isForceOffline(): boolean {
    return this.forceOfflineMode;
  }

  public setActivePack(packId: string | null): void {
    this.activePackId = packId;
    this.redraw();
  }

  public getActivePack(): string | null {
    return this.activePackId;
  }

  private revokeAllObjectUrls(): void {
    for (const url of this.objectUrls) {
      URL.revokeObjectURL(url);
    }
    this.objectUrls.clear();
  }

  public override getTileUrl(coords: L.Coords): string {
    if (this.sourceMode === 'ONLINE' && !this.forceOfflineMode) {
      return super.getTileUrl(coords);
    }

    // In OFFLINE mode: resolve target pack ID from coordinates or activePackId
    const midLat = tileY2lat(coords.y, coords.z);
    const midLon = tileX2lon(coords.x, coords.z);
    const pack = findPackForCoordinates(midLat, midLon);
    const packId = this.activePackId ?? (pack ? pack.id : null);

    if (packId) {
      return `${this.localServerUrl}/tiles/${packId}/${coords.z}/${coords.x}/${coords.y}.png`;
    }

    // Outside all known packs: return neutral missing tile SVG immediately
    return svgToDataUrl(generateMissingTileSvg(coords.z, coords.x, coords.y, this.isDark));
  }

  public override createTile(coords: L.Coords, done: L.DoneCallback): HTMLElement {
    const tile = document.createElement('img');
    tile.alt = '';
    tile.setAttribute('role', 'presentation');

    // 1. ONLINE MODE: standard Leaflet loading with error reporting
    if (this.sourceMode === 'ONLINE' && !this.forceOfflineMode) {
      const onlineUrl = this.getTileUrl(coords);
      tile.onload = () => {
        this.customOptions.onTileResolved?.(coords, 'ONLINE');
        done(null, tile);
      };
      tile.onerror = (e) => {
        this.customOptions.onOnlineTileError?.(coords, e as Event);
        // On online network failure, render missing tile indicator
        tile.src = svgToDataUrl(generateMissingTileSvg(coords.z, coords.x, coords.y, this.isDark));
        done(null, tile);
      };
      tile.src = onlineUrl;
      return tile;
    }

    // 2. OFFLINE MODE:
    const tileUrl = this.getTileUrl(coords);

    // If getTileUrl returned missing SVG (coords outside packs)
    if (tileUrl.startsWith('data:image/svg+xml')) {
      this.customOptions.onMissingOfflineTile?.(coords);
      this.customOptions.onTileResolved?.(coords, 'MISSING_SVG');
      tile.src = tileUrl;
      setTimeout(() => done(null, tile), 0);
      return tile;
    }

    // Try loading from local offline server
    tile.onload = () => {
      this.customOptions.onTileResolved?.(coords, 'LOCAL_SERVER');
      done(null, tile);
    };

    tile.onerror = () => {
      // Local server failed or returned 404: check IndexedDB fallback
      this.storageInstance
        .getTile(coords.z, coords.x, coords.y)
        .then((record) => {
          if (record && record.blob) {
            let blob: Blob;
            if (record.blob instanceof Blob) {
              blob = record.blob;
            } else {
              blob = new Blob([record.blob], { type: record.contentType || 'image/png' });
            }
            const objectUrl = URL.createObjectURL(blob);
            this.objectUrls.add(objectUrl);
            tile.onload = () => {
              this.customOptions.onTileResolved?.(coords, 'INDEXEDDB');
              done(null, tile);
            };
            tile.onerror = () => {
              this.fallbackToMissingSvg(coords, tile, done);
            };
            tile.src = objectUrl;
          } else {
            this.fallbackToMissingSvg(coords, tile, done);
          }
        })
        .catch(() => {
          this.fallbackToMissingSvg(coords, tile, done);
        });
    };

    tile.src = tileUrl;
    return tile;
  }

  private fallbackToMissingSvg(
    coords: L.Coords,
    tile: HTMLImageElement,
    done: L.DoneCallback
  ): void {
    this.customOptions.onMissingOfflineTile?.(coords);
    this.customOptions.onTileResolved?.(coords, 'MISSING_SVG');
    tile.onload = () => done(null, tile);
    tile.onerror = () => done(null, tile);
    tile.src = svgToDataUrl(generateMissingTileSvg(coords.z, coords.x, coords.y, this.isDark));
  }

  public override onRemove(map: L.Map): this {
    this.revokeAllObjectUrls();
    return super.onRemove(map);
  }
}

export function createOfflineTileLayer(
  urlTemplate: string,
  options: OfflineTileLayerOptions = {}
): OfflineLeafletTileLayer {
  return new OfflineLeafletTileLayer(urlTemplate, {
    maxZoom: 19,
    maxNativeZoom: 15,
    ...options,
  });
}
