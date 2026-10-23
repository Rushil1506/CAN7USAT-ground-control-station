/**
 * CAN-7USAT Ground Control Station — Local Offline Map & Frontend Server
 * Team Parikshit (Team 017 | 2026-IN-SPACe-CAN-7USAT-017)
 *
 * Serves the compiled GCS web dashboard (dist/) and real geographic raster map
 * tiles from local MBTiles packages and directory caches at 127.0.0.1:8080.
 *
 * Guarantees zero-dependency, zero-internet field operations with verified
 * OpenStreetMap raster tiles (ODbL 1.0).
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const MAP_PACKS_DIR = path.join(ROOT_DIR, 'map_packs');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
};

// MBTiles Database Cache: packId -> DatabaseSync instance
const mbtilesDbCache = new Map();

function getMbtilesDb(packId) {
  if (mbtilesDbCache.has(packId)) {
    return mbtilesDbCache.get(packId);
  }
  const mbtilesPath = path.join(MAP_PACKS_DIR, `${packId}.mbtiles`);
  if (fs.existsSync(mbtilesPath)) {
    try {
      const db = new DatabaseSync(mbtilesPath, { readOnly: true });
      mbtilesDbCache.set(packId, db);
      return db;
    } catch (err) {
      console.error(`[OfflineServer] Error opening MBTiles for ${packId}:`, err);
    }
  }
  return null;
}

/**
 * Retrieves a genuine raster tile buffer for given packId, z, x, y.
 * Checks loose tile directory first, then MBTiles SQLite database.
 * Returns null if not found (strictly 404, never fake synthetic).
 */
export function getTileBuffer(packId, z, x, y) {
  // 1. Check directory: map_packs/:packId/:z/:x/:y.png
  const loosePath = path.join(MAP_PACKS_DIR, packId, String(z), String(x), `${y}.png`);
  if (fs.existsSync(loosePath)) {
    try {
      return fs.readFileSync(loosePath);
    } catch {
      // Fall through to MBTiles
    }
  }

  // 2. Check MBTiles SQLite database
  const db = getMbtilesDb(packId);
  if (db) {
    try {
      // MBTiles uses TMS coordinates: tile_row = (1 << z) - 1 - y
      const tmsY = (1 << z) - 1 - y;
      const row = db
        .prepare('SELECT tile_data FROM tiles WHERE zoom_level = ? AND tile_column = ? AND tile_row = ?')
        .get(z, x, tmsY);
      if (row && row.tile_data) {
        return Buffer.from(row.tile_data);
      }
    } catch (err) {
      console.error(`[OfflineServer] Error querying MBTiles for ${packId}/${z}/${x}/${y}:`, err);
    }
  }

  return null;
}

/**
 * Discovers available offline map packs on disk.
 */
export function listAvailablePacks() {
  const packs = [];
  const knownPackIds = ['manipal', 'kushinagar', 'tamkuhi_raj'];

  for (const id of knownPackIds) {
    const mbtilesPath = path.join(MAP_PACKS_DIR, `${id}.mbtiles`);
    const dirPath = path.join(MAP_PACKS_DIR, id);
    const hasMbtiles = fs.existsSync(mbtilesPath);
    const hasDir = fs.existsSync(dirPath);

    if (hasMbtiles || hasDir) {
      let meta = {};
      if (hasMbtiles) {
        const db = getMbtilesDb(id);
        if (db) {
          try {
            const rows = db.prepare('SELECT name, value FROM metadata').all();
            for (const r of rows) {
              meta[r.name] = r.value;
            }
          } catch {
            // Ignore
          }
        }
      }

      packs.push({
        id,
        name: meta.name || id.toUpperCase(),
        description: meta.description || '',
        bounds: meta.bounds ? meta.bounds.split(',').map(Number) : null,
        minZoom: meta.minzoom ? parseInt(meta.minzoom, 10) : 11,
        maxZoom: meta.maxzoom ? parseInt(meta.maxzoom, 10) : 15,
        hasMbtiles,
        hasLooseTiles: hasDir,
        attribution: meta.attribution || '© OpenStreetMap contributors | ODbL 1.0',
      });
    }
  }

  return packs;
}

/**
 * Creates and starts the HTTP server.
 */
export function createOfflineServer() {
  return http.createServer((req, res) => {
    // CORS headers for local ground station tooling
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const parsedUrl = new URL(req.url, 'http://127.0.0.1');
    const pathname = parsedUrl.pathname;

    // 1. Health check endpoint
    if (pathname === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'ok',
          service: 'CAN-7USAT Offline Tile & Dashboard Server',
          version: '1.0.0',
          mode: 'OFFLINE_FIELD_READY',
          timestamp: Date.now(),
        })
      );
      return;
    }

    // 2. Packs Discovery endpoint
    if (pathname === '/api/packs') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ packs: listAvailablePacks() }));
      return;
    }

    // 3. Tile Serving endpoint: /tiles/:packId/:z/:x/:y.png
    const tileMatch = pathname.match(/^\/tiles\/([a-zA-Z0-9_-]+)\/(\d+)\/(\d+)\/(\d+)\.png$/);
    if (tileMatch) {
      const packId = tileMatch[1];
      const z = parseInt(tileMatch[2], 10);
      const x = parseInt(tileMatch[3], 10);
      const y = parseInt(tileMatch[4], 10);

      const tileBuffer = getTileBuffer(packId, z, x, y);
      if (tileBuffer) {
        res.writeHead(200, {
          'Content-Type': 'image/png',
          'Content-Length': tileBuffer.length,
          'Cache-Control': 'public, max-age=31536000, immutable',
        });
        res.end(tileBuffer);
        return;
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Tile ${z}/${x}/${y} not in offline pack '${packId}'.` }));
        return;
      }
    }

    // 4. Static frontend asset serving (dist/)
    let safePath = pathname.replace(/^\/+/, '');
    if (safePath === '' || safePath === '/') safePath = 'index.html';
    const filePath = path.join(DIST_DIR, safePath);

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    // Fallback to index.html for SPA routing
    const indexPath = path.join(DIST_DIR, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      fs.createReadStream(indexPath).pipe(res);
      return;
    }

    // 404 Not Found
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('CAN-7USAT GCS: 404 Not Found');
  });
}

// Start standalone server when executed directly
const isDirectExecution =
  process.argv[1] &&
  (process.argv[1].endsWith('offlineServer.mjs') || process.argv[1].includes('offlineServer'));

if (isDirectExecution) {
  const PORT = parseInt(process.env.PORT || process.argv[2] || '8080', 10);
  const server = createOfflineServer();
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`===========================================================`);
    console.log(`CAN-7USAT Offline Tile & Dashboard Server active`);
    console.log(`Local Endpoint: http://127.0.0.1:${PORT}/`);
    console.log(`Tile Template:  http://127.0.0.1:${PORT}/tiles/{packId}/{z}/{x}/{y}.png`);
    console.log(`Available Packs: ${listAvailablePacks().map((p) => p.id).join(', ')}`);
    console.log(`ODbL Compliance: Real geographic OpenStreetMap raster tiles`);
    console.log(`===========================================================`);
  });
}
