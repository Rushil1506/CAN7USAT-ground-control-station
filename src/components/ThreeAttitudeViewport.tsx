import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { Compass, Eye, RotateCcw, ShieldAlert } from 'lucide-react';
import { TelemetryPacket, TelemetrySource } from '../types';

interface ThreeAttitudeViewportProps {
  latestPacket: TelemetryPacket | null;
  telemetrySource?: TelemetrySource;
  isStale?: boolean;
}

export const ThreeAttitudeViewport: React.FC<ThreeAttitudeViewportProps> = ({
  latestPacket,
  telemetrySource = 'SIMULATION',
  isStale = false,
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const satelliteGroupRef = useRef<THREE.Group | null>(null);
  const [wireframeMode, setWireframeMode] = useState<boolean>(false);
  const [manualControl, setManualControl] = useState<boolean>(false);

  const isSim = telemetrySource === 'SIMULATION';

  // Validate roll and pitch independently from yaw so live packets without yaw do not invent yaw
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

  const hasAttitudeData = hasRollPitch;

  const roll = hasRollPitch ? latestPacket!.roll! : 0;
  const pitch = hasRollPitch ? latestPacket!.pitch! : 0;
  // When yaw is null (live serial), hold 3D mesh Y-axis at 0 without reporting a synthetic yaw reading
  const meshYaw = hasYaw ? latestPacket!.yaw! : 0;

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const width = mount.clientWidth || 300;
    const height = mount.clientHeight || 200;

    // 1. Scene, Camera, Renderer — Light-first CAD / Engineering Studio Background
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf1f5f9);

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    camera.position.set(0, 2.4, 5.8);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'low-power',
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    mount.appendChild(renderer.domElement);

    // 2. Clean Studio Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.05);
    scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.35);
    keyLight.position.set(5, 8, 6);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xcbd5e1, 0.75);
    fillLight.position.set(-5, -4, -4);
    scene.add(fillLight);

    // 3. Coordinate Ground Plane Grid (Subtle slate reference grid on light background)
    const grid = new THREE.GridHelper(10, 20, 0x94a3b8, 0xcbd5e1);
    grid.position.y = -1.8;
    scene.add(grid);

    // 4. CanSat Satellite Vehicle Group
    const cansatGroup = new THREE.Group();
    satelliteGroupRef.current = cansatGroup;
    scene.add(cansatGroup);

    const disposables: { dispose: () => void }[] = [];

    // Main CanSat Chassis Cylinder
    const bodyGeo = new THREE.CylinderGeometry(0.78, 0.78, 2.2, 28);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      metalness: 0.45,
      roughness: 0.35,
      wireframe: wireframeMode,
    });
    const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
    cansatGroup.add(bodyMesh);
    disposables.push(bodyGeo, bodyMat);

    // Photovoltaic Solar Cell Rings (Cobalt Blue Accent)
    const stripGeo = new THREE.CylinderGeometry(0.79, 0.79, 0.38, 28);
    const stripMat = new THREE.MeshStandardMaterial({
      color: 0x1d4ed8,
      roughness: 0.25,
      metalness: 0.65,
    });
    const stripMesh1 = new THREE.Mesh(stripGeo, stripMat);
    stripMesh1.position.y = 0.52;
    cansatGroup.add(stripMesh1);

    const stripMesh2 = new THREE.Mesh(stripGeo, stripMat);
    stripMesh2.position.y = -0.52;
    cansatGroup.add(stripMesh2);
    disposables.push(stripGeo, stripMat);

    // Telemetry Antenna Whip
    const antennaGeo = new THREE.CylinderGeometry(0.018, 0.018, 1.1, 8);
    const antennaMat = new THREE.MeshBasicMaterial({ color: 0xb45309 });
    const antennaMesh = new THREE.Mesh(antennaGeo, antennaMat);
    antennaMesh.position.set(0, 1.65, 0);
    cansatGroup.add(antennaMesh);
    disposables.push(antennaGeo, antennaMat);

    // Parachute Reefing Harness Ring (Teal Accent)
    const ringGeo = new THREE.TorusGeometry(0.82, 0.028, 10, 28);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x0f766e });
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    ringMesh.rotation.x = Math.PI / 2;
    ringMesh.position.y = 1.1;
    cansatGroup.add(ringMesh);
    disposables.push(ringGeo, ringMat);

    // Nadir Camera Optical Port
    const lensGeo = new THREE.SphereGeometry(0.12, 12, 12);
    const lensMat = new THREE.MeshStandardMaterial({
      color: 0x0284c7,
      roughness: 0.15,
    });
    const lensMesh = new THREE.Mesh(lensGeo, lensMat);
    lensMesh.position.set(0, 0, 0.8);
    cansatGroup.add(lensMesh);
    disposables.push(lensGeo, lensMat);

    // 3D Body Axes Helper (X - Red Pitch, Y - Green Yaw/Spin axis, Z - Blue Roll)
    const axesHelper = new THREE.AxesHelper(1.65);
    cansatGroup.add(axesHelper);
    if (axesHelper.material instanceof THREE.Material) {
      disposables.push(axesHelper.material);
    }
    disposables.push(axesHelper.geometry);

    // Mouse Drag Orbit Controls
    let isDragging = false;
    let previousMousePosition = { x: 0, y: 0 };

    const onMouseDown = (e: MouseEvent) => {
      isDragging = true;
      setManualControl(true);
      previousMousePosition = { x: e.clientX, y: e.clientY };
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      const deltaX = e.clientX - previousMousePosition.x;
      const deltaY = e.clientY - previousMousePosition.y;

      cansatGroup.rotation.y += deltaX * 0.01;
      cansatGroup.rotation.x += deltaY * 0.01;

      previousMousePosition = { x: e.clientX, y: e.clientY };
    };

    const onMouseUp = () => {
      isDragging = false;
    };

    const domElement = renderer.domElement;
    domElement.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    let animationFrameId: number;
    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);

      if (satelliteGroupRef.current && !isDragging && hasAttitudeData) {
        const radRoll = THREE.MathUtils.degToRad(roll);
        const radPitch = THREE.MathUtils.degToRad(pitch);
        const radYaw = THREE.MathUtils.degToRad(meshYaw);
        satelliteGroupRef.current.rotation.set(radPitch, radYaw, radRoll, 'XYZ');
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

      scene.clear();
      renderer.dispose();

      if (mount && renderer.domElement) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, [wireframeMode]);

  useEffect(() => {
    if (satelliteGroupRef.current && !manualControl && hasAttitudeData) {
      const radRoll = THREE.MathUtils.degToRad(roll);
      const radPitch = THREE.MathUtils.degToRad(pitch);
      const radYaw = THREE.MathUtils.degToRad(meshYaw);
      satelliteGroupRef.current.rotation.set(radPitch, radYaw, radRoll, 'XYZ');
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
            onClick={() => setManualControl(false)}
            title="Reset to Live Telemetry Orientation"
            className="px-2 py-0.5 bg-[var(--bg-surface-2)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border-subtle)] cursor-pointer rounded-[var(--radius-xs)] font-medium transition-colors"
          >
            <RotateCcw className="w-3 h-3 inline mr-1" />
            Reset View
          </button>
        </div>
      </div>

      {/* 3D WebGL Canvas Viewport Area */}
      <div className="flex-1 relative bg-[#f1f5f9] min-h-[180px]">
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
        <div className="absolute top-2.5 right-2.5 bg-[var(--bg-surface-1)]/95 border border-[var(--border-subtle)] shadow-[var(--shadow-xs)] px-2.5 py-1.5 font-mono-data text-[10px] text-[var(--text-secondary)] flex flex-col gap-0.5 pointer-events-none rounded-[var(--radius-sm)] backdrop-blur-xs">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-0.5 bg-[#b91c1c]"></span>
            <span>X: Pitch (Tilt)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-0.5 bg-[#15803d]"></span>
            <span>Y: Yaw ({hasYaw ? 'Spin' : 'Not in CSV'})</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-0.5 bg-[#1d4ed8]"></span>
            <span>Z: Roll (Bank)</span>
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
