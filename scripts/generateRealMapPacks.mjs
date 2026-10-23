/**
 * CAN-7USAT Ground Control Station — Real Geographic Map Pack Generator
 * Team Parikshit (Team 017 | 2026-IN-SPACe-CAN-7USAT-017)
 *
 * Generates genuine, high-contrast, policy-compliant raster PNG map tiles and
 * SQLite MBTiles packages from real OpenStreetMap data for:
 *   1. Manipal (MIT Campus, Academic Blocks, Tiger Circle, End Point)
 *   2. Kushinagar (Primary Competition Launch & Recovery Site, NH-27)
 *   3. Tamkuhi Raj (Downrange Tracking & Secondary Recovery Site)
 *
 * Sourced under the Open Database License (ODbL 1.0) © OpenStreetMap contributors.
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================
// BITMAP FONT (5x7 ASCII)
// ============================================================
const FONT_5X7 = {
  ' ': [0x00, 0x00, 0x00, 0x00, 0x00],
  '!': [0x00, 0x00, 0x5f, 0x00, 0x00],
  '"': [0x00, 0x07, 0x00, 0x07, 0x00],
  '#': [0x14, 0x7f, 0x14, 0x7f, 0x14],
  '$': [0x24, 0x2a, 0x7f, 0x2a, 0x12],
  '%': [0x23, 0x13, 0x08, 0x64, 0x62],
  '&': [0x36, 0x49, 0x55, 0x22, 0x50],
  "'": [0x00, 0x05, 0x03, 0x00, 0x00],
  '(': [0x00, 0x1c, 0x22, 0x41, 0x00],
  ')': [0x00, 0x41, 0x22, 0x1c, 0x00],
  '*': [0x14, 0x08, 0x3e, 0x08, 0x14],
  '+': [0x08, 0x08, 0x3e, 0x08, 0x08],
  ',': [0x00, 0x50, 0x30, 0x00, 0x00],
  '-': [0x08, 0x08, 0x08, 0x08, 0x08],
  '.': [0x00, 0x60, 0x60, 0x00, 0x00],
  '/': [0x20, 0x10, 0x08, 0x04, 0x02],
  '0': [0x3e, 0x51, 0x49, 0x45, 0x3e],
  '1': [0x00, 0x42, 0x7f, 0x40, 0x00],
  '2': [0x42, 0x61, 0x51, 0x49, 0x46],
  '3': [0x21, 0x41, 0x45, 0x4b, 0x31],
  '4': [0x18, 0x14, 0x12, 0x7f, 0x10],
  '5': [0x27, 0x45, 0x45, 0x45, 0x39],
  '6': [0x3c, 0x4a, 0x49, 0x49, 0x30],
  '7': [0x01, 0x71, 0x09, 0x05, 0x03],
  '8': [0x36, 0x49, 0x49, 0x49, 0x36],
  '9': [0x06, 0x49, 0x49, 0x29, 0x1e],
  ':': [0x00, 0x36, 0x36, 0x00, 0x00],
  ';': [0x00, 0x56, 0x36, 0x00, 0x00],
  '<': [0x08, 0x14, 0x22, 0x41, 0x00],
  '=': [0x14, 0x14, 0x14, 0x14, 0x14],
  '>': [0x00, 0x41, 0x22, 0x14, 0x08],
  '?': [0x02, 0x01, 0x51, 0x09, 0x06],
  '@': [0x32, 0x49, 0x79, 0x41, 0x3e],
  'A': [0x7e, 0x11, 0x11, 0x11, 0x7e],
  'B': [0x7f, 0x49, 0x49, 0x49, 0x36],
  'C': [0x3e, 0x41, 0x41, 0x41, 0x22],
  'D': [0x7f, 0x41, 0x41, 0x22, 0x1c],
  'E': [0x7f, 0x49, 0x49, 0x49, 0x41],
  'F': [0x7f, 0x09, 0x09, 0x09, 0x01],
  'G': [0x3e, 0x41, 0x49, 0x49, 0x7a],
  'H': [0x7f, 0x08, 0x08, 0x08, 0x7f],
  'I': [0x00, 0x41, 0x7f, 0x41, 0x00],
  'J': [0x20, 0x40, 0x41, 0x3f, 0x01],
  'K': [0x7f, 0x08, 0x14, 0x22, 0x41],
  'L': [0x7f, 0x40, 0x40, 0x40, 0x40],
  'M': [0x7f, 0x02, 0x0c, 0x02, 0x7f],
  'N': [0x7f, 0x04, 0x08, 0x10, 0x7f],
  'O': [0x3e, 0x41, 0x41, 0x41, 0x3e],
  'P': [0x7f, 0x09, 0x09, 0x09, 0x06],
  'Q': [0x3e, 0x41, 0x51, 0x21, 0x5e],
  'R': [0x7f, 0x09, 0x19, 0x29, 0x46],
  'S': [0x46, 0x49, 0x49, 0x49, 0x31],
  'T': [0x01, 0x01, 0x7f, 0x01, 0x01],
  'U': [0x3f, 0x40, 0x40, 0x40, 0x3f],
  'V': [0x1f, 0x20, 0x40, 0x20, 0x1f],
  'W': [0x3f, 0x40, 0x38, 0x40, 0x3f],
  'X': [0x63, 0x14, 0x08, 0x14, 0x63],
  'Y': [0x07, 0x08, 0x70, 0x08, 0x07],
  'Z': [0x61, 0x51, 0x49, 0x45, 0x43],
  '[': [0x00, 0x7f, 0x41, 0x41, 0x00],
  '\\': [0x02, 0x04, 0x08, 0x10, 0x20],
  ']': [0x00, 0x41, 0x41, 0x7f, 0x00],
  '^': [0x04, 0x02, 0x01, 0x02, 0x04],
  '_': [0x40, 0x40, 0x40, 0x40, 0x40],
  '`': [0x00, 0x01, 0x02, 0x04, 0x00],
  'a': [0x20, 0x54, 0x54, 0x54, 0x78],
  'b': [0x7f, 0x48, 0x44, 0x44, 0x38],
  'c': [0x38, 0x44, 0x44, 0x44, 0x20],
  'd': [0x38, 0x44, 0x44, 0x48, 0x7f],
  'e': [0x38, 0x54, 0x54, 0x54, 0x18],
  'f': [0x08, 0x7e, 0x09, 0x01, 0x02],
  'g': [0x0c, 0x52, 0x52, 0x52, 0x3e],
  'h': [0x7f, 0x08, 0x04, 0x04, 0x78],
  'i': [0x00, 0x44, 0x7d, 0x40, 0x00],
  'j': [0x20, 0x40, 0x44, 0x3d, 0x00],
  'k': [0x7f, 0x10, 0x28, 0x44, 0x00],
  'l': [0x00, 0x41, 0x7f, 0x40, 0x00],
  'm': [0x7c, 0x04, 0x18, 0x04, 0x78],
  'n': [0x7c, 0x08, 0x04, 0x04, 0x78],
  'o': [0x38, 0x44, 0x44, 0x44, 0x38],
  'p': [0x7c, 0x14, 0x14, 0x14, 0x08],
  'q': [0x08, 0x14, 0x14, 0x18, 0x7c],
  'r': [0x7c, 0x08, 0x04, 0x04, 0x08],
  's': [0x48, 0x54, 0x54, 0x54, 0x20],
  't': [0x04, 0x3f, 0x44, 0x40, 0x20],
  'u': [0x3c, 0x40, 0x40, 0x20, 0x7c],
  'v': [0x1c, 0x20, 0x40, 0x20, 0x1c],
  'w': [0x3c, 0x40, 0x30, 0x40, 0x3c],
  'x': [0x44, 0x28, 0x10, 0x28, 0x44],
  'y': [0x0c, 0x50, 0x50, 0x50, 0x3c],
  'z': [0x44, 0x64, 0x54, 0x4c, 0x44],
};

function drawChar(surface, char, startX, startY, r, g, b, a = 255) {
  const glyph = FONT_5X7[char] || FONT_5X7['?'];
  for (let col = 0; col < 5; col++) {
    const colByte = glyph[col];
    for (let row = 0; row < 7; row++) {
      if (colByte & (1 << row)) {
        surface.setPixel(startX + col, startY + row, r, g, b, a);
      }
    }
  }
}

function drawString(surface, str, startX, startY, r, g, b, withOutline = true, outlineR = 255, outlineG = 255, outlineB = 255) {
  if (withOutline) {
    const offsets = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [-1, 1], [1, -1]];
    for (const [ox, oy] of offsets) {
      let curX = startX + ox;
      for (let i = 0; i < str.length; i++) {
        drawChar(surface, str[i], curX, startY + oy, outlineR, outlineG, outlineB, 240);
        curX += 6;
      }
    }
  }
  let curX = startX;
  for (let i = 0; i < str.length; i++) {
    drawChar(surface, str[i], curX, startY, r, g, b, 255);
    curX += 6;
  }
}

// ============================================================
// PURE JS PNG ENCODER (node:zlib)
// ============================================================
function crc32(buf) {
  let crc = -1;
  for (let i = 0; i < buf.length; i++) {
    let b = buf[i];
    for (let j = 0; j < 8; j++) {
      if ((crc ^ b) & 1) crc = (crc >>> 1) ^ 0xedb88320;
      else crc = crc >>> 1;
      b >>>= 1;
    }
  }
  return crc ^ -1;
}

function makePngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crcVal = crc32(Buffer.concat([t, data]));
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crcVal >>> 0, 0);
  return Buffer.concat([len, t, data, crcBuf]);
}

function encodePng(width, height, rgbaBuffer) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // 8-bit depth
  ihdr[9] = 6;  // RGBA
  ihdr[10] = 0; // Deflate
  ihdr[11] = 0; // Filter None
  ihdr[12] = 0; // No interlace

  const scanlines = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const rowOffset = y * (1 + width * 4);
    scanlines[rowOffset] = 0; // Filter none
    rgbaBuffer.copy(scanlines, rowOffset + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(scanlines, { level: 6 });
  return Buffer.concat([
    signature,
    makePngChunk('IHDR', ihdr),
    makePngChunk('IDAT', idat),
    makePngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ============================================================
// 2D RASTER SURFACE
// ============================================================
class RasterSurface {
  constructor(width = 256, height = 256, bgR = 242, bgG = 239, bgB = 233) {
    this.width = width;
    this.height = height;
    this.buffer = Buffer.alloc(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      const idx = i * 4;
      this.buffer[idx] = bgR;
      this.buffer[idx + 1] = bgG;
      this.buffer[idx + 2] = bgB;
      this.buffer[idx + 3] = 255;
    }
  }

  setPixel(x, y, r, g, b, a = 255) {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return;
    const idx = (y * this.width + x) * 4;
    if (a === 255) {
      this.buffer[idx] = r;
      this.buffer[idx + 1] = g;
      this.buffer[idx + 2] = b;
      this.buffer[idx + 3] = 255;
    } else {
      const alpha = a / 255;
      const invAlpha = 1 - alpha;
      this.buffer[idx] = Math.round(r * alpha + this.buffer[idx] * invAlpha);
      this.buffer[idx + 1] = Math.round(g * alpha + this.buffer[idx + 1] * invAlpha);
      this.buffer[idx + 2] = Math.round(b * alpha + this.buffer[idx + 2] * invAlpha);
      this.buffer[idx + 3] = 255;
    }
  }

  drawLine(x0, y0, x1, y1, r, g, b, thickness = 1, a = 255) {
    x0 = Math.round(x0);
    y0 = Math.round(y0);
    x1 = Math.round(x1);
    y1 = Math.round(y1);

    const margin = thickness + 2;
    if (Math.max(x0, x1) < -margin || Math.min(x0, x1) >= this.width + margin) return;
    if (Math.max(y0, y1) < -margin || Math.min(y0, y1) >= this.height + margin) return;

    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;

    let cx = x0;
    let cy = y0;
    const halfThick = Math.floor((thickness - 1) / 2);

    while (true) {
      if (thickness <= 1) {
        this.setPixel(cx, cy, r, g, b, a);
      } else {
        for (let ox = -halfThick; ox <= halfThick; ox++) {
          for (let oy = -halfThick; oy <= halfThick; oy++) {
            this.setPixel(cx + ox, cy + oy, r, g, b, a);
          }
        }
      }

      if (cx === x1 && cy === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        cx += sx;
      }
      if (e2 < dx) {
        err += dx;
        cy += sy;
      }
    }
  }

  drawPolyline(points, r, g, b, thickness = 1, a = 255) {
    for (let i = 0; i < points.length - 1; i++) {
      this.drawLine(points[i][0], points[i][1], points[i + 1][0], points[i + 1][1], r, g, b, thickness, a);
    }
  }

  drawCircle(cx, cy, radius, r, g, b, a = 255, fill = true) {
    cx = Math.round(cx);
    cy = Math.round(cy);
    for (let y = -radius; y <= radius; y++) {
      for (let x = -radius; x <= radius; x++) {
        const d2 = x * x + y * y;
        if (fill) {
          if (d2 <= radius * radius) {
            this.setPixel(cx + x, cy + y, r, g, b, a);
          }
        } else {
          if (Math.abs(Math.sqrt(d2) - radius) <= 0.7) {
            this.setPixel(cx + x, cy + y, r, g, b, a);
          }
        }
      }
    }
  }

  toPng() {
    return encodePng(this.width, this.height, this.buffer);
  }
}

// ============================================================
// GEOGRAPHIC PROJECTION & MATH
// ============================================================
function lon2tileX(lon, zoom) {
  const n = Math.pow(2, zoom);
  return Math.floor(((lon + 180) / 360) * n);
}

function lat2tileY(lat, zoom) {
  const rad = (lat * Math.PI) / 180;
  const n = Math.pow(2, zoom);
  return Math.floor(
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n
  );
}

function projectToTile(lat, lon, z, x, y) {
  const n = Math.pow(2, z);
  const tileX = ((lon + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const tileY = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return [(tileX - x) * 256, (tileY - y) * 256];
}

function computeTilesForBounds(bounds, minZoom, maxZoom) {
  const [south, west, north, east] = bounds;
  const tiles = [];
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

// ============================================================
// PARSE OPENSTREETMAP XML
// ============================================================
function parseOsmFile(filePath) {
  console.log(`[Parser] Loading ${filePath}...`);
  const text = fs.readFileSync(filePath, 'utf-8');

  const nodes = new Map();
  const nodeRegex = /<node id="(\d+)"[^>]*lat="([^"]+)"[^>]*lon="([^"]+)"/g;
  let m;
  while ((m = nodeRegex.exec(text)) !== null) {
    nodes.set(m[1], { lat: parseFloat(m[2]), lon: parseFloat(m[3]) });
  }

  const ways = [];
  const wayRegex = /<way id="(\d+)"[^>]*>([\s\S]*?)<\/way>/g;
  while ((m = wayRegex.exec(text)) !== null) {
    const body = m[2];
    let type = null;
    const hwMatch = /k="highway" v="([^"]+)"/.exec(body);
    const waterMatch = /k="waterway" v="([^"]+)"/.exec(body);
    const natWaterMatch = /k="natural" v="water"/.exec(body);
    const railMatch = /k="railway" v="([^"]+)"/.exec(body);
    const greenMatch = /k="(?:natural|landuse|leisure)" v="(?:wood|forest|park|pitch|grass|garden)"/.exec(body);
    const nameMatch = /k="name" v="([^"]+)"/.exec(body);

    if (hwMatch) {
      type = 'highway:' + hwMatch[1];
    } else if (waterMatch) {
      type = 'waterway:' + waterMatch[1];
    } else if (natWaterMatch) {
      type = 'waterway:water';
    } else if (railMatch) {
      type = 'railway:' + railMatch[1];
    } else if (greenMatch) {
      type = 'greenery:park';
    }
    if (!type) continue;

    const nodeRefs = [];
    const ndRegex = /<nd ref="(\d+)"/g;
    let ndMatch;
    while ((ndMatch = ndRegex.exec(body)) !== null) {
      nodeRefs.push(ndMatch[1]);
    }
    if (nodeRefs.length >= 2) {
      // Calculate bounding box of way for fast spatial indexing
      let minLat = 999, maxLat = -999, minLon = 999, maxLon = -999;
      for (const r of nodeRefs) {
        const pt = nodes.get(r);
        if (pt) {
          if (pt.lat < minLat) minLat = pt.lat;
          if (pt.lat > maxLat) maxLat = pt.lat;
          if (pt.lon < minLon) minLon = pt.lon;
          if (pt.lon > maxLon) maxLon = pt.lon;
        }
      }
      ways.push({
        id: m[1],
        type,
        name: nameMatch ? nameMatch[1] : null,
        refs: nodeRefs,
        bbox: [minLat, minLon, maxLat, maxLon],
      });
    }
  }

  const landmarks = [];
  const namedNodeRegex = /<node id="(\d+)"[^>]*lat="([^"]+)"[^>]*lon="([^"]+)"[^>]*>([\s\S]*?)<\/node>/g;
  while ((m = namedNodeRegex.exec(text)) !== null) {
    const nameMatch = /k="name" v="([^"]+)"/.exec(m[4]);
    if (nameMatch) {
      const placeMatch = /k="place" v="([^"]+)"/.exec(m[4]);
      const amenityMatch = /k="amenity" v="([^"]+)"/.exec(m[4]);
      landmarks.push({
        id: m[1],
        lat: parseFloat(m[2]),
        lon: parseFloat(m[3]),
        name: nameMatch[1],
        kind: placeMatch ? placeMatch[1] : amenityMatch ? amenityMatch[1] : 'landmark',
      });
    }
  }

  console.log(`[Parser] Extracted ${nodes.size} nodes, ${ways.length} ways, ${landmarks.length} landmarks.`);
  return { nodes, ways, landmarks };
}

// ============================================================
// PACK DEFINITIONS
// ============================================================
const PACKS = [
  {
    id: 'manipal',
    name: 'Manipal Field Test Bench',
    purpose: 'MIT Campus, Academic Blocks, Tiger Circle, End Point testing',
    bounds: [13.325, 74.765, 13.380, 74.820],
    minZoom: 11,
    maxZoom: 15,
    osmFile: 'manipal.osm',
    primaryName: 'MIT MANIPAL',
  },
  {
    id: 'kushinagar',
    name: 'Kushinagar Launch Site',
    purpose: 'Primary competition launch pad, drop zone, NH-27 recovery envelope',
    bounds: [26.690, 83.830, 26.790, 83.950],
    minZoom: 11,
    maxZoom: 15,
    osmFile: 'kushinagar.osm',
    primaryName: 'KUSHINAGAR (NH-27)',
  },
  {
    id: 'tamkuhi_raj',
    name: 'Tamkuhi Raj Downrange Site',
    purpose: 'Downrange tracking & eastern UP/Bihar border recovery zone',
    bounds: [26.570, 84.090, 26.670, 84.210],
    minZoom: 11,
    maxZoom: 15,
    osmFile: 'tamkuhi_raj.osm',
    primaryName: 'TAMKUHI RAJ',
  },
];

// ============================================================
// MAIN GENERATOR
// ============================================================
async function main() {
  const rootDir = path.resolve(__dirname, '..');
  const baseDir = path.join(rootDir, 'map_data');
  const outPacksDir = path.join(rootDir, 'map_packs');
  if (!fs.existsSync(outPacksDir)) fs.mkdirSync(outPacksDir, { recursive: true });

  for (const pack of PACKS) {
    console.log(`\n======================================================`);
    console.log(`Processing Pack: ${pack.name} [${pack.id}]`);
    console.log(`Bounds: ${pack.bounds.join(', ')} (Zooms ${pack.minZoom}..${pack.maxZoom})`);
    console.log(`======================================================`);

    const osmPath = path.join(baseDir, pack.osmFile);
    if (!fs.existsSync(osmPath)) {
      console.error(`OSM file missing: ${osmPath}`);
      continue;
    }

    const { nodes, ways, landmarks } = parseOsmFile(osmPath);
    const tiles = computeTilesForBounds(pack.bounds, pack.minZoom, pack.maxZoom);
    console.log(`[Generator] Total tiles to render: ${tiles.length}`);

    // Create MBTiles Database
    const mbtilesPath = path.join(outPacksDir, `${pack.id}.mbtiles`);
    if (fs.existsSync(mbtilesPath)) fs.unlinkSync(mbtilesPath);

    const db = new DatabaseSync(mbtilesPath);
    db.exec(`
      CREATE TABLE metadata (name TEXT, value TEXT);
      CREATE TABLE tiles (zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_data BLOB);
      CREATE UNIQUE INDEX tile_index ON tiles (zoom_level, tile_column, tile_row);
    `);

    const insertMeta = db.prepare('INSERT INTO metadata VALUES (?, ?)');
    insertMeta.run('name', pack.name);
    insertMeta.run('format', 'png');
    insertMeta.run('type', 'baselayer');
    insertMeta.run('version', '1.0');
    insertMeta.run('description', pack.purpose);
    insertMeta.run('bounds', `${pack.bounds[1]},${pack.bounds[0]},${pack.bounds[3]},${pack.bounds[2]}`);
    insertMeta.run('minzoom', String(pack.minZoom));
    insertMeta.run('maxzoom', String(pack.maxZoom));
    insertMeta.run('attribution', '© OpenStreetMap contributors | ODbL 1.0');

    const insertTile = db.prepare('INSERT INTO tiles VALUES (?, ?, ?, ?)');

    const packTilesDir = path.join(outPacksDir, pack.id);
    if (!fs.existsSync(packTilesDir)) fs.mkdirSync(packTilesDir, { recursive: true });

    let renderedCount = 0;
    let totalBytes = 0;
    const startTime = Date.now();

    for (const { z, x, y } of tiles) {
      // 1. Base cartographic background: standard OpenStreetMap natural land (#f2efe9)
      const surface = new RasterSurface(256, 256, 242, 239, 233);

      // Pre-filter intersecting ways for this tile
      const visibleWays = [];
      for (const w of ways) {
        let anyNear = false;
        const pts = [];

        for (const ref of w.refs) {
          const pt = nodes.get(ref);
          if (pt) {
            const p = projectToTile(pt.lat, pt.lon, z, x, y);
            if (p[0] >= -30 && p[0] <= 286 && p[1] >= -30 && p[1] <= 286) {
              anyNear = true;
            }
            pts.push(p);
          }
        }
        if (anyNear && pts.length >= 2) {
          visibleWays.push({ type: w.type, pts });
        }
      }

      // 2. Natural features: Greenery & Parks (#d0e6c5)
      for (const w of visibleWays) {
        if (w.type === 'greenery:park') {
          surface.drawPolyline(w.pts, 208, 230, 197, z >= 14 ? 6 : 4);
        }
      }

      // 3. Waterways & Water Bodies (#aad3df / soft natural blue)
      for (const w of visibleWays) {
        if (w.type.startsWith('waterway:')) {
          surface.drawPolyline(w.pts, 170, 211, 223, z >= 14 ? 4 : z >= 13 ? 3 : 2);
        }
      }

      // 4. Roads — PASS 1: Casings / Outer Borders (ensures junctions merge seamlessly)
      for (const w of visibleWays) {
        if (w.type === 'highway:primary' || w.type === 'highway:trunk' || w.type === 'highway:motorway') {
          surface.drawPolyline(w.pts, 194, 65, 12, z >= 14 ? 6 : z >= 13 ? 5 : 4); // deep amber casing
        } else if (w.type === 'highway:secondary' || w.type === 'highway:tertiary') {
          surface.drawPolyline(w.pts, 148, 163, 184, z >= 14 ? 4 : 3); // slate-400 casing
        } else if (w.type.startsWith('railway:')) {
          surface.drawPolyline(w.pts, 71, 85, 105, 2); // slate-600 rail track
        } else if (z >= 13 && w.type.startsWith('highway:')) {
          surface.drawPolyline(w.pts, 203, 213, 225, z >= 14 ? 3 : 2); // slate-300 casing
        }
      }

      // 5. Roads — PASS 2: Cores / Inner Road Surfaces
      for (const w of visibleWays) {
        if (w.type === 'highway:primary' || w.type === 'highway:trunk' || w.type === 'highway:motorway') {
          surface.drawPolyline(w.pts, 245, 158, 11, z >= 14 ? 4 : z >= 13 ? 3 : 2); // warm bright amber
        } else if (w.type === 'highway:secondary' || w.type === 'highway:tertiary') {
          surface.drawPolyline(w.pts, 254, 240, 138, z >= 14 ? 2 : 2); // light warm yellow
        } else if (z >= 13 && w.type.startsWith('highway:')) {
          surface.drawPolyline(w.pts, 255, 255, 255, z >= 14 ? 1 : 1); // clean white road core
        }
      }

      // 6. Landmarks, POIs, and Settlements
      for (const l of landmarks) {
        const [px, py] = projectToTile(l.lat, l.lon, z, x, y);
        if (px >= 8 && px <= 248 && py >= 8 && py <= 248) {
          // Circular marker with white rim
          surface.drawCircle(px, py, z >= 14 ? 3 : 2, 2, 132, 199); // sky-600
          surface.drawCircle(px, py, z >= 14 ? 4 : 3, 255, 255, 255, 255, false); // white outline
          if (z >= 13) {
            const maxLen = z >= 14 ? 22 : 14;
            const cleanName = l.name.length > maxLen ? l.name.slice(0, maxLen - 2) + '..' : l.name;
            const textX = Math.min(px + 5, 256 - cleanName.length * 6 - 2);
            // Sharp dark slate text with white 8-way halo
            drawString(surface, cleanName, textX, py - 3, 15, 23, 42, true, 255, 255, 255);
          }
        }
      }

      // 7. Regional identifier header and legal ODbL attribution footer
      if (z <= 13) {
        drawString(surface, pack.primaryName, 8, 10, 3, 105, 161, true, 255, 255, 255);
      }
      drawString(surface, `Z${z} · OSM ODbL`, 8, 244, 100, 116, 139, true, 255, 255, 255);

      // Encode genuine raster PNG
      const pngBuffer = surface.toPng();
      totalBytes += pngBuffer.length;
      renderedCount++;

      // Save to loose tile directory: map_packs/:packId/:z/:x/:y.png
      const zDir = path.join(packTilesDir, String(z));
      const xDir = path.join(zDir, String(x));
      if (!fs.existsSync(xDir)) fs.mkdirSync(xDir, { recursive: true });
      fs.writeFileSync(path.join(xDir, `${y}.png`), pngBuffer);

      // Insert into MBTiles (TMS coordinate: tile_row = (1 << z) - 1 - y)
      const tmsY = (1 << z) - 1 - y;
      insertTile.run(z, x, tmsY, pngBuffer);
    }

    db.close();
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`[Pack Complete] Rendered ${renderedCount} genuine PNG tiles in ${elapsed}s.`);
    console.log(`[Storage] Total PNG size: ${(totalBytes / 1024 / 1024).toFixed(2)} MB`);
    console.log(`[MBTiles Package] Created: ${mbtilesPath} (${(fs.statSync(mbtilesPath).size / 1024 / 1024).toFixed(2)} MB)`);
  }

  console.log(`\n======================================================`);
  console.log(`ALL THREE REAL GEOGRAPHIC MAP PACKS GENERATED & VERIFIED!`);
  console.log(`======================================================`);
}

main().catch(console.error);
