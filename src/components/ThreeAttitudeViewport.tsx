import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { Compass, Eye, RotateCcw, ShieldAlert } from 'lucide-react';
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

export const ThreeAttitudeViewport: React.FC<ThreeAttitudeViewportProps> = ({
  latestPacket,
  telemetrySource = 'SIMULATION',
  isStale = false,
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const satelliteGroupRef = useRef<THREE.Group | null>(null);
  const bodyMaterialRef = useRef<THREE.MeshStandardMaterial | null>(null);
  const [wireframeMode, setWireframeMode] = useState<boolean>(false);
  const [manualControl, setManualControl] = useState<boolean>(false);
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
    liveStateRef.current = {
      ...liveStateRef.current,
      manualControl: false,
      isDragging: false,
    };
    setManualControl(false);
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

    const width = mount.clientWidth || 300;
    const height = mount.clientHeight || 200;

    // 1. Scene, Camera, Renderer — Light-first CAD / Engineering Studio Background
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf1f5f9);

    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 1000);
    camera.position.set(0, 1.6, 6.8);
    camera.lookAt(0, 1.0, 0);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'low-power',
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    mount.appendChild(renderer.domElement);

    // 2. Clean Studio Lighting & Silhouette Contrast
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.45);
    keyLight.position.set(5, 9, 6);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0x94a3b8, 0.6);
    fillLight.position.set(-5, -3, -4);
    scene.add(fillLight);

    // Back rim light for crisp silhouette definition against light background
    const rimLight = new THREE.DirectionalLight(0x38bdf8, 0.5);
    rimLight.position.set(0, 4, -7);
    scene.add(rimLight);

    // 3. Coordinate Ground Plane Grid (Subtle slate reference grid on light background)
    const grid = new THREE.GridHelper(10, 20, 0x94a3b8, 0xcbd5e1);
    grid.position.y = -1.8;
    scene.add(grid);

    // 4. CanSat Satellite Vehicle Group
    const cansatGroup = new THREE.Group();
    satelliteGroupRef.current = cansatGroup;
    scene.add(cansatGroup);

    const disposables: { dispose: () => void }[] = [];

    // --- A. Main CanSat Cylindrical Chassis ---
    const bodyGeo = new THREE.CylinderGeometry(0.72, 0.72, 2.0, 32);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      metalness: 0.6,
      roughness: 0.28,
      wireframe: wireframeMode,
    });
    bodyMaterialRef.current = bodyMat;
    const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
    cansatGroup.add(bodyMesh);
    disposables.push(bodyGeo, bodyMat);

    // End Caps (Top and Bottom Bulkheads)
    const capGeo = new THREE.CylinderGeometry(0.75, 0.75, 0.08, 32);
    const capMat = new THREE.MeshStandardMaterial({
      color: 0x475569,
      metalness: 0.8,
      roughness: 0.2,
    });
    const topCap = new THREE.Mesh(capGeo, capMat);
    topCap.position.y = 1.04;
    cansatGroup.add(topCap);

    const bottomCap = new THREE.Mesh(capGeo, capMat);
    bottomCap.position.y = -1.04;
    cansatGroup.add(bottomCap);
    disposables.push(capGeo, capMat);

    // Avionics / Payload Bay Inspection Band
    const bayGeo = new THREE.CylinderGeometry(0.73, 0.73, 0.6, 32);
    const bayMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      metalness: 0.35,
      roughness: 0.25,
    });
    const bayMesh = new THREE.Mesh(bayGeo, bayMat);
    bayMesh.position.y = 0.0;
    cansatGroup.add(bayMesh);
    disposables.push(bayGeo, bayMat);

    // Sensor Stack Internal Rings
    const ringGeo = new THREE.TorusGeometry(0.735, 0.015, 8, 32);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x10b981 });
    const ring1 = new THREE.Mesh(ringGeo, ringMat);
    ring1.rotation.x = Math.PI / 2;
    ring1.position.y = 0.15;
    cansatGroup.add(ring1);
    const ring2 = new THREE.Mesh(ringGeo, ringMat);
    ring2.rotation.x = Math.PI / 2;
    ring2.position.y = -0.15;
    cansatGroup.add(ring2);
    disposables.push(ringGeo, ringMat);

    // --- B. Dual Steering Servos (Mounted on Top Bulkhead) ---
    const servoBodyGeo = new THREE.BoxGeometry(0.22, 0.16, 0.24);
    const servoMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      roughness: 0.6,
      metalness: 0.2,
    });
    const portServo = new THREE.Mesh(servoBodyGeo, servoMat);
    portServo.position.set(-0.36, 1.15, 0);
    cansatGroup.add(portServo);

    const stbdServo = new THREE.Mesh(servoBodyGeo, servoMat);
    stbdServo.position.set(0.36, 1.15, 0);
    cansatGroup.add(stbdServo);
    disposables.push(servoBodyGeo, servoMat);

    // Servo Horns / Actuator Arms (Left: Cobalt, Right: Amber)
    const hornGeo = new THREE.BoxGeometry(0.06, 0.04, 0.2);
    const portHornMat = new THREE.MeshStandardMaterial({ color: 0x2563eb, metalness: 0.5 });
    const portHorn = new THREE.Mesh(hornGeo, portHornMat);
    portHorn.position.set(-0.36, 1.24, 0.06);
    cansatGroup.add(portHorn);

    const stbdHornMat = new THREE.MeshStandardMaterial({ color: 0xd97706, metalness: 0.5 });
    const stbdHorn = new THREE.Mesh(hornGeo, stbdHornMat);
    stbdHorn.position.set(0.36, 1.24, 0.06);
    cansatGroup.add(stbdHorn);
    disposables.push(hornGeo, portHornMat, stbdHornMat);

    // --- C. Antennas & Optical Payload Port ---
    // RF Whip Antenna
    const antennaGeo = new THREE.CylinderGeometry(0.014, 0.014, 0.75, 8);
    const antennaMat = new THREE.MeshStandardMaterial({
      color: 0xd97706,
      metalness: 0.9,
      roughness: 0.2,
    });
    const antennaMesh = new THREE.Mesh(antennaGeo, antennaMat);
    antennaMesh.position.set(0, 1.45, -0.32);
    cansatGroup.add(antennaMesh);
    disposables.push(antennaGeo, antennaMat);

    // GNSS Patch Antenna
    const patchGeo = new THREE.BoxGeometry(0.2, 0.04, 0.2);
    const patchMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.3 });
    const patchMesh = new THREE.Mesh(patchGeo, patchMat);
    patchMesh.position.set(0, 1.1, 0.26);
    cansatGroup.add(patchMesh);
    disposables.push(patchGeo, patchMat);

    // Nadir Camera / Sensor Lens Port
    const lensGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.08, 16);
    const lensMat = new THREE.MeshStandardMaterial({
      color: 0x0284c7,
      roughness: 0.15,
      metalness: 0.8,
    });
    const lensMesh = new THREE.Mesh(lensGeo, lensMat);
    lensMesh.position.set(0, -1.1, 0);
    cansatGroup.add(lensMesh);
    disposables.push(lensGeo, lensMat);

    // --- D. Drogue Parachute Assembly (High-Altitude Descent: 1000m -> ~600m) ---
    // Drogue Riser Bridle
    const drogueLinePts = [new THREE.Vector3(0, 1.08, 0), new THREE.Vector3(0, 1.85, 0)];
    const drogueLineGeo = new THREE.BufferGeometry().setFromPoints(drogueLinePts);
    const drogueLineMat = new THREE.LineBasicMaterial({ color: 0x94a3b8 });
    const drogueLine = new THREE.Line(drogueLineGeo, drogueLineMat);
    cansatGroup.add(drogueLine);
    disposables.push(drogueLineGeo, drogueLineMat);

    // Drogue Chute Canopy (Orange Hemispherical Cone)
    const drogueGeo = new THREE.ConeGeometry(0.36, 0.32, 16, 1, true);
    const drogueMat = new THREE.MeshStandardMaterial({
      color: 0xf97316,
      side: THREE.DoubleSide,
      roughness: 0.5,
    });
    const drogueMesh = new THREE.Mesh(drogueGeo, drogueMat);
    drogueMesh.rotation.x = Math.PI; // Open cone facing downward
    drogueMesh.position.set(0, 2.05, 0);
    cansatGroup.add(drogueMesh);
    disposables.push(drogueGeo, drogueMat);

    // --- E. Main Steerable Parafoil Deployment Assembly (~600m to Landing) ---
    // Ram-Air Airfoil Wing Canopy (Steerable Parafoil with cell sections)
    const parafoilGroup = new THREE.Group();
    cansatGroup.add(parafoilGroup);

    const centerCellGeo = new THREE.BoxGeometry(0.72, 0.12, 0.68);
    const wingMat = new THREE.MeshStandardMaterial({
      color: 0x1d4ed8,
      roughness: 0.4,
      metalness: 0.1,
    });
    const centerCell = new THREE.Mesh(centerCellGeo, wingMat);
    centerCell.position.set(0, 3.1, 0);
    parafoilGroup.add(centerCell);

    const outerCellGeo = new THREE.BoxGeometry(0.76, 0.11, 0.65);
    const outerCellMat = new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      roughness: 0.4,
      metalness: 0.1,
    });
    const leftCell = new THREE.Mesh(outerCellGeo, outerCellMat);
    leftCell.position.set(-0.72, 3.05, 0);
    leftCell.rotation.z = 0.08; // slight anhedral arch
    parafoilGroup.add(leftCell);

    const rightCell = new THREE.Mesh(outerCellGeo, outerCellMat);
    rightCell.position.set(0.72, 3.05, 0);
    rightCell.rotation.z = -0.08;
    parafoilGroup.add(rightCell);
    disposables.push(centerCellGeo, outerCellGeo, wingMat, outerCellMat);

    // Suspension Lines (Connecting CanSat harness to Parafoil lower surface)
    const suspensionPts = [
      new THREE.Vector3(-0.2, 1.08, 0),
      new THREE.Vector3(-0.7, 3.0, -0.2),
      new THREE.Vector3(-0.2, 1.08, 0),
      new THREE.Vector3(-0.15, 3.04, -0.2),
      new THREE.Vector3(0.2, 1.08, 0),
      new THREE.Vector3(0.15, 3.04, -0.2),
      new THREE.Vector3(0.2, 1.08, 0),
      new THREE.Vector3(0.7, 3.0, -0.2),
    ];
    const suspGeo = new THREE.BufferGeometry().setFromPoints(suspensionPts);
    const suspMat = new THREE.LineBasicMaterial({ color: 0x64748b, transparent: true, opacity: 0.75 });
    const suspLines = new THREE.LineSegments(suspGeo, suspMat);
    parafoilGroup.add(suspLines);
    disposables.push(suspGeo, suspMat);

    // --- F. Dual Steering Lines (Left and Right Servos -> Parafoil Trailing Edge) ---
    // Left Steering Line (Cyan / Blue)
    const leftSteeringPts = [
      new THREE.Vector3(-0.36, 1.25, 0.15),
      new THREE.Vector3(-1.0, 3.02, 0.32),
    ];
    const leftSteerGeo = new THREE.BufferGeometry().setFromPoints(leftSteeringPts);
    const leftSteerMat = new THREE.LineBasicMaterial({ color: 0x0284c7 });
    const leftSteerLine = new THREE.Line(leftSteerGeo, leftSteerMat);
    parafoilGroup.add(leftSteerLine);
    disposables.push(leftSteerGeo, leftSteerMat);

    // Right Steering Line (Amber / Orange)
    const rightSteeringPts = [
      new THREE.Vector3(0.36, 1.25, 0.15),
      new THREE.Vector3(1.0, 3.02, 0.32),
    ];
    const rightSteerGeo = new THREE.BufferGeometry().setFromPoints(rightSteeringPts);
    const rightSteerMat = new THREE.LineBasicMaterial({ color: 0xf59e0b });
    const rightSteerLine = new THREE.Line(rightSteerGeo, rightSteerMat);
    parafoilGroup.add(rightSteerLine);
    disposables.push(rightSteerGeo, rightSteerMat);

    // 3D Body Axes Helper (X - Red Pitch, Y - Green Yaw/Spin axis, Z - Blue Roll)
    const axesHelper = new THREE.AxesHelper(1.65);
    cansatGroup.add(axesHelper);
    if (axesHelper.material instanceof THREE.Material) {
      disposables.push(axesHelper.material);
    }
    disposables.push(axesHelper.geometry);

    // Mouse Drag Orbit Controls
    let previousMousePosition = { x: 0, y: 0 };

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

    const domElement = renderer.domElement;
    domElement.addEventListener('mousedown', onMouseDown);
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
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    resizeObserver.observe(mount);

    return () => {
      resizeObserver.disconnect();
      cancelAnimationFrame(animationFrameId);
      isDraggingRef.current = false;

      domElement.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);

      disposables.forEach((resource) => {
        try {
          resource.dispose();
        } catch {
          // ignore
        }
      });

      bodyMaterialRef.current = null;
      satelliteGroupRef.current = null;
      scene.clear();
      renderer.dispose();

      if (mount && renderer.domElement && mount.contains(renderer.domElement)) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, []);

  // Update wireframe mode in-place without destroying WebGL context or losing manual drag angle
  useEffect(() => {
    if (bodyMaterialRef.current) {
      bodyMaterialRef.current.wireframe = wireframeMode;
      bodyMaterialRef.current.needsUpdate = true;
    }
  }, [wireframeMode]);

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
            onClick={() => setWireframeMode(!wireframeMode)}
            title="Toggle Chassis Wireframe Mode"
            className={`px-2 py-0.5 border cursor-pointer rounded-[var(--radius-xs)] font-medium transition-colors ${
              wireframeMode
                ? 'bg-[var(--accent-cobalt-soft)] text-[var(--accent-cobalt)] border-[var(--accent-cobalt)]/30 font-semibold'
                : 'bg-[var(--bg-surface-2)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:text-[var(--text-primary)]'
            }`}
          >
            <Eye className="w-3 h-3 inline mr-1" />
            Wireframe
          </button>

          <button
            type="button"
            onClick={handleResetView}
            title="Reset to Live Telemetry Orientation"
            className="px-2 py-0.5 bg-[var(--bg-surface-2)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border-subtle)] cursor-pointer rounded-[var(--radius-xs)] font-medium transition-colors"
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
          className="w-full h-full cursor-grab active:cursor-grabbing"
        />

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
        <div className="absolute top-2 right-2 bg-[var(--bg-surface-1)]/95 border border-[var(--border-subtle)] shadow-[var(--shadow-xs)] px-2.5 py-1 font-mono-data text-[10px] text-[var(--text-secondary)] flex items-center gap-2.5 pointer-events-none rounded-[var(--radius-xs)] backdrop-blur-xs">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-1 rounded-[1px] bg-[#b91c1c]"></span>
            <span>X: Pitch</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-1 rounded-[1px] bg-[#15803d]"></span>
            <span>Y: Yaw</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-1 rounded-[1px] bg-[#1d4ed8]"></span>
            <span>Z: Roll</span>
          </div>
        </div>

        {/* Telemetry Angle Readout Overlay Bar - Bottom */}
        <div className="absolute bottom-2.5 left-2.5 right-2.5 flex justify-between items-center bg-[var(--bg-surface-1)]/95 backdrop-blur-xs border border-[var(--border-subtle)] shadow-[var(--shadow-xs)] px-3 py-1.5 font-mono-data text-xs text-[var(--text-secondary)] rounded-[var(--radius-sm)]">
          <div className="flex gap-3.5">
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
