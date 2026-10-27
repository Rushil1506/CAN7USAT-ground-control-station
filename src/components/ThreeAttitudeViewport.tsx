import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { Compass, RotateCcw, ShieldAlert } from 'lucide-react';
import { TelemetryPacket, TelemetrySource } from '../types';

interface ThreeAttitudeViewportProps {
  latestPacket: TelemetryPacket | null;
  telemetrySource?: TelemetrySource;
  isStale?: boolean;
}

export interface AttitudeViewportState {
  rollDeg: number;
  pitchDeg: number;
  yawDeg: number;
  hasAttitudeData: boolean;
  hasYaw: boolean;
  manualControl: boolean;
  isDragging: boolean;
}

export interface MeshEulerRad {
  x: number;
  y: number;
  z: number;
}

export interface CanSatStlDimensionsMm {
  widthMm: number;
  depthMm: number;
  totalHeightMm: number;
  cylinderHeightMm: number;
}

/**
 * Public path to the authoritative CanSat CAD assembly STL asset.
 *
 * Verified STL geometry properties (CANSATassembly.stl):
 * - Format: Binary STL, 170,334 triangles (8,516,784 bytes), 0 degenerate/NaN faces
 * - Raw units: Millimetres (mm)
 * - Raw X span: [-72.9318, +72.9330] mm (145.86 mm outer cylinder diameter)
 * - Raw Y span: [-72.9147, +72.9371] mm (145.85 mm outer cylinder diameter)
 * - Raw Z span: [-519.1168, +0.2794] mm (519.40 mm total; main 4-bay cylindrical chassis
 *   spans Z = [-400.0, +0.28] mm = 400.3 mm, while the top Parachute Bay hinged deployment
 *   lid extends in its open 90° state from Z = -400.0 mm to -519.12 mm)
 * - Raw orientation: +Z is the Battery Bay bottom; -Z is the Parachute Bay top.
 */
export const CANSAT_STL_ASSET_URL = '/models/CANSATassembly.stl';

/**
 * Uniform metric scale factor: 1.0 scene unit = 200 mm (0.005 scene units / mm).
 * Under this uniform scale:
 * - 145.86 mm cylinder diameter -> 0.7293 scene units (radius 0.3647)
 * - 400.00 mm cylinder height   -> 2.0000 scene units (Y in [-1.00, +1.00])
 * - 519.40 mm deployed height   -> 2.5970 scene units (open lid reaches Y = +1.595)
 */
export const CANSAT_MM_TO_SCENE_SCALE = 0.005;
export const CANSAT_CYLINDER_HALF_HEIGHT_MM = 200.0;

/**
 * Pure helper computing attitude viewport state from a telemetry packet and interaction flags.
 * Exported for deterministic regression testing of null -> live packet arrival and manual drag persistence.
 */
export function deriveAttitudeViewportState(
  latestPacket: TelemetryPacket | null,
  manualControl: boolean,
  isDragging: boolean
): AttitudeViewportState {
  const hasRollPitch =
    latestPacket !== null &&
    typeof latestPacket.roll === 'number' &&
    typeof latestPacket.pitch === 'number' &&
    Number.isFinite(latestPacket.roll) &&
    Number.isFinite(latestPacket.pitch);

  const hasYaw =
    latestPacket !== null &&
    typeof latestPacket.yaw === 'number' &&
    Number.isFinite(latestPacket.yaw);

  return {
    rollDeg: hasRollPitch ? latestPacket!.roll! : 0,
    pitchDeg: hasRollPitch ? latestPacket!.pitch! : 0,
    yawDeg: hasYaw ? latestPacket!.yaw! : 0,
    hasAttitudeData: hasRollPitch,
    hasYaw,
    manualControl,
    isDragging,
  };
}

/**
 * Computes the next 3D mesh Euler rotation (radians) on an animation frame or telemetry update.
 * When `isDragging` or `manualControl` is active, preserves the current manual rotation.
 * When telemetry control is active and `hasAttitudeData` is true, applies telemetry pitch/yaw/roll.
 */
export function computeNextMeshRotation(
  currentRotation: MeshEulerRad,
  state: AttitudeViewportState
): MeshEulerRad {
  if (state.isDragging || state.manualControl || !state.hasAttitudeData) {
    return currentRotation;
  }
  return {
    x: THREE.MathUtils.degToRad(state.pitchDeg),
    y: THREE.MathUtils.degToRad(state.yawDeg),
    z: THREE.MathUtils.degToRad(state.rollDeg),
  };
}

/**
 * Orients, centers, and uniformly scales the raw CanSat STL BufferGeometry into the
 * Three.js Y-up aerospace coordinate frame without non-uniform distortion.
 *
 * Coordinate transformation applied:
 * 1. Rotate -90° around Z so the hinged Parachute Bay lid (+X in raw STL) moves to -Y (aft after X rotation).
 * 2. Rotate +90° around X so raw -Z (Parachute Bay top) maps to +Y (Up) and raw +Z (Battery Bay bottom) maps to -Y (Down).
 * 3. Center X and Z around the cylinder's geometric axis, and center Y at the 400 mm cylinder midpoint (+200 mm from base).
 * 4. Apply uniform scale `CANSAT_MM_TO_SCENE_SCALE` (0.005 scene units/mm).
 */
export function normalizeCanSatStlGeometry(rawGeometry: THREE.BufferGeometry): {
  geometry: THREE.BufferGeometry;
  dimensionsMm: CanSatStlDimensionsMm;
} {
  const geometry = rawGeometry.clone();

  // 1. Align raw STL axes to Three.js Y-up coordinate system
  geometry.rotateZ(-Math.PI / 2);
  geometry.rotateX(Math.PI / 2);

  geometry.computeBoundingBox();
  const bbox = geometry.boundingBox!;

  const widthMm = bbox.max.x - bbox.min.x;
  const depthMm = bbox.max.z - bbox.min.z;
  const totalHeightMm = bbox.max.y - bbox.min.y;
  const cylinderHeightMm = 400.0;

  const centerX = 0.5 * (bbox.min.x + bbox.max.x);
  const centerZ = 0.5 * (bbox.min.z + bbox.max.z);
  // Base of Battery Bay is at bbox.min.y (~ -0.28 mm); midpoint of the 400 mm cylinder is bbox.min.y + 200 mm
  const cylinderCenterY = bbox.min.y + CANSAT_CYLINDER_HALF_HEIGHT_MM;

  // 2. Center around cylinder origin and apply strict uniform scale
  geometry.translate(-centerX, -cylinderCenterY, -centerZ);
  geometry.scale(
    CANSAT_MM_TO_SCENE_SCALE,
    CANSAT_MM_TO_SCENE_SCALE,
    CANSAT_MM_TO_SCENE_SCALE
  );

  if (!geometry.getAttribute('normal')) {
    geometry.computeVertexNormals();
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  return {
    geometry,
    dimensionsMm: {
      widthMm,
      depthMm,
      totalHeightMm,
      cylinderHeightMm,
    },
  };
}

// Module-level cache so the 8.12 MB STL is fetched and parsed only once across tab switches
let cachedCanSatAssetPromise: Promise<{
  geometry: THREE.BufferGeometry;
  dimensionsMm: CanSatStlDimensionsMm;
}> | null = null;

function loadCanSatStlAsset(url: string = CANSAT_STL_ASSET_URL): Promise<{
  geometry: THREE.BufferGeometry;
  dimensionsMm: CanSatStlDimensionsMm;
}> {
  if (!cachedCanSatAssetPromise) {
    cachedCanSatAssetPromise = new Promise((resolve, reject) => {
      const loader = new STLLoader();
      loader.load(
        url,
        (rawGeo) => {
          try {
            const normalized = normalizeCanSatStlGeometry(rawGeo);
            rawGeo.dispose();
            resolve(normalized);
          } catch (err) {
            cachedCanSatAssetPromise = null;
            reject(err);
          }
        },
        undefined,
        (err) => {
          cachedCanSatAssetPromise = null;
          reject(err);
        }
      );
    });
  }
  return cachedCanSatAssetPromise;
}

/**
 * Evaluates a 3D point on the inflated ram-air parafoil canopy.
 *
 * @param cellIndex Cell index in [0 .. N_CELLS - 1]
 * @param u Local spanwise fraction within the cell [0 .. 1]
 * @param v Chordwise fraction from leading edge (0) to trailing edge (1)
 * @param surface 'upper' | 'lower'
 */
function evaluateParafoilSurfacePoint(
  cellIndex: number,
  numCells: number,
  u: number,
  v: number,
  surface: 'upper' | 'lower'
): THREE.Vector3 {
  // Normalized spanwise coordinate eta in [-1, +1]
  const eta = -1 + (2 * (cellIndex + u)) / numCells;
  const absEta = Math.abs(eta);

  // Spanwise anhedral arch parameters (proportional to 0.73-unit CanSat diameter)
  const archRadius = 3.25;
  const maxArchAngleRad = 0.40; // ~23 deg anhedral arch at wingtips
  const archApexY = 2.68;

  const theta = eta * maxArchAngleRad;
  const sinT = Math.sin(theta);
  const cosT = Math.cos(theta);

  const baseX = archRadius * sinT;
  const baseY = archApexY - archRadius * (1 - cosT);

  // Planform chord taper (elliptical rounded wingtips) & subtle sweep
  const rootChord = 1.14;
  const chordScale = Math.sqrt(Math.max(0.28, 1 - 0.14 * eta * eta - 0.30 * Math.pow(absEta, 4)));
  const chord = rootChord * chordScale;
  const sweepZ = -0.055 * rootChord * (eta * eta);

  // Ram-air intake cutback on lower surface near leading edge (v in [0..0.065])
  const intakeCutback = 0.062;
  const effV = surface === 'lower' ? intakeCutback + (1 - intakeCutback) * v : v;

  // Airfoil camber and thickness distribution (chambered ram-air parafoil section)
  const thicknessTaper = 0.52 + 0.48 * Math.sqrt(Math.max(0, 1 - 0.55 * eta * eta));
  const camber = 0.062 * chord * thicknessTaper * (4 * effV * (1 - effV));

  const sqrtV = Math.sqrt(Math.max(0, effV));
  const nacaThickness =
    0.168 *
    chord *
    thicknessTaper *
    (1.4845 * sqrtV -
      0.63 * effV -
      1.758 * effV * effV +
      1.4215 * Math.pow(effV, 3) -
      0.5075 * Math.pow(effV, 4));

  // Pressurized cell lobing (pillowing between sewn vertical ribs, zero at trailing edge)
  const cellLobing = Math.sin(Math.PI * u);
  const chordEnvelope = Math.sin(Math.PI * Math.pow(effV, 0.68));

  let localHeight: number;
  if (surface === 'upper') {
    const upperPillow = 0.030 * chord * cellLobing * chordEnvelope;
    // Slight leading-edge nose droop for authentic ram-air profile
    const noseDroop = -0.018 * chord * Math.pow(1 - effV, 6);
    localHeight = camber + 0.66 * nacaThickness + upperPillow + noseDroop;
  } else {
    const lowerPillow = 0.012 * chord * cellLobing * chordEnvelope;
    // Angle intake lip downward slightly at v = 0 to form an open ram-air mouth
    const intakeLipDrop = -0.022 * chord * Math.pow(1 - v, 4);
    localHeight = camber - 0.34 * nacaThickness - lowerPillow + intakeLipDrop * (1 - v);
  }

  // Ensure upper and lower skins meet cleanly at the trailing edge (v = 1)
  const teBlend = 1 - Math.pow(v, 6);
  localHeight *= teBlend;

  // Local Z from leading edge (+Z forward) to trailing edge (-Z aft)
  const posZ = sweepZ + (0.48 - effV) * chord;
  const posX = baseX + localHeight * sinT;
  const posY = baseY + localHeight * cosT;

  return new THREE.Vector3(posX, posY, posZ);
}

/**
 * Builds a single cell's upper or lower curved skin BufferGeometry.
 */
function buildParafoilCellSkinGeometry(
  cellIndex: number,
  numCells: number,
  surface: 'upper' | 'lower',
  segU: number = 10,
  segV: number = 22
): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];

  for (let iu = 0; iu <= segU; iu++) {
    const u = iu / segU;
    for (let iv = 0; iv <= segV; iv++) {
      const v = iv / segV;
      const pt = evaluateParafoilSurfacePoint(cellIndex, numCells, u, v, surface);
      positions.push(pt.x, pt.y, pt.z);
    }
  }

  const stride = segV + 1;
  for (let iu = 0; iu < segU; iu++) {
    for (let iv = 0; iv < segV; iv++) {
      const a = iu * stride + iv;
      const b = (iu + 1) * stride + iv;
      const c = (iu + 1) * stride + (iv + 1);
      const d = iu * stride + (iv + 1);

      if (surface === 'upper') {
        indices.push(a, d, b);
        indices.push(b, d, c);
      } else {
        indices.push(a, b, d);
        indices.push(b, c, d);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Builds an internal vertical airfoil rib wall at rib boundary `ribIndex` in [0 .. numCells].
 */
function buildParafoilRibGeometry(
  ribIndex: number,
  numCells: number,
  segV: number = 22
): THREE.BufferGeometry {
  const cellIndex = Math.min(ribIndex, numCells - 1);
  const u = ribIndex === numCells ? 1.0 : 0.0;

  const positions: number[] = [];
  const indices: number[] = [];

  for (let iv = 0; iv <= segV; iv++) {
    const v = iv / segV;
    const upperPt = evaluateParafoilSurfacePoint(cellIndex, numCells, u, v, 'upper');
    const lowerPt = evaluateParafoilSurfacePoint(cellIndex, numCells, u, v, 'lower');
    positions.push(upperPt.x, upperPt.y, upperPt.z);
    positions.push(lowerPt.x, lowerPt.y, lowerPt.z);
  }

  for (let iv = 0; iv < segV; iv++) {
    const u0 = iv * 2;
    const l0 = iv * 2 + 1;
    const u1 = (iv + 1) * 2;
    const l1 = (iv + 1) * 2 + 1;

    indices.push(u0, l0, u1);
    indices.push(l0, l1, u1);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Constructs the complete procedural inflated 7-cell ram-air parafoil canopy and
 * clean suspension rigging lines connecting to the CanSat's upper Parachute Bay rim.
 */
export function buildRamAirParafoilAssembly(): {
  group: THREE.Group;
  disposables: { dispose: () => void }[];
  canopyAttachmentPoints: THREE.Vector3[];
  riserPoints: { port: THREE.Vector3; starboard: THREE.Vector3 };
} {
  const NUM_CELLS = 7;
  const SEG_U = 10;
  const SEG_V = 22;

  const group = new THREE.Group();
  const disposables: { dispose: () => void }[] = [];

  // Restrained technical aerospace canopy materials (matte ripstop nylon)
  const centerFabricMat = new THREE.MeshStandardMaterial({
    color: 0xf1f5f9, // Crisp technical off-white
    roughness: 0.58,
    metalness: 0.02,
    side: THREE.DoubleSide,
  });
  const midFabricMat = new THREE.MeshStandardMaterial({
    color: 0x334155, // Technical aerospace slate
    roughness: 0.60,
    metalness: 0.03,
    side: THREE.DoubleSide,
  });
  const tipFabricMat = new THREE.MeshStandardMaterial({
    color: 0xd97706, // Flight-test recovery amber accent
    roughness: 0.58,
    metalness: 0.03,
    side: THREE.DoubleSide,
  });
  const ribFabricMat = new THREE.MeshStandardMaterial({
    color: 0x64748b, // Internal baffle medium slate for clear intake cell definition
    roughness: 0.70,
    metalness: 0.02,
    side: THREE.DoubleSide,
  });

  disposables.push(centerFabricMat, midFabricMat, tipFabricMat, ribFabricMat);

  // 1. Build inflated upper and lower cell skins
  for (let c = 0; c < NUM_CELLS; c++) {
    const isTip = c === 0 || c === NUM_CELLS - 1;
    const isMid = c === 1 || c === NUM_CELLS - 2;
    const cellMat = isTip ? tipFabricMat : isMid ? midFabricMat : centerFabricMat;

    const upperGeo = buildParafoilCellSkinGeometry(c, NUM_CELLS, 'upper', SEG_U, SEG_V);
    const lowerGeo = buildParafoilCellSkinGeometry(c, NUM_CELLS, 'lower', SEG_U, SEG_V);

    const upperMesh = new THREE.Mesh(upperGeo, cellMat);
    const lowerMesh = new THREE.Mesh(lowerGeo, cellMat);

    group.add(upperMesh, lowerMesh);
    disposables.push(upperGeo, lowerGeo);
  }

  // 2. Build internal vertical airfoil ribs (seals wingtips and forms leading-edge intake baffles)
  const seamPoints: THREE.Vector3[] = [];
  for (let r = 0; r <= NUM_CELLS; r++) {
    const ribGeo = buildParafoilRibGeometry(r, NUM_CELLS, SEG_V);
    const ribMesh = new THREE.Mesh(ribGeo, ribFabricMat);
    group.add(ribMesh);
    disposables.push(ribGeo);

    // Subtle rib seam lines along upper and lower rib boundaries
    const cellIdx = Math.min(r, NUM_CELLS - 1);
    const u = r === NUM_CELLS ? 1.0 : 0.0;
    for (let iv = 0; iv < SEG_V; iv++) {
      const v0 = iv / SEG_V;
      const v1 = (iv + 1) / SEG_V;
      const pU0 = evaluateParafoilSurfacePoint(cellIdx, NUM_CELLS, u, v0, 'upper');
      const pU1 = evaluateParafoilSurfacePoint(cellIdx, NUM_CELLS, u, v1, 'upper');
      seamPoints.push(pU0, pU1);

      const pL0 = evaluateParafoilSurfacePoint(cellIdx, NUM_CELLS, u, v0, 'lower');
      const pL1 = evaluateParafoilSurfacePoint(cellIdx, NUM_CELLS, u, v1, 'lower');
      seamPoints.push(pL0, pL1);
    }
  }

  const seamGeo = new THREE.BufferGeometry().setFromPoints(seamPoints);
  const seamMat = new THREE.LineBasicMaterial({
    color: 0x475569,
    transparent: true,
    opacity: 0.45,
  });
  const seamLines = new THREE.LineSegments(seamGeo, seamMat);
  group.add(seamLines);
  disposables.push(seamGeo, seamMat);

  // 3. Build clean, symmetrical suspension lines (Port & Starboard cascades to Parachute Bay top rim)
  const portRiser = new THREE.Vector3(-0.24, 1.04, 0.0);
  const starboardRiser = new THREE.Vector3(0.24, 1.04, 0.0);

  // Canopy rib stations for line attachment: Port ribs (1, 2) and Starboard ribs (5, 6)
  // Chordwise attachment stations on lower rib surface: forward (v=0.18) and aft (v=0.72)
  const lineChordStations = [0.18, 0.72];
  const portRibs = [1, 2];
  const starboardRibs = [5, 6];

  const riggingSegmentPts: THREE.Vector3[] = [];
  const canopyAttachmentPoints: THREE.Vector3[] = [];

  for (const r of portRibs) {
    for (const vStation of lineChordStations) {
      const attachPt = evaluateParafoilSurfacePoint(r, NUM_CELLS, 0.0, vStation, 'lower');
      canopyAttachmentPoints.push(attachPt);
      riggingSegmentPts.push(attachPt, portRiser);
    }
  }

  for (const r of starboardRibs) {
    for (const vStation of lineChordStations) {
      const attachPt = evaluateParafoilSurfacePoint(r, NUM_CELLS, 0.0, vStation, 'lower');
      canopyAttachmentPoints.push(attachPt);
      riggingSegmentPts.push(attachPt, starboardRiser);
    }
  }

  // Short harness riser V-bridles anchoring into the CanSat Parachute Bay top rim (Y = +0.98, radius ~0.27)
  const portAnchorFwd = new THREE.Vector3(-0.26, 0.98, 0.09);
  const portAnchorAft = new THREE.Vector3(-0.26, 0.98, -0.09);
  const stbdAnchorFwd = new THREE.Vector3(0.26, 0.98, 0.09);
  const stbdAnchorAft = new THREE.Vector3(0.26, 0.98, -0.09);

  riggingSegmentPts.push(
    portRiser,
    portAnchorFwd,
    portRiser,
    portAnchorAft,
    starboardRiser,
    stbdAnchorFwd,
    starboardRiser,
    stbdAnchorAft
  );

  const riggingGeo = new THREE.BufferGeometry().setFromPoints(riggingSegmentPts);
  const riggingMat = new THREE.LineBasicMaterial({
    color: 0x475569,
    transparent: true,
    opacity: 0.82,
  });
  const riggingLines = new THREE.LineSegments(riggingGeo, riggingMat);
  group.add(riggingLines);
  disposables.push(riggingGeo, riggingMat);

  return {
    group,
    disposables,
    canopyAttachmentPoints,
    riserPoints: { port: portRiser, starboard: starboardRiser },
  };
}

export const DEFAULT_CAMERA_TARGET = { x: 0, y: 0.82, z: 0 } as const;
export const DEFAULT_CAMERA_OFFSET = { x: 2.55, y: 0.93, z: 7.15 } as const;

/**
 * Computes responsive camera position along the approved three-quarter aerospace sightline.
 * On desktop / wide aspect ratios (aspect >= 1.15 and height >= 210) with zoomMultiplier = 1,
 * returns the exact baseline (2.55, 1.75, 7.15). On narrower mobile/tablet aspect ratios or
 * short viewports, scales camera distance outward so the CanSat, 7-cell parafoil, and
 * suspension rigging are never clipped horizontally or vertically.
 */
export function computeResponsiveCameraPosition(
  width: number,
  height: number,
  zoomMultiplier: number = 1.0
): { x: number; y: number; z: number } {
  const safeW = Math.max(1, width);
  const safeH = Math.max(1, height);
  const aspect = safeW / safeH;

  let responsiveScale = 1.0;
  if (aspect < 1.15) {
    responsiveScale = Math.min(1.45, Math.max(1.0, 1.15 / Math.max(0.55, aspect)));
  }
  if (safeW < 420 || safeH < 245) {
    responsiveScale = Math.max(responsiveScale, 1.12);
  }

  const clampedZoom = THREE.MathUtils.clamp(zoomMultiplier, 0.58, 1.52);
  const totalScale = THREE.MathUtils.clamp(responsiveScale * clampedZoom, 0.58, 1.85);
  return {
    x: DEFAULT_CAMERA_TARGET.x + DEFAULT_CAMERA_OFFSET.x * totalScale,
    y: DEFAULT_CAMERA_TARGET.y + DEFAULT_CAMERA_OFFSET.y * totalScale,
    z: DEFAULT_CAMERA_TARGET.z + DEFAULT_CAMERA_OFFSET.z * totalScale,
  };
}

export const ThreeAttitudeViewport: React.FC<ThreeAttitudeViewportProps> = ({
  latestPacket,
  telemetrySource = 'SIMULATION',
  isStale = false,
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const satelliteGroupRef = useRef<THREE.Group | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const userZoomMultiplierRef = useRef<number>(1.0);
  const [manualControl, setManualControl] = useState<boolean>(false);
  const [modelLoadState, setModelLoadState] = useState<'LOADING' | 'READY' | 'ERROR'>('LOADING');
  const [modelErrorMsg, setModelErrorMsg] = useState<string | null>(null);
  const isDraggingRef = useRef<boolean>(false);

  const isSim = telemetrySource === 'SIMULATION';

  const derived = deriveAttitudeViewportState(
    latestPacket,
    manualControl,
    isDraggingRef.current
  );
  const {
    rollDeg: roll,
    pitchDeg: pitch,
    yawDeg: meshYaw,
    hasAttitudeData,
    hasYaw,
  } = derived;
  const hasRollPitch = hasAttitudeData;

  // Live ref read by the 60fps requestAnimationFrame loop to prevent stale mount closures
  const liveStateRef = useRef<AttitudeViewportState>(derived);
  liveStateRef.current = derived;

  const handleResetView = () => {
    isDraggingRef.current = false;
    userZoomMultiplierRef.current = 1.0;
    liveStateRef.current = {
      ...liveStateRef.current,
      manualControl: false,
      isDragging: false,
    };
    setManualControl(false);
    if (cameraRef.current) {
      const mount = mountRef.current;
      const w = mount?.clientWidth || 400;
      const h = mount?.clientHeight || 300;
      const camPos = computeResponsiveCameraPosition(w, h, 1.0);
      cameraRef.current.position.set(camPos.x, camPos.y, camPos.z);
      cameraRef.current.lookAt(
        DEFAULT_CAMERA_TARGET.x,
        DEFAULT_CAMERA_TARGET.y,
        DEFAULT_CAMERA_TARGET.z
      );
    }
    if (satelliteGroupRef.current) {
      if (liveStateRef.current.hasAttitudeData) {
        satelliteGroupRef.current.rotation.set(
          THREE.MathUtils.degToRad(liveStateRef.current.pitchDeg),
          THREE.MathUtils.degToRad(liveStateRef.current.yawDeg),
          THREE.MathUtils.degToRad(liveStateRef.current.rollDeg),
          'XYZ'
        );
      } else {
        satelliteGroupRef.current.rotation.set(0, 0, 0, 'XYZ');
      }
    }
  };

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let isDisposed = false;
    const width = mount.clientWidth || 300;
    const height = mount.clientHeight || 200;

    // 1. Scene, Camera, Renderer — Light-first CAD / Engineering Studio Background
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf1f5f9);

    // Three-quarter aerospace camera framing both the CanSat STL and inflated ram-air parafoil
    const camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 100);
    const initialCamPos = computeResponsiveCameraPosition(
      width,
      height,
      userZoomMultiplierRef.current
    );
    camera.position.set(initialCamPos.x, initialCamPos.y, initialCamPos.z);
    camera.lookAt(
      DEFAULT_CAMERA_TARGET.x,
      DEFAULT_CAMERA_TARGET.y,
      DEFAULT_CAMERA_TARGET.z
    );
    cameraRef.current = camera;

    const maxPixelRatio = width < 640 ? 1.5 : 2;
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxPixelRatio));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    mount.appendChild(renderer.domElement);

    // 2. Balanced Engineering Studio Lighting (Readable Voronoi depth & smooth canopy shading)
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0xcbd5e1, 1.25);
    hemiLight.position.set(0, 10, 0);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.45);
    keyLight.position.set(5.5, 8.5, 6.5);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xf1f5f9, 0.85);
    fillLight.position.set(-5.5, 2.8, 4.5);
    scene.add(fillLight);

    const underFillLight = new THREE.DirectionalLight(0xe2e8f0, 0.85);
    underFillLight.position.set(1.5, -6.5, 5.0);
    scene.add(underFillLight);

    const rimLight = new THREE.DirectionalLight(0xbae6fd, 0.55);
    rimLight.position.set(0, 4.5, -6.5);
    scene.add(rimLight);

    // 3. Coordinate Ground Plane Grid (Positioned cleanly below CanSat base at Y = -1.35)
    const grid = new THREE.GridHelper(10, 20, 0x94a3b8, 0xcbd5e1);
    grid.position.y = -1.35;
    scene.add(grid);

    // 4. Unified CanSat + Parafoil Vehicle Assembly Group (Rotates coherently around CanSat center)
    const cansatGroup = new THREE.Group();
    satelliteGroupRef.current = cansatGroup;
    scene.add(cansatGroup);

    const disposables: { dispose: () => void }[] = [];

    // --- A. Inflated Ram-Air Parafoil Canopy & Clean Suspension Rigging ---
    const parafoil = buildRamAirParafoilAssembly();
    cansatGroup.add(parafoil.group);
    disposables.push(...parafoil.disposables);

    // --- B. Authoritative CanSat CAD Assembly Mesh (CANSATassembly.stl) ---
    const cansatMat = new THREE.MeshStandardMaterial({
      color: 0x475569, // Technical satin slate-graphite HT PLA engineering polymer
      roughness: 0.46,
      metalness: 0.06,
      side: THREE.DoubleSide,
    });
    disposables.push(cansatMat);

    loadCanSatStlAsset(CANSAT_STL_ASSET_URL)
      .then(({ geometry }) => {
        if (isDisposed) return;
        const stlMesh = new THREE.Mesh(geometry, cansatMat);
        cansatGroup.add(stlMesh);
        setModelLoadState('READY');
        setModelErrorMsg(null);
      })
      .catch((err) => {
        if (isDisposed) return;
        const reason = err instanceof Error ? err.message : String(err);
        setModelLoadState('ERROR');
        setModelErrorMsg(`Failed to load ${CANSAT_STL_ASSET_URL}: ${reason}`);

        // Minimal fallback boundary envelope cylinder if asset cannot load
        const fallbackGeo = new THREE.CylinderGeometry(0.365, 0.365, 2.0, 32);
        const fallbackMesh = new THREE.Mesh(fallbackGeo, cansatMat);
        cansatGroup.add(fallbackMesh);
        disposables.push(fallbackGeo);
      });

    // --- C. Subtle 3D Body Axes Reference Indicator at Vehicle Origin ---
    const axesHelper = new THREE.AxesHelper(1.25);
    cansatGroup.add(axesHelper);
    if (axesHelper.material instanceof THREE.Material) {
      disposables.push(axesHelper.material);
    }
    disposables.push(axesHelper.geometry);

    // 5. Mouse Drag Orbit, Touch Drag Orbit, Pinch Zoom & Scroll Zoom Controls
    let previousMousePosition = { x: 0, y: 0 };
    let previousTouchPosition = { x: 0, y: 0 };
    let previousPinchDistance: number | null = null;

    const updateCameraFromZoom = () => {
      if (!mount) return;
      const w = mount.clientWidth || 400;
      const h = mount.clientHeight || 300;
      const camPos = computeResponsiveCameraPosition(w, h, userZoomMultiplierRef.current);
      camera.position.set(camPos.x, camPos.y, camPos.z);
      camera.lookAt(DEFAULT_CAMERA_TARGET.x, DEFAULT_CAMERA_TARGET.y, DEFAULT_CAMERA_TARGET.z);
    };

    const onMouseDown = (e: MouseEvent) => {
      isDraggingRef.current = true;
      liveStateRef.current = {
        ...liveStateRef.current,
        manualControl: true,
        isDragging: true,
      };
      setManualControl(true);
      previousMousePosition = { x: e.clientX, y: e.clientY };
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const deltaX = e.clientX - previousMousePosition.x;
      const deltaY = e.clientY - previousMousePosition.y;

      cansatGroup.rotation.y += deltaX * 0.01;
      cansatGroup.rotation.x += deltaY * 0.01;

      previousMousePosition = { x: e.clientX, y: e.clientY };
    };

    const onMouseUp = () => {
      if (!isDraggingRef.current) return;
      isDraggingRef.current = false;
      liveStateRef.current = {
        ...liveStateRef.current,
        isDragging: false,
      };
    };

    const getTouchPinchDistance = (touches: TouchList): number => {
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      return Math.hypot(dx, dy);
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        isDraggingRef.current = true;
        previousPinchDistance = null;
        liveStateRef.current = {
          ...liveStateRef.current,
          manualControl: true,
          isDragging: true,
        };
        setManualControl(true);
        previousTouchPosition = {
          x: e.touches[0].clientX,
          y: e.touches[0].clientY,
        };
      } else if (e.touches.length === 2) {
        previousPinchDistance = getTouchPinchDistance(e.touches);
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 1 && isDraggingRef.current) {
        e.preventDefault();
        const deltaX = e.touches[0].clientX - previousTouchPosition.x;
        const deltaY = e.touches[0].clientY - previousTouchPosition.y;

        cansatGroup.rotation.y += deltaX * 0.01;
        cansatGroup.rotation.x += deltaY * 0.01;

        previousTouchPosition = {
          x: e.touches[0].clientX,
          y: e.touches[0].clientY,
        };
      } else if (e.touches.length === 2) {
        e.preventDefault();
        const currentDist = getTouchPinchDistance(e.touches);
        if (previousPinchDistance !== null && previousPinchDistance > 8) {
          const pinchRatio = previousPinchDistance / Math.max(8, currentDist);
          userZoomMultiplierRef.current = THREE.MathUtils.clamp(
            userZoomMultiplierRef.current * pinchRatio,
            0.58,
            1.52
          );
          updateCameraFromZoom();
        }
        previousPinchDistance = currentDist;
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) {
        previousPinchDistance = null;
      }
      if (e.touches.length === 1) {
        previousTouchPosition = {
          x: e.touches[0].clientX,
          y: e.touches[0].clientY,
        };
      } else if (e.touches.length === 0) {
        if (isDraggingRef.current) {
          isDraggingRef.current = false;
          liveStateRef.current = {
            ...liveStateRef.current,
            isDragging: false,
          };
        }
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      userZoomMultiplierRef.current = THREE.MathUtils.clamp(
        userZoomMultiplierRef.current + e.deltaY * 0.00055,
        0.58,
        1.52
      );
      updateCameraFromZoom();
    };

    const domElement = renderer.domElement;
    domElement.addEventListener('mousedown', onMouseDown);
    domElement.addEventListener('wheel', onWheel, { passive: false });
    domElement.addEventListener('touchstart', onTouchStart, { passive: true });
    domElement.addEventListener('touchmove', onTouchMove, { passive: false });
    domElement.addEventListener('touchend', onTouchEnd);
    domElement.addEventListener('touchcancel', onTouchEnd);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    let animationFrameId: number;
    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);

      const group = satelliteGroupRef.current;
      const currentState = liveStateRef.current;
      if (group) {
        const nextRot = computeNextMeshRotation(
          { x: group.rotation.x, y: group.rotation.y, z: group.rotation.z },
          currentState
        );
        if (
          !currentState.isDragging &&
          !currentState.manualControl &&
          currentState.hasAttitudeData
        ) {
          group.rotation.set(nextRot.x, nextRot.y, nextRot.z, 'XYZ');
        }
      }

      renderer.render(scene, camera);
    };

    animate();

    const resizeObserver = new ResizeObserver(() => {
      if (!mount) return;
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      if (w === 0 || h === 0) return;
      camera.aspect = w / h;
      const camPos = computeResponsiveCameraPosition(w, h, userZoomMultiplierRef.current);
      camera.position.set(camPos.x, camPos.y, camPos.z);
      camera.lookAt(DEFAULT_CAMERA_TARGET.x, DEFAULT_CAMERA_TARGET.y, DEFAULT_CAMERA_TARGET.z);
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    resizeObserver.observe(mount);

    return () => {
      isDisposed = true;
      resizeObserver.disconnect();
      cancelAnimationFrame(animationFrameId);
      isDraggingRef.current = false;

      domElement.removeEventListener('mousedown', onMouseDown);
      domElement.removeEventListener('wheel', onWheel);
      domElement.removeEventListener('touchstart', onTouchStart);
      domElement.removeEventListener('touchmove', onTouchMove);
      domElement.removeEventListener('touchend', onTouchEnd);
      domElement.removeEventListener('touchcancel', onTouchEnd);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);

      disposables.forEach((resource) => {
        try {
          resource.dispose();
        } catch {
          // ignore
        }
      });

      cameraRef.current = null;
      satelliteGroupRef.current = null;
      scene.clear();
      renderer.dispose();

      if (mount && renderer.domElement && mount.contains(renderer.domElement)) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, []);

  // Synchronize orientation immediately when telemetry updates and manual orbit control is inactive
  useEffect(() => {
    const group = satelliteGroupRef.current;
    const currentState = liveStateRef.current;
    if (
      group &&
      !currentState.isDragging &&
      !currentState.manualControl &&
      currentState.hasAttitudeData
    ) {
      const nextRot = computeNextMeshRotation(
        { x: group.rotation.x, y: group.rotation.y, z: group.rotation.z },
        currentState
      );
      group.rotation.set(nextRot.x, nextRot.y, nextRot.z, 'XYZ');
    }
  }, [roll, pitch, meshYaw, manualControl, hasAttitudeData]);

  return (
    <div className="ops-card flex flex-col h-full select-none overflow-hidden relative">
      {/* Header Bar */}
      <div className="px-3 py-2 bg-[var(--bg-surface-1)] border-b border-[var(--border-subtle)] flex justify-between items-center z-10 shrink-0">
        <div className="flex items-center gap-2">
          <Compass className="w-4 h-4 text-[var(--accent-cobalt)]" />
          <span className="text-xs font-bold text-[var(--text-primary)] tracking-tight">
            3D Attitude &amp; Orientation Viewport
          </span>
          <span
            className={`hidden sm:inline-block font-mono-data text-[10px] font-semibold px-1.5 py-0.5 border rounded-[var(--radius-xs)] ${
              isSim
                ? 'bg-[var(--status-info-bg)] text-[var(--accent-cobalt)] border-[var(--accent-cobalt)]/25'
                : isStale
                ? 'bg-[var(--status-warning-bg)] text-[var(--status-warning)] border-[var(--status-warning)]/40'
                : 'bg-[var(--accent-teal-soft)] text-[var(--accent-teal)] border-[var(--accent-teal)]/30'
            }`}
          >
            {isSim ? 'SIMULATED BNO055' : 'LIVE IMU (ROLL / PITCH)'}
          </span>
        </div>

        <div className="flex items-center gap-1.5 text-[11px]">
          <button
            type="button"
            onClick={handleResetView}
            title="Reset to Live Telemetry Orientation"
            className="min-h-[30px] sm:min-h-0 px-2.5 py-1 sm:px-2 sm:py-0.5 bg-[var(--bg-surface-2)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border-subtle)] cursor-pointer rounded-[var(--radius-xs)] font-medium transition-colors"
          >
            <RotateCcw className="w-3 h-3 inline mr-1" />
            Reset View
          </button>
        </div>
      </div>

      {/* 3D WebGL Canvas Viewport Area */}
      <div className="flex-1 relative bg-[#f1f5f9] min-h-[130px]">
        <div
          ref={mountRef}
          className="w-full h-full cursor-grab active:cursor-grabbing touch-none"
        />

        {/* Asset Loading / Error Banner */}
        {modelLoadState === 'LOADING' && (
          <div className="absolute top-2 left-2 bg-[var(--bg-surface-1)]/90 border border-[var(--border-subtle)] px-2 py-0.5 rounded-[var(--radius-xs)] font-mono-data text-[10px] text-[var(--text-secondary)] pointer-events-none z-10">
            Loading CAD Mesh (CANSATassembly.stl)...
          </div>
        )}
        {modelLoadState === 'ERROR' && modelErrorMsg && (
          <div className="absolute top-2 left-2 bg-[var(--status-alert-bg)] border border-[var(--status-alert)]/40 px-2.5 py-1 rounded-[var(--radius-xs)] font-mono-data text-[10px] text-[var(--status-alert)] pointer-events-none z-10 max-w-xs">
            {modelErrorMsg}
          </div>
        )}

        {/* Unavailable State Overlay */}
        {!hasAttitudeData && (
          <div className="absolute inset-0 bg-[var(--bg-surface-2)]/80 backdrop-blur-xs flex items-center justify-center p-4 z-20 pointer-events-none">
            <div className="bg-[var(--bg-surface-1)] border border-[var(--border-strong)] px-4 py-3 text-center rounded-[var(--radius-md)] shadow-[var(--shadow-md)] space-y-1 max-w-xs">
              <div className="flex items-center justify-center gap-1.5 text-[var(--status-alert)] text-xs font-bold">
                <ShieldAlert className="w-4 h-4" />
                <span>ATTITUDE TELEMETRY UNAVAILABLE</span>
              </div>
              <p className="text-[11px] text-[var(--text-secondary)]">
                {isSim
                  ? 'Awaiting valid roll and pitch telemetry from simulator.'
                  : 'Awaiting valid roll and pitch telemetry from live USB serial stream.'}
              </p>
            </div>
          </div>
        )}

        {/* Axis Reference Legend - Top Right */}
        <div className="absolute top-2 right-2 bg-[var(--bg-surface-1)]/95 border border-[var(--border-subtle)] shadow-[var(--shadow-xs)] px-2 py-0.5 sm:px-2.5 sm:py-1 font-mono-data text-[9px] sm:text-[10px] text-[var(--text-secondary)] flex items-center gap-2 sm:gap-2.5 pointer-events-none rounded-[var(--radius-xs)] backdrop-blur-xs">
          <div className="flex items-center gap-1 sm:gap-1.5">
            <span className="w-2 sm:w-2.5 h-1 rounded-[1px] bg-[#b91c1c]"></span>
            <span>X: Pitch</span>
          </div>
          <div className="flex items-center gap-1 sm:gap-1.5">
            <span className="w-2 sm:w-2.5 h-1 rounded-[1px] bg-[#15803d]"></span>
            <span>Y: Yaw</span>
          </div>
          <div className="flex items-center gap-1 sm:gap-1.5">
            <span className="w-2 sm:w-2.5 h-1 rounded-[1px] bg-[#1d4ed8]"></span>
            <span>Z: Roll</span>
          </div>
        </div>

        {/* Telemetry Angle Readout Overlay Bar - Bottom */}
        <div className="absolute bottom-2 left-2 right-2 sm:bottom-2.5 sm:left-2.5 sm:right-2.5 flex justify-between items-center bg-[var(--bg-surface-1)]/95 backdrop-blur-xs border border-[var(--border-subtle)] shadow-[var(--shadow-xs)] px-2.5 py-1 sm:px-3 sm:py-1.5 font-mono-data text-[11px] sm:text-xs text-[var(--text-secondary)] rounded-[var(--radius-sm)]">
          <div className="flex gap-2.5 sm:gap-3.5">
            <span>
              Pitch:{' '}
              <strong className="text-[#b91c1c] tabular-nums">
                {hasRollPitch
                  ? `${pitch >= 0 ? `+${pitch.toFixed(1)}` : pitch.toFixed(1)}°`
                  : '--'}
              </strong>
            </span>
            <span
              title={
                hasYaw
                  ? 'Yaw orientation angle'
                  : 'Yaw is not transmitted in live serial CSV'
              }
            >
              Yaw:{' '}
              <strong
                className={`tabular-nums ${
                  hasYaw ? 'text-[#15803d]' : 'text-[var(--text-tertiary)]'
                }`}
              >
                {hasYaw
                  ? `${meshYaw >= 0 ? `+${meshYaw.toFixed(1)}` : meshYaw.toFixed(1)}°`
                  : 'N/A'}
              </strong>
            </span>
            <span>
              Roll:{' '}
              <strong className="text-[#1d4ed8] tabular-nums">
                {hasRollPitch
                  ? `${roll >= 0 ? `+${roll.toFixed(1)}` : roll.toFixed(1)}°`
                  : '--'}
              </strong>
            </span>
          </div>

          <span className="text-[10px] text-[var(--text-tertiary)] hidden sm:inline uppercase font-semibold">
            {manualControl
              ? 'MANUAL ORBIT DRAG'
              : !hasAttitudeData
              ? 'STANDBY'
              : isSim
              ? 'SIMULATED STREAM'
              : isStale
              ? 'STALE ROLL/PITCH'
              : 'LIVE ROLL/PITCH'}
          </span>
        </div>
      </div>
    </div>
  );
};
