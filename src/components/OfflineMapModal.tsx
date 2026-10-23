/**
 * CAN-7USAT Ground Control Station — Offline Map Packs Modal
 * Team Parikshit (Team 017 | 2026-IN-SPACe-CAN-7USAT-017)
 *
 * Operational dialog to manage, inspect, download, customize, expand,
 * and delete offline map packs for Manipal, Kushinagar, Tamkuhi Raj,
 * and custom operator-defined recovery envelopes.
 */

import React, { useEffect, useState, useRef, useMemo } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  Download,
  HardDrive,
  Info,
  Layers,
  Loader2,
  MapPin,
  Maximize2,
  Plus,
  RefreshCw,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import {
  checkLocalTileServerHealth,
  countTilesForBounds,
  createOrUpdateCustomPack,
  DownloadProgress,
  downloadOfflinePack,
  estimatePackStorage,
  expandBoundsByKm,
  formatBytes,
  getOfflineStorage,
  OfflineMapPack,
  OfflineMapSettings,
  StorageEstimateInfo,
} from '../services/offlineMapService';

interface OfflineMapModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPacksChanged?: () => void;
  onToggleForceOffline?: (forceOffline: boolean) => void;
}

export const OfflineMapModal: React.FC<OfflineMapModalProps> = ({
  isOpen,
  onClose,
  onPacksChanged,
  onToggleForceOffline,
}) => {
  const [packs, setPacks] = useState<OfflineMapPack[]>([]);
  const [settings, setSettings] = useState<OfflineMapSettings | null>(null);
  const [storageEstimate, setStorageEstimate] = useState<StorageEstimateInfo | null>(null);
  const [activeDownloadPackId, setActiveDownloadPackId] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [localServerOnline, setLocalServerOnline] = useState<boolean>(false);

  // Operator Region & Zoom Level Customization
  const [showRegionEditor, setShowRegionEditor] = useState<boolean>(false);
  const [editingPackId, setEditingPackId] = useState<string>('custom');
  const [editorName, setEditorName] = useState<string>('Custom Recovery Envelope');
  const [editorPurpose, setEditorPurpose] = useState<string>('Landing recovery & search envelope');
  const [editorSouth, setEditorSouth] = useState<string>('26.6900');
  const [editorWest, setEditorWest] = useState<string>('83.8300');
  const [editorNorth, setEditorNorth] = useState<string>('26.7900');
  const [editorEast, setEditorEast] = useState<string>('83.9500');
  const [editorMinZoom, setEditorMinZoom] = useState<number>(11);
  const [editorMaxZoom, setEditorMaxZoom] = useState<number>(15);

  const abortControllerRef = useRef<AbortController | null>(null);

  const loadData = async () => {
    try {
      const storage = getOfflineStorage();
      const [allPacks, currentSettings, estimate, serverHealth] = await Promise.all([
        storage.listPacks(),
        storage.getSettings(),
        storage.getStorageEstimate(),
        checkLocalTileServerHealth(),
      ]);
      setPacks(allPacks);
      setSettings(currentSettings);
      setStorageEstimate(estimate);
      setLocalServerOnline(serverHealth.online);
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Failed to load offline map data.');
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen]);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const parsedBounds = useMemo<[number, number, number, number] | null>(() => {
    const s = parseFloat(editorSouth);
    const w = parseFloat(editorWest);
    const n = parseFloat(editorNorth);
    const e = parseFloat(editorEast);
    if (!Number.isFinite(s) || !Number.isFinite(w) || !Number.isFinite(n) || !Number.isFinite(e)) {
      return null;
    }
    if (s >= n || w >= e) return null;
    if (s < -85 || n > 85 || w < -180 || e > 180) return null;
    return [s, w, n, e];
  }, [editorSouth, editorWest, editorNorth, editorEast]);

  const editorTileCount = useMemo(() => {
    if (!parsedBounds || editorMinZoom > editorMaxZoom) return 0;
    return countTilesForBounds(parsedBounds, editorMinZoom, editorMaxZoom);
  }, [parsedBounds, editorMinZoom, editorMaxZoom]);

  const editorEstimatedBytes = useMemo(() => {
    return estimatePackStorage(editorTileCount);
  }, [editorTileCount]);

  const isExcessiveTiles = editorTileCount > 1000;

  if (!isOpen) return null;

  const handleStartDownload = async (packId: string) => {
    setActionError(null);
    setActiveDownloadPackId(packId);
    setDownloadProgress(null);

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      await downloadOfflinePack(packId, {
        signal: abortController.signal,
        onProgress: (prog) => {
          setDownloadProgress(prog);
        },
      });
      await loadData();
      if (onPacksChanged) onPacksChanged();
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== 'AbortError') {
        setActionError(err.message);
      }
      await loadData();
    } finally {
      setActiveDownloadPackId(null);
      setDownloadProgress(null);
      abortControllerRef.current = null;
    }
  };

  const handleCancelDownload = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  };

  const handleDeletePack = async (packId: string) => {
    setActionError(null);
    try {
      const storage = getOfflineStorage();
      await storage.deletePack(packId);
      await loadData();
      if (onPacksChanged) onPacksChanged();
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Failed to delete offline pack.');
    }
  };

  const handleToggleForceOffline = async () => {
    if (!settings) return;
    const nextSettings: OfflineMapSettings = {
      ...settings,
      forceOffline: !settings.forceOffline,
    };
    try {
      const storage = getOfflineStorage();
      await storage.putSettings(nextSettings);
      setSettings(nextSettings);
      if (onToggleForceOffline) {
        onToggleForceOffline(nextSettings.forceOffline);
      }
      if (onPacksChanged) onPacksChanged();
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Failed to update settings.');
    }
  };

  const handleToggleShowCoverage = async () => {
    if (!settings) return;
    const nextSettings: OfflineMapSettings = {
      ...settings,
      showCoverageBounds: !settings.showCoverageBounds,
    };
    try {
      const storage = getOfflineStorage();
      await storage.putSettings(nextSettings);
      setSettings(nextSettings);
      if (onPacksChanged) onPacksChanged();
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Failed to update settings.');
    }
  };

  const handleLoadPresetToEditor = (presetId: string) => {
    const found = packs.find((p) => p.id === presetId);
    if (!found) return;
    setEditingPackId(found.id);
    setEditorName(found.name);
    setEditorPurpose(found.purpose);
    setEditorSouth(found.bounds[0].toFixed(4));
    setEditorWest(found.bounds[1].toFixed(4));
    setEditorNorth(found.bounds[2].toFixed(4));
    setEditorEast(found.bounds[3].toFixed(4));
    setEditorMinZoom(found.minZoom);
    setEditorMaxZoom(found.maxZoom);
    setShowRegionEditor(true);
  };

  const handleExpandBounds = (km: number) => {
    if (!parsedBounds) return;
    const expanded = expandBoundsByKm(parsedBounds, km);
    setEditorSouth(expanded[0].toFixed(4));
    setEditorWest(expanded[1].toFixed(4));
    setEditorNorth(expanded[2].toFixed(4));
    setEditorEast(expanded[3].toFixed(4));
  };

  const handleSaveAndDownloadCustomPack = async () => {
    if (!parsedBounds) {
      setActionError('Invalid bounds: ensure South < North and West < East.');
      return;
    }
    if (editorMinZoom > editorMaxZoom) {
      setActionError('Invalid zoom range: Min Zoom must be <= Max Zoom.');
      return;
    }

    try {
      const storage = getOfflineStorage();
      const pack = await createOrUpdateCustomPack(
        {
          id: editingPackId,
          name: editorName,
          purpose: editorPurpose,
          bounds: parsedBounds,
          minZoom: editorMinZoom,
          maxZoom: editorMaxZoom,
        },
        storage
      );
      await loadData();
      if (onPacksChanged) onPacksChanged();
      setShowRegionEditor(false);
      await handleStartDownload(pack.id);
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Failed to save custom pack.');
    }
  };

  const readyPacksCount = packs.filter((p) => p.status === 'READY').length;

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 overflow-y-auto">
      <div className="bg-[var(--bg-surface-1)] border border-[var(--border-strong)] max-w-xl w-full p-4 text-xs text-[var(--text-primary)] shadow-[var(--shadow-lg)] space-y-3 rounded-[var(--radius-md)] my-8">
        {/* Modal Header */}
        <div className="flex justify-between items-center border-b border-[var(--border-subtle)] pb-2.5">
          <div className="flex items-center gap-2">
            <HardDrive className="w-4 h-4 text-[var(--accent-cobalt)]" />
            <span className="font-bold text-sm text-[var(--text-primary)] tracking-tight">
              Offline Map Packs (IndexedDB &amp; MBTiles)
            </span>
            <span className="px-1.5 py-0.5 rounded text-[10px] font-mono-data font-semibold bg-[var(--accent-cobalt-soft)] text-[var(--accent-cobalt)] border border-[var(--accent-cobalt)]/30">
              {readyPacksCount} / {packs.length} Ready
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Network & Simulation Bar */}
        <div className="bg-[var(--bg-surface-2)] border border-[var(--border-subtle)] p-2.5 rounded-[var(--radius-sm)] flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-medium text-[var(--text-secondary)]">Network:</span>
            {isOnline ? (
              <span className="inline-flex items-center gap-1 text-[10px] font-mono-data font-semibold text-[var(--status-nominal)] bg-[var(--status-nominal-bg)] border border-[var(--status-nominal)]/30 px-1.5 py-0.5 rounded">
                <Wifi className="w-3 h-3" /> ONLINE
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[10px] font-mono-data font-semibold text-[var(--status-warning)] bg-[var(--status-warning-bg)] border border-[var(--status-warning)]/30 px-1.5 py-0.5 rounded">
                <WifiOff className="w-3 h-3" /> OFFLINE
              </span>
            )}

            <span className="text-[11px] font-medium text-[var(--text-secondary)] ml-1">Server:</span>
            {localServerOnline ? (
              <span className="inline-flex items-center gap-1 text-[10px] font-mono-data font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-1.5 py-0.5 rounded" title="Local MBTiles and tile server running on 127.0.0.1:8080">
                <Server className="w-3 h-3 text-emerald-400" /> LOCAL ACTIVE
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[10px] font-mono-data font-semibold text-[var(--text-tertiary)] bg-slate-800/40 border border-slate-700/40 px-1.5 py-0.5 rounded" title="Run server/offlineServer.mjs or start_offline_gcs.bat for local MBTiles serving">
                <Server className="w-3 h-3" /> LOCAL OFFLINE
              </span>
            )}

            {settings?.forceOffline && (
              <span className="inline-flex items-center gap-1 text-[10px] font-mono-data font-semibold text-[var(--accent-amber)] bg-[var(--status-warning-bg)] border border-[var(--accent-amber)]/40 px-1.5 py-0.5 rounded">
                FORCED OFFLINE ACTIVE
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 cursor-pointer text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] select-none">
              <input
                type="checkbox"
                checked={settings?.forceOffline ?? false}
                onChange={handleToggleForceOffline}
                className="rounded border-[var(--border-subtle)] text-[var(--accent-cobalt)] focus:ring-0 cursor-pointer"
              />
              <span>Simulate Offline</span>
            </label>

            <label className="flex items-center gap-1.5 cursor-pointer text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] select-none">
              <input
                type="checkbox"
                checked={settings?.showCoverageBounds ?? true}
                onChange={handleToggleShowCoverage}
                className="rounded border-[var(--border-subtle)] text-[var(--accent-cobalt)] focus:ring-0 cursor-pointer"
              />
              <span>Show Bounds</span>
            </label>
          </div>
        </div>

        {/* Storage Gauge & Status */}
        {storageEstimate && (
          <div className="bg-[var(--bg-surface-2)]/70 border border-[var(--border-subtle)] px-3 py-2 rounded-[var(--radius-sm)] flex items-center justify-between text-[11px]">
            <div className="flex items-center gap-2">
              <HardDrive className="w-3.5 h-3.5 text-[var(--text-tertiary)]" />
              <span className="text-[var(--text-secondary)]">Storage Footprint:</span>
              <span className="font-mono-data font-bold text-[var(--text-primary)]">
                {formatBytes(storageEstimate.usageBytes)}
              </span>
              <span className="text-[var(--text-tertiary)]">
                ({storageEstimate.totalStoredTiles} tiles stored)
              </span>
            </div>
            <div className="text-[10px] text-[var(--text-tertiary)]">
              Budget: {settings?.storageBudgetMb ?? 250} MB
            </div>
          </div>
        )}

        {/* Action / Error Banner */}
        {actionError && (
          <div className="bg-[var(--status-alert-bg)] border border-[var(--status-alert)]/40 text-[var(--status-alert)] px-3 py-2 rounded-[var(--radius-sm)] text-[11px] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{actionError}</span>
            </div>
            <button
              type="button"
              onClick={() => setActionError(null)}
              className="text-xs underline cursor-pointer ml-2"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Active Download Progress Card */}
        {activeDownloadPackId && downloadProgress && (
          <div className="bg-[var(--accent-cobalt-soft)] border border-[var(--accent-cobalt)]/40 p-3 rounded-[var(--radius-sm)] space-y-2">
            <div className="flex justify-between items-center text-[11px]">
              <div className="flex items-center gap-2 font-semibold text-[var(--accent-cobalt)]">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Downloading {packs.find((p) => p.id === activeDownloadPackId)?.name}...</span>
              </div>
              <span className="font-mono-data font-bold text-[var(--accent-cobalt)]">
                {downloadProgress.percent}%
              </span>
            </div>

            <div className="w-full bg-[var(--bg-surface-2)] h-1.5 rounded-full overflow-hidden">
              <div
                className="bg-[var(--accent-cobalt)] h-full transition-all duration-150"
                style={{ width: `${downloadProgress.percent}%` }}
              />
            </div>

            <div className="flex justify-between items-center text-[10px] text-[var(--text-secondary)]">
              <span>
                Tiles: {downloadProgress.downloaded} / {downloadProgress.total} (Failed: {downloadProgress.failed})
              </span>
              <button
                type="button"
                onClick={handleCancelDownload}
                className="px-2 py-0.5 bg-[var(--status-alert-bg)] text-[var(--status-alert)] border border-[var(--status-alert)]/30 rounded font-semibold hover:bg-[var(--status-alert)] hover:text-white cursor-pointer"
              >
                Cancel Download
              </button>
            </div>
          </div>
        )}

        {/* Regional Packs Header & Custom Region Toggle */}
        <div className="flex items-center justify-between pt-1">
          <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">
            Regional Map Packs
          </span>
          <button
            type="button"
            onClick={() => setShowRegionEditor(!showRegionEditor)}
            className="text-[11px] font-semibold text-[var(--accent-cobalt)] hover:text-[var(--accent-cobalt-hover)] flex items-center gap-1 cursor-pointer"
          >
            {showRegionEditor ? (
              <>
                <ChevronUp className="w-3.5 h-3.5" /> Close Region Editor
              </>
            ) : (
              <>
                <Plus className="w-3.5 h-3.5" /> Custom / Expand Region
              </>
            )}
          </button>
        </div>

        {/* Operator Region & Detail Level Editor */}
        {showRegionEditor && (
          <div className="bg-[var(--bg-surface-2)] border border-[var(--accent-cobalt)]/40 p-3 rounded-[var(--radius-sm)] space-y-3">
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-1.5">
              <div className="flex items-center gap-1.5">
                <SlidersHorizontal className="w-3.5 h-3.5 text-[var(--accent-cobalt)]" />
                <span className="font-bold text-[11px] text-[var(--text-primary)]">
                  Configure Region &amp; Detail Level (Z{editorMinZoom}–Z{editorMaxZoom})
                </span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-[var(--text-tertiary)]">Presets:</span>
                {packs.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handleLoadPresetToEditor(p.id)}
                    className="px-1.5 py-0.5 bg-[var(--bg-base)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border-subtle)] rounded text-[9px] cursor-pointer"
                  >
                    {p.id}
                  </button>
                ))}
              </div>
            </div>

            {/* Name & Purpose */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <label className="text-[9px] uppercase font-semibold text-[var(--text-tertiary)] block mb-0.5">
                  Region Name
                </label>
                <input
                  type="text"
                  value={editorName}
                  onChange={(e) => setEditorName(e.target.value)}
                  className="w-full bg-[var(--bg-base)] border border-[var(--border-subtle)] focus:border-[var(--accent-cobalt)] px-2 py-1 text-[11px] rounded outline-none"
                />
              </div>
              <div>
                <label className="text-[9px] uppercase font-semibold text-[var(--text-tertiary)] block mb-0.5">
                  Operational Purpose
                </label>
                <input
                  type="text"
                  value={editorPurpose}
                  onChange={(e) => setEditorPurpose(e.target.value)}
                  className="w-full bg-[var(--bg-base)] border border-[var(--border-subtle)] focus:border-[var(--accent-cobalt)] px-2 py-1 text-[11px] rounded outline-none"
                />
              </div>
            </div>

            {/* Geographic Bounding Box */}
            <div>
              <div className="flex justify-between items-center mb-1">
                <span className="text-[9px] uppercase font-semibold text-[var(--text-tertiary)]">
                  Geographic Bounding Box (Decimal Degrees)
                </span>
                <div className="flex items-center gap-1.5">
                  <span className="text-[9px] text-[var(--text-tertiary)]">Expand Envelope:</span>
                  <button
                    type="button"
                    onClick={() => handleExpandBounds(1)}
                    className="px-1.5 py-0.5 bg-[var(--bg-base)] hover:bg-[var(--bg-surface-1)] text-[var(--accent-cobalt)] border border-[var(--accent-cobalt)]/30 rounded text-[9px] font-semibold cursor-pointer"
                  >
                    +1 km Buffer
                  </button>
                  <button
                    type="button"
                    onClick={() => handleExpandBounds(5)}
                    className="px-1.5 py-0.5 bg-[var(--bg-base)] hover:bg-[var(--bg-surface-1)] text-[var(--accent-cobalt)] border border-[var(--accent-cobalt)]/30 rounded text-[9px] font-semibold cursor-pointer"
                  >
                    +5 km Buffer
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-4 gap-1.5 font-mono-data text-[10px]">
                <div>
                  <label className="text-[8px] text-[var(--text-tertiary)] block">North (°N)</label>
                  <input
                    type="text"
                    value={editorNorth}
                    onChange={(e) => setEditorNorth(e.target.value)}
                    className="w-full bg-[var(--bg-base)] border border-[var(--border-subtle)] focus:border-[var(--accent-cobalt)] px-1.5 py-1 rounded text-center outline-none"
                  />
                </div>
                <div>
                  <label className="text-[8px] text-[var(--text-tertiary)] block">South (°N)</label>
                  <input
                    type="text"
                    value={editorSouth}
                    onChange={(e) => setEditorSouth(e.target.value)}
                    className="w-full bg-[var(--bg-base)] border border-[var(--border-subtle)] focus:border-[var(--accent-cobalt)] px-1.5 py-1 rounded text-center outline-none"
                  />
                </div>
                <div>
                  <label className="text-[8px] text-[var(--text-tertiary)] block">West (°E)</label>
                  <input
                    type="text"
                    value={editorWest}
                    onChange={(e) => setEditorWest(e.target.value)}
                    className="w-full bg-[var(--bg-base)] border border-[var(--border-subtle)] focus:border-[var(--accent-cobalt)] px-1.5 py-1 rounded text-center outline-none"
                  />
                </div>
                <div>
                  <label className="text-[8px] text-[var(--text-tertiary)] block">East (°E)</label>
                  <input
                    type="text"
                    value={editorEast}
                    onChange={(e) => setEditorEast(e.target.value)}
                    className="w-full bg-[var(--bg-base)] border border-[var(--border-subtle)] focus:border-[var(--accent-cobalt)] px-1.5 py-1 rounded text-center outline-none"
                  />
                </div>
              </div>
            </div>

            {/* Zoom Range Detail Level */}
            <div className="grid grid-cols-2 gap-2 pt-1 border-t border-[var(--border-subtle)]">
              <div>
                <label className="text-[9px] uppercase font-semibold text-[var(--text-tertiary)] block mb-0.5">
                  Min Zoom Level (Wider Overview)
                </label>
                <select
                  value={editorMinZoom}
                  onChange={(e) => setEditorMinZoom(Number(e.target.value))}
                  className="w-full bg-[var(--bg-base)] border border-[var(--border-subtle)] text-[11px] p-1 rounded outline-none"
                >
                  {[9, 10, 11, 12, 13, 14].map((z) => (
                    <option key={z} value={z}>
                      Zoom {z} ({Math.round(40075 / Math.pow(2, z))} km/tile)
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[9px] uppercase font-semibold text-[var(--text-tertiary)] block mb-0.5">
                  Max Native Zoom (Street/Terrain Detail)
                </label>
                <select
                  value={editorMaxZoom}
                  onChange={(e) => setEditorMaxZoom(Number(e.target.value))}
                  className="w-full bg-[var(--bg-base)] border border-[var(--border-subtle)] text-[11px] p-1 rounded outline-none"
                >
                  {[12, 13, 14, 15, 16].map((z) => (
                    <option key={z} value={z}>
                      Zoom {z} (Scales cleanly to Z19 in GCS)
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Live Calculation Readout & Excessive Tile Warning */}
            <div className="flex flex-wrap items-center justify-between gap-2 p-2 bg-[var(--bg-base)] border border-[var(--border-subtle)] rounded text-[10px]">
              <div>
                <span className="text-[var(--text-tertiary)]">Estimated Tiles: </span>
                <strong className="text-[var(--text-primary)] font-mono-data">{editorTileCount} tiles</strong>
                <span className="text-[var(--text-tertiary)] ml-2">Estimated Size: </span>
                <strong className="text-[var(--text-primary)] font-mono-data">
                  {formatBytes(editorEstimatedBytes)}
                </strong>
              </div>

              {isExcessiveTiles && (
                <span className="text-[var(--status-warning)] font-semibold flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> &gt;1,000 tiles: large download budget
                </span>
              )}

              <button
                type="button"
                onClick={handleSaveAndDownloadCustomPack}
                disabled={!parsedBounds || editorTileCount === 0 || !!activeDownloadPackId}
                className="px-3 py-1 bg-[var(--accent-cobalt)] hover:bg-[var(--accent-cobalt-hover)] text-white font-semibold rounded text-[10px] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
              >
                <Download className="w-3 h-3" /> Save &amp; Download Region
              </button>
            </div>
          </div>
        )}

        {/* Regional Packs List */}
        <div className="space-y-2 max-h-[300px] overflow-y-auto pr-0.5">
          {packs.map((pack) => {
            const isReady = pack.status === 'READY';
            const isDownloading = activeDownloadPackId === pack.id;

            return (
              <div
                key={pack.id}
                className={`p-3 rounded-[var(--radius-sm)] border transition-colors ${
                  isReady
                    ? 'bg-[var(--bg-surface-2)] border-[var(--status-nominal)]/30'
                    : 'bg-[var(--bg-surface-2)] border-[var(--border-subtle)]'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-0.5 min-w-0">
                    <div className="flex items-center gap-2">
                      <MapPin className="w-3.5 h-3.5 text-[var(--accent-cobalt)] shrink-0" />
                      <span className="font-bold text-xs text-[var(--text-primary)] truncate">
                        {pack.name}
                      </span>
                      {isReady && (
                        <>
                          <span className="px-1.5 py-0.2 bg-[var(--status-nominal-bg)] text-[var(--status-nominal)] border border-[var(--status-nominal)]/30 rounded text-[9px] font-mono-data font-semibold flex items-center gap-0.5">
                            <Check className="w-2.5 h-2.5" /> READY
                          </span>
                          {pack.isRealGeographic !== false ? (
                            <span className="px-1.5 py-0.2 bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 rounded text-[9px] font-mono-data font-semibold">
                              Real Geographic (ODbL)
                            </span>
                          ) : (
                            <span className="px-1.5 py-0.2 bg-amber-500/15 text-amber-300 border border-amber-500/30 rounded text-[9px] font-mono-data font-semibold">
                              Tactical Grid
                            </span>
                          )}
                        </>
                      )}
                      {pack.status === 'PARTIAL' && (
                        <span className="px-1.5 py-0.2 bg-[var(--status-warning-bg)] text-[var(--status-warning)] border border-[var(--status-warning)]/30 rounded text-[9px] font-mono-data font-semibold">
                          PARTIAL ({pack.downloadedTiles}/{pack.totalTiles})
                        </span>
                      )}
                      {pack.status === 'NOT_DOWNLOADED' && (
                        <span className="px-1.5 py-0.2 bg-slate-700/30 text-slate-400 border border-slate-700/50 rounded text-[9px] font-mono-data font-medium">
                          NOT DOWNLOADED
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-[var(--text-secondary)]">{pack.purpose}</p>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleLoadPresetToEditor(pack.id)}
                      className="px-2 py-1 bg-[var(--bg-surface-1)] hover:bg-[var(--bg-surface-2)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border-subtle)] rounded text-[10px] font-medium cursor-pointer flex items-center gap-1 transition-colors"
                      title="Adjust region bounds or zoom level"
                    >
                      <Maximize2 className="w-3 h-3" /> Expand
                    </button>

                    {isReady ? (
                      <button
                        type="button"
                        onClick={() => handleDeletePack(pack.id)}
                        disabled={isDownloading || !!activeDownloadPackId}
                        className="px-2 py-1 bg-[var(--bg-surface-1)] hover:bg-[var(--status-alert-bg)] text-[var(--text-secondary)] hover:text-[var(--status-alert)] border border-[var(--border-subtle)] hover:border-[var(--status-alert)]/30 rounded text-[10px] font-medium cursor-pointer flex items-center gap-1 transition-colors disabled:opacity-50"
                        title="Delete stored offline tiles for this pack"
                      >
                        <Trash2 className="w-3 h-3" /> Delete
                      </button>
                    ) : null}

                    <button
                      type="button"
                      onClick={() => handleStartDownload(pack.id)}
                      disabled={isDownloading || !!activeDownloadPackId}
                      className={`px-2.5 py-1 rounded text-[10px] font-semibold cursor-pointer flex items-center gap-1 transition-colors disabled:opacity-50 ${
                        isReady
                          ? 'bg-[var(--bg-surface-1)] hover:bg-[var(--bg-surface-2)] text-[var(--text-primary)] border border-[var(--border-subtle)]'
                          : 'bg-[var(--accent-cobalt)] hover:bg-[var(--accent-cobalt-hover)] text-white'
                      }`}
                    >
                      {isReady ? (
                        <>
                          <RefreshCw className="w-3 h-3" /> Update
                        </>
                      ) : (
                        <>
                          <Download className="w-3 h-3" /> Download Pack
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* Pack Detail Specs */}
                <div className="mt-2 pt-2 border-t border-[var(--border-subtle)] flex flex-wrap items-center justify-between text-[10px] font-mono-data text-[var(--text-tertiary)] gap-y-1">
                  <div>
                    Centre: {pack.center[0].toFixed(2)}°N, {pack.center[1].toFixed(2)}°E
                  </div>
                  <div>
                    Zooms: Z{pack.minZoom}–Z{pack.maxZoom} ({pack.totalTiles} tiles)
                  </div>
                  <div>
                    Est. Size: {formatBytes(pack.estimatedSizeBytes)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Compliance & Policy Footer Note */}
        <div className="bg-[var(--bg-surface-2)]/60 border border-[var(--border-subtle)] p-2 rounded-[var(--radius-sm)] flex items-start gap-2 text-[10px] text-[var(--text-tertiary)] leading-relaxed">
          <ShieldCheck className="w-3.5 h-3.5 text-[var(--accent-teal)] shrink-0 mt-0.5" />
          <span>
            <strong>Legal &amp; Operational Compliance:</strong> Real geographic raster tiles for Manipal, Kushinagar, and Tamkuhi Raj are sourced from OpenStreetMap under the Open Database License (ODbL 1.0). Tiles are served locally via SQLite MBTiles and cached in browser IndexedDB with zero external network requests. Automated scraping of standard public tile servers is strictly blocked.
          </span>
        </div>

        {/* Modal Actions */}
        <div className="flex justify-between items-center pt-2 border-t border-[var(--border-subtle)]">
          <div className="text-[10px] text-[var(--text-tertiary)]">
            {readyPacksCount === packs.length ? (
              <span className="text-[var(--status-nominal)] font-semibold flex items-center gap-1">
                <Check className="w-3.5 h-3.5" /> All regional recovery packs ready
              </span>
            ) : (
              <span>Download packs before deploying to the field</span>
            )}
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="bg-[var(--accent-cobalt)] text-white font-semibold px-4 py-1.5 text-xs rounded cursor-pointer hover:bg-[var(--accent-cobalt-hover)] transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
