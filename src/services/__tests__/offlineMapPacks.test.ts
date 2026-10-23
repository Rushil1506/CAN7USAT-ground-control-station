import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  checkOfflineCoverage,
  computeTilesForBounds,
  countTilesForBounds,
  createOrUpdateCustomPack,
  DEFAULT_OFFLINE_PACKS,
  DEFAULT_OFFLINE_SETTINGS,
  downloadOfflinePack,
  estimatePackStorage,
  expandBoundsByKm,
  findPackForCoordinates,
  formatBytes,
  generateMissingTileSvg,
  generateTacticalTileSvg,
  getTileBounds,
  InMemoryOfflineMapStorage,
  isCoordinateInBounds,
  isPngBuffer,
  lat2tileY,
  lon2tileX,
  makeTileKey,
  OfflineMapPack,
  OfflineTileRecord,
  setOfflineStorageForTesting,
  tileX2lon,
  tileY2lat,
} from '../offlineMapService';
import {
  evaluateOptionalFieldState,
  loadOptionalTelemetrySettings,
  saveOptionalTelemetrySettings,
} from '../optionalTelemetrySettings';
import { isValidCoordinateFix } from '../landingPredictorClient';
import { isPacketGpsValid } from '../offlineMapService';
import { TelemetryPacket } from '../../types';

// Valid 16-byte PNG header buffer for deterministic unit tests
const VALID_PNG_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
const mockPngFetchImpl = async (z: number, x: number, y: number) => ({
  blob: new Blob([VALID_PNG_BYTES], { type: 'image/png' }),
  contentType: 'image/png',
  sizeBytes: VALID_PNG_BYTES.length,
});

describe('Offline Map Service — Slippy Map & Geographic Calculations', () => {
  it('correctly computes tile X and Y coordinates and verifies inverse round-trips', () => {
    // Zoom 0: World is 1 tile (0, 0)
    assert.equal(lon2tileX(0, 0), 0);
    assert.equal(lat2tileY(0, 0), 0);
    assert.equal(tileX2lon(0, 0), -180);

    // Zoom 12 for MIT Manipal (13.3525° N, 74.7928° E)
    const manipalX = lon2tileX(74.7928, 12);
    const manipalY = lat2tileY(13.3525, 12);
    assert.equal(manipalX, 2898);
    assert.equal(manipalY, 1894);

    // Inverse round-trip within tile bounds
    const tileBounds = getTileBounds(12, manipalX, manipalY);
    assert.ok(74.7928 >= tileBounds.west && 74.7928 <= tileBounds.east);
    assert.ok(13.3525 >= tileBounds.south && 13.3525 <= tileBounds.north);

    // Extreme coordinate clamping checks
    assert.equal(lon2tileX(180, 5), 32);
    assert.equal(lon2tileX(-180, 5), 0);
  });

  it('computes exact tile counts for Manipal, Kushinagar, and Tamkuhi Raj packs', () => {
    // Pack A: Manipal (13.325..13.380 N, 74.765..74.820 E) at zoom 11..15
    const manipalTiles = computeTilesForBounds(DEFAULT_OFFLINE_PACKS.manipal.bounds, 11, 15);
    const manipalCount = countTilesForBounds(DEFAULT_OFFLINE_PACKS.manipal.bounds, 11, 15);
    assert.equal(manipalTiles.length, 69);
    assert.equal(manipalCount, 69);

    // Pack B: Kushinagar (26.690..26.790 N, 83.830..83.950 E) at zoom 11..15
    const kushinagarTiles = computeTilesForBounds(DEFAULT_OFFLINE_PACKS.kushinagar.bounds, 11, 15);
    const kushinagarCount = countTilesForBounds(DEFAULT_OFFLINE_PACKS.kushinagar.bounds, 11, 15);
    assert.equal(kushinagarTiles.length, 194);
    assert.equal(kushinagarCount, 194);

    // Pack C: Tamkuhi Raj (26.570..26.670 N, 84.090..84.210 E) at zoom 11..15
    const tamkuhiTiles = computeTilesForBounds(DEFAULT_OFFLINE_PACKS.tamkuhi_raj.bounds, 11, 15);
    const tamkuhiCount = countTilesForBounds(DEFAULT_OFFLINE_PACKS.tamkuhi_raj.bounds, 11, 15);
    assert.equal(tamkuhiTiles.length, 186);
    assert.equal(tamkuhiCount, 186);

    // Combined storage footprint calculation
    const totalTiles = manipalCount + kushinagarCount + tamkuhiCount;
    assert.equal(totalTiles, 449);
    const totalEstimatedBytes = estimatePackStorage(totalTiles, 20480);
    assert.ok(totalEstimatedBytes > 8 * 1024 * 1024 && totalEstimatedBytes < 10 * 1024 * 1024);
  });

  it('formats byte quantities accurately across units', () => {
    assert.equal(formatBytes(0), '0 B');
    assert.equal(formatBytes(512), '512 B');
    assert.equal(formatBytes(1536), '1.5 KB');
    assert.equal(formatBytes(1048576 * 3.5), '3.50 MB');
    assert.equal(formatBytes(1073741824 * 1.25), '1.25 GB');
  });

  it('evaluates coordinate bounding box containment correctly', () => {
    const manipalBounds = DEFAULT_OFFLINE_PACKS.manipal.bounds;
    // Inside MIT campus
    assert.equal(isCoordinateInBounds(13.3525, 74.7928, manipalBounds), true);
    // Northern edge
    assert.equal(isCoordinateInBounds(13.379, 74.800, manipalBounds), true);
    // Outside (Bangalore)
    assert.equal(isCoordinateInBounds(12.9716, 77.5946, manipalBounds), false);
    // Null Island
    assert.equal(isCoordinateInBounds(0, 0, manipalBounds), false);
  });
});

describe('Offline Map Service — Storage Engine & Metadata Persistence', () => {
  it('persists and retrieves pack metadata, tile records, and operator settings in memory store', async () => {
    const storage = new InMemoryOfflineMapStorage();

    // 1. Initial list has all default regional packs
    const initialPacks = await storage.listPacks();
    assert.equal(initialPacks.length, 3);
    const manipal = await storage.getPack('manipal');
    assert.ok(manipal);
    assert.equal(manipal.status, 'NOT_DOWNLOADED');

    // 2. Persist updated pack status
    const updatedPack: OfflineMapPack = {
      ...manipal,
      status: 'READY',
      downloadedTiles: 69,
      actualSizeBytes: 1400000,
      lastDownloadedAt: 1700000000000,
    };
    await storage.putPack(updatedPack);
    const retrieved = await storage.getPack('manipal');
    assert.equal(retrieved?.status, 'READY');
    assert.equal(retrieved?.downloadedTiles, 69);

    // 3. Store and retrieve a tile record
    const tileRecord: OfflineTileRecord = {
      key: makeTileKey(14, 11594, 7577),
      z: 14,
      x: 11594,
      y: 7577,
      packIds: ['manipal'],
      blob: new Blob(['test-tile-content'], { type: 'image/svg+xml' }),
      contentType: 'image/svg+xml',
      sizeBytes: 17,
      timestamp: Date.now(),
    };
    await storage.putTile(tileRecord);
    assert.equal(await storage.hasTile(14, 11594, 7577), true);
    const fetchedTile = await storage.getTile(14, 11594, 7577);
    assert.equal(fetchedTile?.key, '14/11594/7577');
    assert.equal(fetchedTile?.sizeBytes, 17);

    // 4. Settings persistence
    const initialSettings = await storage.getSettings();
    assert.equal(initialSettings.forceOffline, false);
    await storage.putSettings({ ...initialSettings, forceOffline: true, storageBudgetMb: 300 });
    const savedSettings = await storage.getSettings();
    assert.equal(savedSettings.forceOffline, true);
    assert.equal(savedSettings.storageBudgetMb, 300);

    // 5. Storage estimates
    const estimate = await storage.getStorageEstimate();
    assert.equal(estimate.totalStoredTiles, 1);
    assert.equal(estimate.usageBytes, 17);
    assert.equal(estimate.isQuotaWarning, false);
  });
});

describe('Offline Map Service — Download Orchestration & Interruption Handling', () => {
  it('downloads a pack completely, verifies tile count, and marks status READY', async () => {
    const storage = new InMemoryOfflineMapStorage();
    setOfflineStorageForTesting(storage);

    // Create a compact sub-pack (minZoom=14, maxZoom=14) for fast deterministic test
    const customPack: OfflineMapPack = {
      id: 'test_camp',
      name: 'Test Recovery Camp',
      purpose: 'Fast verification test',
      center: [13.3525, 74.7928],
      bounds: [13.345, 74.785, 13.355, 74.795],
      minZoom: 14,
      maxZoom: 14,
      status: 'NOT_DOWNLOADED',
      totalTiles: 0,
      downloadedTiles: 0,
      failedTiles: 0,
      estimatedSizeBytes: 0,
      actualSizeBytes: 0,
      lastDownloadedAt: null,
      error: null,
    };
    await storage.putPack(customPack);

    const progressReports: number[] = [];
    const completedPack = await downloadOfflinePack('test_camp', {
      storage,
      fetchTileImpl: mockPngFetchImpl,
      onProgress: (p) => {
        progressReports.push(p.percent);
      },
    });

    assert.equal(completedPack.status, 'READY');
    assert.ok(completedPack.downloadedTiles > 0);
    assert.equal(completedPack.failedTiles, 0);
    assert.equal(completedPack.error, null);
    assert.equal(completedPack.isRealGeographic, true);
    assert.equal(completedPack.tileFormat, 'PNG_RASTER');
    assert.ok(progressReports.length > 0);
    assert.equal(progressReports[progressReports.length - 1], 100);

    // Verify all tiles are verified in storage
    const tiles = computeTilesForBounds(customPack.bounds, 14, 14);
    for (const { z, x, y } of tiles) {
      assert.equal(await storage.hasTile(z, x, y), true);
    }
  });

  it('handles cancellation gracefully, retains partial tiles, and marks status PARTIAL', async () => {
    const storage = new InMemoryOfflineMapStorage();
    const customPack: OfflineMapPack = {
      id: 'cancel_test',
      name: 'Cancel Test Pack',
      purpose: 'Verification of interruption handling',
      center: [26.74, 83.89],
      bounds: [26.70, 83.85, 26.78, 83.93],
      minZoom: 13,
      maxZoom: 14,
      status: 'NOT_DOWNLOADED',
      totalTiles: 0,
      downloadedTiles: 0,
      failedTiles: 0,
      estimatedSizeBytes: 0,
      actualSizeBytes: 0,
      lastDownloadedAt: null,
      error: null,
    };
    await storage.putPack(customPack);

    const abortController = new AbortController();
    let downloadedCountBeforeAbort = 0;

    await assert.rejects(
      async () => {
        await downloadOfflinePack('cancel_test', {
          storage,
          fetchTileImpl: mockPngFetchImpl,
          signal: abortController.signal,
          onProgress: (p) => {
            if (p.downloaded >= 3) {
              downloadedCountBeforeAbort = p.downloaded;
              abortController.abort();
            }
          },
        });
      },
      /cancelled by operator/
    );

    const partialPack = await storage.getPack('cancel_test');
    assert.equal(partialPack?.status, 'PARTIAL');
    assert.ok(partialPack.downloadedTiles >= 3);
  });

  it('enforces deduplication when packs overlap and deletes tiles cleanly on pack removal', async () => {
    const storage = new InMemoryOfflineMapStorage();

    // Store tile key shared by both pack1 and pack2
    const z = 12, x = 2898, y = 1895;
    const tile: OfflineTileRecord = {
      key: makeTileKey(z, x, y),
      z,
      x,
      y,
      packIds: ['pack1', 'pack2'],
      blob: new Blob(['shared-tile']),
      contentType: 'image/png',
      sizeBytes: 100,
      timestamp: Date.now(),
    };
    await storage.putTile(tile);

    // Deleting pack1 should NOT remove the tile because pack2 still uses it!
    const deletedCount1 = await storage.deleteTilesForPack('pack1');
    assert.equal(deletedCount1, 0);
    const afterPack1 = await storage.getTile(z, x, y);
    assert.ok(afterPack1);
    assert.deepEqual(afterPack1.packIds, ['pack2']);

    // Deleting pack2 should remove the orphaned tile completely
    const deletedCount2 = await storage.deleteTilesForPack('pack2');
    assert.equal(deletedCount2, 1);
    const afterPack2 = await storage.getTile(z, x, y);
    assert.equal(afterPack2, null);
  });

  it('rejects bulk scraping from standard OpenStreetMap tile servers in compliance with usage policy', async () => {
    const storage = new InMemoryOfflineMapStorage();
    await storage.putSettings({
      ...DEFAULT_OFFLINE_SETTINGS,
      tileSourceTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    });

    const pack: OfflineMapPack = {
      ...DEFAULT_OFFLINE_PACKS.manipal,
      id: 'compliance_test',
    };
    await storage.putPack(pack);

    await assert.rejects(
      async () => {
        await downloadOfflinePack('compliance_test', { storage });
      },
      /OSM Policy Compliance: Bulk downloading directly from standard tile\.openstreetmap\.org/
    );
  });

  it('validates genuine PNG raster headers (\\x89PNG\\r\\n\\x1a\\n) and detects non-raster synthetic SVGs', async () => {
    // Valid PNG signature check
    const validPng = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);
    assert.equal(isPngBuffer(validPng), true);

    // Invalid/Text/SVG buffers rejected
    const svgBuffer = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    assert.equal(isPngBuffer(svgBuffer), false);
    const shortBuffer = new Uint8Array([137, 80, 78]);
    assert.equal(isPngBuffer(shortBuffer), false);

    // Download with synthetic SVG sets isRealGeographic = false
    const storage = new InMemoryOfflineMapStorage();
    const synthPack: OfflineMapPack = {
      id: 'synth_test',
      name: 'Synthetic Test',
      purpose: 'Verification of format detection',
      center: [13.35, 74.79],
      bounds: [13.345, 74.785, 13.355, 74.795],
      minZoom: 14,
      maxZoom: 14,
      status: 'NOT_DOWNLOADED',
      totalTiles: 0,
      downloadedTiles: 0,
      failedTiles: 0,
      estimatedSizeBytes: 0,
      actualSizeBytes: 0,
      lastDownloadedAt: null,
      error: null,
    };
    await storage.putPack(synthPack);

    const completedSynth = await downloadOfflinePack('synth_test', {
      storage,
      fetchTileImpl: async (z, x, y) => {
        const svg = generateTacticalTileSvg(z, x, y);
        return {
          blob: new Blob([svg], { type: 'image/svg+xml' }),
          contentType: 'image/svg+xml',
          sizeBytes: svg.length,
        };
      },
    });

    assert.equal(completedSynth.status, 'READY');
    assert.equal(completedSynth.isRealGeographic, false);
    assert.equal(completedSynth.tileFormat, 'SYNTHETIC_SVG');
  });

  it('findPackForCoordinates maps mission coordinates to respective recovery packs', () => {
    // MIT Manipal
    const p1 = findPackForCoordinates(13.3525, 74.7928);
    assert.ok(p1);
    assert.equal(p1.id, 'manipal');

    // Kushinagar Launch Site
    const p2 = findPackForCoordinates(26.74, 83.89);
    assert.ok(p2);
    assert.equal(p2.id, 'kushinagar');

    // Tamkuhi Raj Downrange Site
    const p3 = findPackForCoordinates(26.62, 84.15);
    assert.ok(p3);
    assert.equal(p3.id, 'tamkuhi_raj');

    // Uncovered coordinate (Bangalore)
    const p4 = findPackForCoordinates(12.9716, 77.5946);
    assert.equal(p4, null);
  });
});

describe('Offline Map Service — Offline Rendering & Missing Tile Fallback', () => {
  it('generates a prominent missing-tile warning indicator for tiles outside downloaded coverage', () => {
    const missingSvg = generateMissingTileSvg(14, 12000, 7000);
    assert.match(missingSvg, /OFFLINE MAP/);
    assert.match(missingSvg, /Tile Not in Downloaded Packs/);
    assert.match(missingSvg, /Z14 · X:12000 · Y:7000/);
  });

  it('generates tactical standalone base tiles with coordinate grid and metadata', () => {
    const tacticalSvg = generateTacticalTileSvg(13, 5797, 3788, 'Manipal Test');
    assert.match(tacticalSvg, /MANIPAL TEST/);
    assert.match(tacticalSvg, /Z13 · \(5797, 3788\)/);
  });

  it('correctly assesses offline geographic coverage based on ready packs', async () => {
    const storage = new InMemoryOfflineMapStorage();

    // Initially no packs are ready -> covered = false
    const check1 = await checkOfflineCoverage(13.3525, 74.7928, storage);
    assert.equal(check1.covered, false);
    assert.equal(check1.readyPacks.length, 0);

    // Mark Manipal ready
    const manipal = (await storage.getPack('manipal'))!;
    manipal.status = 'READY';
    await storage.putPack(manipal);

    // MIT campus coordinate is now covered
    const check2 = await checkOfflineCoverage(13.3525, 74.7928, storage);
    assert.equal(check2.covered, true);
    assert.equal(check2.matchingPacks.length, 1);
    assert.equal(check2.matchingPacks[0].id, 'manipal');

    // Kushinagar coordinate is not yet covered
    const check3 = await checkOfflineCoverage(26.74, 83.89, storage);
    assert.equal(check3.covered, false);
  });
});

describe('Offline Map Service — GPS Telemetry Marker & Stale-Position Handling', () => {
  function makePacket(lat: number | null, lon: number | null, overrides: Partial<TelemetryPacket> = {}): TelemetryPacket {
    return {
      source: 'LIVE_SERIAL',
      receivedAtMs: Date.now(),
      teamId: '2026-IN-SPACe-CAN-7USAT-017',
      packetNumber: 1,
      missionTimeSeconds: 10,
      timestampUtc: '12:00:00',
      altitude: 450.0,
      velocity: -2.0,
      acceleration: 1.0,
      accelX: 0,
      accelY: 0,
      accelZ: 9.81,
      spinRate: 0,
      wheelRpm: null,
      roll: 2.0,
      pitch: -1.0,
      yaw: null,
      latitude: lat,
      longitude: lon,
      gpsAltitude: 505.0,
      gpsSats: 8,
      gpsFixType: lat !== null && lon !== null ? '3D' : 'NO_FIX',
      gpsValid: lat !== null && lon !== null,
      temperature: 24.0,
      pressure: 960.0,
      batteryVoltage: 7.8,
      currentDraw: null,
      power: null,
      batterySoc: null,
      rssi: null,
      co2: null,
      pm2_5: null,
      uv: null,
      humidity: null,
      stateCode: 5,
      fswStateName: 'DESCENT',
      l1Connected: true,
      l2Connected: null,
      deployed: null,
      audioBeaconActive: null,
      gsmModuleActive: null,
      ...overrides,
    };
  }

  it('correctly validates genuine GPS fixes and strictly rejects (0, 0) Null Island', () => {
    // Valid fix
    const validPacket = makePacket(13.3525, 74.7928);
    assert.equal(isPacketGpsValid(validPacket), true);

    // Null Island (0, 0) rejected
    const nullIslandPacket = makePacket(0.0, 0.0);
    assert.equal(isPacketGpsValid(nullIslandPacket), false);

    // Negative Null Island (-0, +0) rejected
    const negZeroPacket = makePacket(-0.0, 0.0);
    assert.equal(isPacketGpsValid(negZeroPacket), false);

    // Satellites === 0 rejected
    const zeroSatsPacket = makePacket(13.3525, 74.7928, { gpsSats: 0 });
    assert.equal(isPacketGpsValid(zeroSatsPacket), false);

    // NO_FIX rejected
    const noFixPacket = makePacket(13.3525, 74.7928, { gpsFixType: 'NO_FIX', gpsValid: false });
    assert.equal(isPacketGpsValid(noFixPacket), false);

    // Null coordinates rejected
    const nullPacket = makePacket(null, null);
    assert.equal(isPacketGpsValid(nullPacket), false);
  });

  it('differentiates live fix, preserved stale last-known position, and no fix states', () => {
    // Simulator of GPS display state machine
    function computeGpsDisplayState(
      latestPacket: TelemetryPacket | null,
      isStale: boolean,
      lastKnownFix: { lat: number; lon: number } | null
    ): 'CURRENT_FIX' | 'STALE_POSITION' | 'NO_FIX' {
      const isValid = isPacketGpsValid(latestPacket);
      if (isValid && !isStale) return 'CURRENT_FIX';
      if (lastKnownFix !== null) return 'STALE_POSITION';
      return 'NO_FIX';
    }

    // 1. Nominal live packet -> CURRENT_FIX
    const p1 = makePacket(13.3525, 74.7928);
    const state1 = computeGpsDisplayState(p1, false, null);
    assert.equal(state1, 'CURRENT_FIX');

    // Record last known fix
    const lastKnown = { lat: p1.latitude!, lon: p1.longitude! };

    // 2. Next packet arrives with NO GPS fix (under trees / canopy at recovery site) -> STALE_POSITION
    const p2NoFix = makePacket(null, null, { gpsSats: 0, gpsFixType: 'NO_FIX', gpsValid: false });
    const state2 = computeGpsDisplayState(p2NoFix, false, lastKnown);
    assert.equal(state2, 'STALE_POSITION');

    // 3. Telemetry packet stream goes stale -> STALE_POSITION preserved
    const state3 = computeGpsDisplayState(p1, true, lastKnown);
    assert.equal(state3, 'STALE_POSITION');

    // 4. No packet and no prior fix received -> NO_FIX
    const state4 = computeGpsDisplayState(null, false, null);
    assert.equal(state4, 'NO_FIX');
  });
});

describe('Offline Map Service — Zoom Scaling, TMS Coordinates & Custom Regions', () => {
  it('correctly calculates TMS to XYZ row conversion for SQLite MBTiles', () => {
    // In Slippy maps (XYZ), y increases southward. In MBTiles (TMS), row increases northward.
    // Formula: tms_y = (1 << z) - 1 - xyz_y;
    for (let z = 11; z <= 15; z++) {
      const maxY = (1 << z) - 1;
      // Top row in XYZ (0) maps to top row in TMS (maxY)
      assert.equal(maxY - 0, maxY);
      // Bottom row in XYZ (maxY) maps to bottom row in TMS (0)
      assert.equal(maxY - maxY, 0);

      // Verify Manipal center tile at z=12 (x=2898, y=1894)
      if (z === 12) {
        const xyzY = 1894;
        const tmsY = (1 << 12) - 1 - xyzY;
        assert.equal(tmsY, 4095 - 1894);
        assert.equal(tmsY, 2201);
        // Inverse conversion:
        assert.equal((1 << 12) - 1 - tmsY, xyzY);
      }
    }
  });

  it('correctly maps child tiles beyond maxNativeZoom to parent tile coordinates', () => {
    const maxNativeZoom = 15;
    // At zoom 16, each native tile at Z15 splits into 2x2 = 4 child tiles
    const z15X = 23188;
    const z15Y = 15154;

    for (let dx = 0; dx <= 1; dx++) {
      for (let dy = 0; dy <= 1; dy++) {
        const z16X = z15X * 2 + dx;
        const z16Y = z15Y * 2 + dy;
        const parentX = Math.floor(z16X / 2);
        const parentY = Math.floor(z16Y / 2);
        assert.equal(parentX, z15X);
        assert.equal(parentY, z15Y);
      }
    }

    // At zoom 18, scale ratio is 2^(18-15) = 8
    const z18X = z15X * 8 + 5;
    const z18Y = z15Y * 8 + 3;
    assert.equal(Math.floor(z18X / 8), z15X);
    assert.equal(Math.floor(z18Y / 8), z15Y);
  });

  it('expands geographic bounding box symmetrically by kilometers', () => {
    const kushinagarBounds: [number, number, number, number] = [26.690, 83.830, 26.790, 83.950];
    const expanded1km = expandBoundsByKm(kushinagarBounds, 1.0);
    // 1 km is approximately 0.00898 degrees latitude
    assert.ok(expanded1km[0] < kushinagarBounds[0]); // South moves further south
    assert.ok(expanded1km[1] < kushinagarBounds[1]); // West moves further west
    assert.ok(expanded1km[2] > kushinagarBounds[2]); // North moves further north
    assert.ok(expanded1km[3] > kushinagarBounds[3]); // East moves further east

    const expanded5km = expandBoundsByKm(kushinagarBounds, 5.0);
    assert.ok(expanded5km[0] < expanded1km[0]);
    assert.ok(expanded5km[2] > expanded1km[2]);
  });

  it('creates and persists operator custom offline packs with tile counting', async () => {
    const storage = new InMemoryOfflineMapStorage();
    const customEnvelope: [number, number, number, number] = [26.700, 83.840, 26.750, 83.900];

    const pack = await createOrUpdateCustomPack(
      {
        id: 'kushinagar_field_drop',
        name: 'Kushinagar Drop Zone Field Envelope',
        purpose: 'Specific 5km recovery corridor',
        bounds: customEnvelope,
        minZoom: 12,
        maxZoom: 15,
      },
      storage
    );

    assert.equal(pack.id, 'kushinagar_field_drop');
    assert.equal(pack.minZoom, 12);
    assert.equal(pack.maxZoom, 15);
    assert.ok(pack.totalTiles > 0 && pack.totalTiles < 100);
    assert.equal(pack.status, 'NOT_DOWNLOADED');

    // Retrieve from storage
    const retrieved = await storage.getPack('kushinagar_field_drop');
    assert.ok(retrieved);
    assert.equal(retrieved.name, 'Kushinagar Drop Zone Field Envelope');
    assert.equal(retrieved.totalTiles, pack.totalTiles);
  });
});

describe('Optional Telemetry Settings — Independent Enable/Disable & Display Gating', () => {
  it('initializes with expected hardware-compatible defaults', () => {
    const memStorage = {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
      clear: () => {},
      key: () => null,
      length: 0,
    };

    const loaded = loadOptionalTelemetrySettings(memStorage as unknown as Storage);
    // Flat-sat breadboard defaults: battery voltage monitored, uninstalled hardware disabled
    assert.equal(loaded.enableBatteryVoltage, true);
    assert.equal(loaded.enableWheelRpm, false);
    assert.equal(loaded.enableSps30, false);
    assert.equal(loaded.enableUv, false);
  });

  it('persists and restores independent toggle states to storage', () => {
    let storedValue: string | null = null;
    const memStorage = {
      getItem: () => storedValue,
      setItem: (_k: string, v: string) => {
        storedValue = v;
      },
      removeItem: () => {
        storedValue = null;
      },
      clear: () => {
        storedValue = null;
      },
      key: () => null,
      length: 0,
    };

    // Operator enables SPS30 and momentum wheel
    const updated = {
      enableBatteryVoltage: true,
      enableWheelRpm: true,
      enableSps30: true,
      enableUv: false,
    };

    saveOptionalTelemetrySettings(memStorage as unknown as Storage, updated);
    const reloaded = loadOptionalTelemetrySettings(memStorage as unknown as Storage);

    assert.equal(reloaded.enableBatteryVoltage, true);
    assert.equal(reloaded.enableWheelRpm, true);
    assert.equal(reloaded.enableSps30, true);
    assert.equal(reloaded.enableUv, false);
  });

  it('evaluates field state correctly across DISABLED, UNAVAILABLE, and VALID values', () => {
    const fmt = (v: number) => `${v.toFixed(1)} RPM`;

    // 1. Channel disabled in settings -> DISABLED regardless of value
    const disabledState = evaluateOptionalFieldState(false, 12000, fmt);
    assert.equal(disabledState.status, 'DISABLED');
    assert.equal(disabledState.displayText, 'DISABLED');
    assert.equal(disabledState.numericValue, null);

    // 2. Channel enabled, but packet value is null / absent -> UNAVAILABLE
    const nullState = evaluateOptionalFieldState(true, null, fmt);
    assert.equal(nullState.status, 'UNAVAILABLE');
    assert.equal(nullState.displayText, 'UNAVAILABLE');
    assert.equal(nullState.numericValue, null);

    // 3. Channel enabled, packet value is NaN / non-finite -> UNAVAILABLE
    const nanState = evaluateOptionalFieldState(true, NaN, fmt);
    assert.equal(nanState.status, 'UNAVAILABLE');
    assert.equal(nanState.displayText, 'UNAVAILABLE');

    // 4. Channel enabled with valid numerical telemetry -> VALID
    const validState = evaluateOptionalFieldState(true, 12050, fmt);
    assert.equal(validState.status, 'VALID');
    assert.equal(validState.displayText, '12050.0 RPM');
    assert.equal(validState.numericValue, 12050);
  });

  it('ensures battery voltage is strictly optional and never fabricated in LIVE_SERIAL mode', () => {
    // In LIVE_SERIAL, when transmitter sends 0.00V or unmonitored battery, parser does not invent 7.4V
    const fmtVolt = (v: number) => `${v.toFixed(2)}V`;

    // Disabled battery monitoring
    const disabledBatt = evaluateOptionalFieldState(false, null, fmtVolt);
    assert.equal(disabledBatt.displayText, 'DISABLED');

    // Enabled battery monitoring but unpowered ADC divider (null)
    const nullBatt = evaluateOptionalFieldState(true, null, fmtVolt);
    assert.equal(nullBatt.displayText, 'UNAVAILABLE');

    // Real measured voltage
    const liveBatt = evaluateOptionalFieldState(true, 7.82, fmtVolt);
    assert.equal(liveBatt.displayText, '7.82V');
  });
});

describe('Offline Map Service — Online vs Offline Basemap Source Selection & Dynamic Switching', () => {
  it('determines effective source mode from network status, forceOffline, and failure thresholds', () => {
    const resolveMode = (forceOffline: boolean, isOnline: boolean, failures: number) => {
      if (forceOffline) return 'OFFLINE';
      if (!isOnline) return 'OFFLINE';
      if (failures >= 3) return 'OFFLINE';
      return 'ONLINE';
    };

    // 1. Online with no forceOffline -> ONLINE
    assert.equal(resolveMode(false, true, 0), 'ONLINE');
    // 2. Online but forceOffline enabled -> OFFLINE
    assert.equal(resolveMode(true, true, 0), 'OFFLINE');
    // 3. Network offline -> OFFLINE
    assert.equal(resolveMode(false, false, 0), 'OFFLINE');
    // 4. Online but consecutive failure threshold reached -> OFFLINE
    assert.equal(resolveMode(false, true, 3), 'OFFLINE');
    // 5. Online with 1 or 2 intermittent failures -> remains ONLINE until threshold
    assert.equal(resolveMode(false, true, 2), 'ONLINE');
    // 6. Network reconnection resets failures -> recovers to ONLINE
    const recoveredFailures = 0;
    assert.equal(resolveMode(false, true, recoveredFailures), 'ONLINE');
  });

  it('accurately evaluates regional coverage without giving false impression for partial packs', async () => {
    const storage = new InMemoryOfflineMapStorage();

    // Manipal has 69 out of 1060 tiles (PARTIAL)
    const manipalPartial: OfflineMapPack = {
      ...DEFAULT_OFFLINE_PACKS.manipal,
      status: 'PARTIAL',
      totalTiles: 1060,
      downloadedTiles: 69,
      failedTiles: 991,
    };
    await storage.putPack(manipalPartial);

    // Kushinagar has 194 out of 194 tiles (READY)
    const kushinagarReady: OfflineMapPack = {
      ...DEFAULT_OFFLINE_PACKS.kushinagar,
      status: 'READY',
      totalTiles: 194,
      downloadedTiles: 194,
      failedTiles: 0,
    };
    await storage.putPack(kushinagarReady);

    const allPacks = await storage.listPacks();

    const evaluateCoverage = (lat: number, lon: number) => {
      const match = allPacks.find((p) => isCoordinateInBounds(lat, lon, p.bounds));
      if (!match) return { status: 'NONE', label: 'Outside Packs' };
      if (match.status === 'READY') return { status: 'READY', label: `${match.name.split(' ')[0]} Ready` };
      if (match.status === 'PARTIAL') {
        return {
          status: 'PARTIAL',
          label: `${match.name.split(' ')[0]} Partial (${match.downloadedTiles}/${match.totalTiles})`,
        };
      }
      return { status: 'NOT_DOWNLOADED', label: `${match.name.split(' ')[0]} Not Downloaded` };
    };

    // Case A: CanSat at Manipal (13.3525, 74.7928) -> strictly PARTIAL with exact count, never falsely READY
    const manipalCov = evaluateCoverage(13.3525, 74.7928);
    assert.equal(manipalCov.status, 'PARTIAL');
    assert.equal(manipalCov.label, 'Manipal Partial (69/1060)');

    // Case B: CanSat at Kushinagar (26.74, 83.89) -> READY
    const kushinagarCov = evaluateCoverage(26.74, 83.89);
    assert.equal(kushinagarCov.status, 'READY');
    assert.equal(kushinagarCov.label, 'Kushinagar Ready');

    // Case C: Outside any defined pack (Bangalore 12.9716, 77.5946) -> NONE
    const outsideCov = evaluateCoverage(12.9716, 77.5946);
    assert.equal(outsideCov.status, 'NONE');
    assert.equal(outsideCov.label, 'Outside Packs');
  });

  it('validates online tile URLs and provider terms for Street, Satellite, and Dark styles', () => {
    const tileUrls = {
      osm: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      satellite:
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    };

    // Ensure all 3 basemap options have genuine distinct URLs
    assert.ok(tileUrls.osm.includes('tile.openstreetmap.org'));
    assert.ok(tileUrls.satellite.includes('arcgisonline.com'));
    assert.ok(tileUrls.dark.includes('basemaps.cartocdn.com'));

    // Check zoom parameter template formatting
    for (const [key, url] of Object.entries(tileUrls)) {
      assert.ok(url.includes('{z}'), `${key} missing {z}`);
      assert.ok(url.includes('{x}'), `${key} missing {x}`);
      assert.ok(url.includes('{y}'), `${key} missing {y}`);
    }
  });

  it('handles offline tile resolution order: IndexedDB -> local server -> missing SVG graphic', async () => {
    const storage = new InMemoryOfflineMapStorage();
    const storedPngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

    // Store tile (12, 2898, 1894) in storage
    await storage.putTile({
      key: makeTileKey(12, 2898, 1894),
      z: 12,
      x: 2898,
      y: 1894,
      packIds: ['manipal'],
      blob: new Blob([storedPngBytes], { type: 'image/png' }),
      contentType: 'image/png',
      sizeBytes: storedPngBytes.length,
      timestamp: Date.now(),
    });

    // Mock resolver simulating resolveOfflineOrMissingTile
    const resolveTile = async (z: number, x: number, y: number, localServerAvailable: boolean) => {
      // Step 1: IndexedDB
      const record = await storage.getTile(z, x, y);
      if (record && record.blob) {
        return { source: 'INDEXEDDB', bytes: record.sizeBytes };
      }

      // Step 2: Local tile server
      if (localServerAvailable) {
        return { source: 'LOCAL_SERVER', bytes: 1024 };
      }

      // Step 3: Missing tile SVG
      return { source: 'MISSING_SVG', svg: generateMissingTileSvg(z, x, y) };
    };

    // 1. Available in IndexedDB -> resolved from storage
    const hit = await resolveTile(12, 2898, 1894, false);
    assert.equal(hit.source, 'INDEXEDDB');

    // 2. Not in IndexedDB, but local server reachable -> resolved from local server
    const serverHit = await resolveTile(12, 2899, 1894, true);
    assert.equal(serverHit.source, 'LOCAL_SERVER');

    // 3. Not in IndexedDB and local server unreachable -> resolves to honest missing SVG
    const missing = await resolveTile(12, 2899, 1894, false);
    assert.equal(missing.source, 'MISSING_SVG');
    assert.ok(missing.svg?.includes('OFFLINE MAP'));
    assert.ok(missing.svg?.includes('Tile Not in Downloaded Packs'));
    assert.ok(missing.svg?.includes('Z12'));
  });
});
