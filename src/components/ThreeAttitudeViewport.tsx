import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { RotateCcw, Compass, Eye, ShieldAlert } from 'lucide-react';
import { TelemetryPacket } from '../types';

interface ThreeAttitudeViewportProps {
  latestPacket: TelemetryPacket | null;
}

export const ThreeAttitudeViewport: React.FC<ThreeAttitudeViewportProps> = ({ latestPacket }) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const satelliteGroupRef = useRef<THREE.Group | null>(null);
  const [wireframeMode, setWireframeMode] = useState<boolean>(false);
  const [manualControl, setManualControl] = useState<boolean>(false);

  // Validate orientation telemetry from packet
  const hasAttitudeData =
    latestPacket !== null &&
    typeof latestPacket.roll === 'number' &&
    typeof latestPacket.pitch === 'number' &&
    typeof latestPacket.yaw === 'number' &&
    !isNaN(latestPacket.roll) &&
    !isNaN(latestPacket.pitch) &&
    !isNaN(latestPacket.yaw);

  const roll = hasAttitudeData ? latestPacket!.roll : 0;
  const pitch = hasAttitudeData ? latestPacket!.pitch : 0;
  const yaw = hasAttitudeData ? latestPacket!.yaw : 0;

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const width = mount.clientWidth || 300;
    const height = mount.clientHeight || 200;

    // 1. Scene, Camera, Renderer
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x090d12);

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    camera.position.set(0, 2.4, 5.8);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    mount.appendChild(renderer.domElement);

    // 2. Controlled Aerospace Studio Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xe1e8f0, 1.2);
    keyLight.position.set(5, 8, 6);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0x56657a, 0.6);
    fillLight.position.set(-5, -4, -4);
    scene.add(fillLight);

    // 3. Coordinate Ground Plane Grid (Subtle aeronautical reference)
    const grid = new THREE.GridHelper(10, 20, 0x222c38, 0x161e28);
    grid.position.y = -1.8;
    scene.add(grid);

    // 4. CanSat Satellite Vehicle Group
    const cansatGroup = new THREE.Group();
    satelliteGroupRef.current = cansatGroup;
    scene.add(cansatGroup);

    // Array to track all allocated Three.js resources for complete cleanup on unmount
    const disposables: { dispose: () => void }[] = [];

    // Main CanSat Chassis Cylinder (Cylinder aligned along Y in Three.js geometry)
    const bodyGeo = new THREE.CylinderGeometry(0.78, 0.78, 2.2, 24);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x161e28,
      metalness: 0.6,
      roughness: 0.35,
      wireframe: wireframeMode,
    });
    const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
    cansatGroup.add(bodyMesh);
    disposables.push(bodyGeo, bodyMat);

    // Photovoltaic Solar Cell Rings
    const stripGeo = new THREE.CylinderGeometry(0.79, 0.79, 0.38, 24);
    const stripMat = new THREE.MeshStandardMaterial({
      color: 0x1c3d5a,
      roughness: 0.2,
      metalness: 0.8,
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
    const antennaMat = new THREE.MeshBasicMaterial({ color: 0xe5a93c });
    const antennaMesh = new THREE.Mesh(antennaGeo, antennaMat);
    antennaMesh.position.set(0, 1.65, 0);
    cansatGroup.add(antennaMesh);
    disposables.push(antennaGeo, antennaMat);

    // Parachute Reefing Harness Ring
    const ringGeo = new THREE.TorusGeometry(0.82, 0.025, 8, 24);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x28c76f });
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    ringMesh.rotation.x = Math.PI / 2;
    ringMesh.position.y = 1.1;
    cansatGroup.add(ringMesh);
    disposables.push(ringGeo, ringMat);

    // Nadir Camera Optical Port
    const lensGeo = new THREE.SphereGeometry(0.12, 12, 12);
    const lensMat = new THREE.MeshStandardMaterial({ color: 0x388bfd, roughness: 0.1 });
    const lensMesh = new THREE.Mesh(lensGeo, lensMat);
    lensMesh.position.set(0, 0, 0.8);
    cansatGroup.add(lensMesh);
    disposables.push(lensGeo, lensMat);

    // 3D Body Axes Helper (X - Red Pitch, Y - Green Yaw/Spin axis, Z - Blue Roll)
    const axesHelper = new THREE.AxesHelper(1.6);
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

    // Animation & Render Loop
    let animationFrameId: number;
    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);

      // Coordinate Convention:
      // radPitch -> X-axis rotation
      // radYaw   -> Y-axis rotation
      // radRoll  -> Z-axis rotation
      // Order: 'XYZ'
      if (satelliteGroupRef.current && !isDragging && hasAttitudeData) {
        const radRoll = THREE.MathUtils.degToRad(roll);
        const radPitch = THREE.MathUtils.degToRad(pitch);
        const radYaw = THREE.MathUtils.degToRad(yaw);
        satelliteGroupRef.current.rotation.set(radPitch, radYaw, radRoll, 'XYZ');
      }

      renderer.render(scene, camera);
    };

    animate();

    // Container Resize Observer
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

    // Comprehensive Resource Disposal on Unmount
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

  // Synchronize orientation updates when telemetry packet changes
  useEffect(() => {
    if (satelliteGroupRef.current && !manualControl && hasAttitudeData) {
      const radRoll = THREE.MathUtils.degToRad(roll);
      const radPitch = THREE.MathUtils.degToRad(pitch);
      const radYaw = THREE.MathUtils.degToRad(yaw);
      satelliteGroupRef.current.rotation.set(radPitch, radYaw, radRoll, 'XYZ');
    }
  }, [roll, pitch, yaw, manualControl, hasAttitudeData]);

  return (
    <div className="bg-[var(--bg-surface-1)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] flex flex-col h-full select-none overflow-hidden relative">
      {/* Header Bar */}
      <div className="p-2 sm:p-2.5 bg-[var(--bg-surface-1)] border-b border-[var(--border-subtle)] flex justify-between items-center z-10 shrink-0">
        <div className="flex items-center gap-2">
          <Compass className="w-3.5 h-3.5 text-[var(--status-info)]" />
          <span className="font-mono-data text-xs font-bold text-[var(--text-primary)] uppercase tracking-tight">
            ATTITUDE / 6-DOF VIEWPORT
          </span>
          <span className="hidden sm:inline-block font-mono-data text-[9px] px-1.5 py-0.2 bg-[var(--bg-surface-2)] text-[var(--status-info)] border border-[var(--border-subtle)] rounded-[var(--radius-xs)]">
            SIMULATED BNO055
          </span>
        </div>

        <div className="flex items-center gap-1 font-mono-data text-[10px]">
          <button
            onClick={() => setWireframeMode(!wireframeMode)}
            title="Toggle Chassis Wireframe Mode"
            className={`px-1.5 py-0.5 border cursor-pointer rounded-[var(--radius-xs)] transition-colors ${
              wireframeMode
                ? 'bg-[var(--bg-surface-elevated)] text-[var(--status-info)] border-[var(--status-info)] font-bold'
                : 'bg-[var(--bg-surface-2)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:text-[var(--text-primary)]'
            }`}
          >
            <Eye className="w-3 h-3 inline mr-1" />
            WF
          </button>

          <button
            onClick={() => setManualControl(false)}
            title="Reset to Live Telemetry Orientation"
            className="px-1.5 py-0.5 bg-[var(--bg-surface-2)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border-subtle)] cursor-pointer rounded-[var(--radius-xs)] transition-colors"
          >
            <RotateCcw className="w-3 h-3 inline mr-1" />
            RESET
          </button>
        </div>
      </div>

      {/* 3D WebGL Canvas Viewport Area */}
      <div className="flex-1 relative bg-[var(--bg-base)] min-h-[180px]">
        <div ref={mountRef} className="w-full h-full cursor-grab active:cursor-grabbing" />

        {/* Unavailable State Overlay */}
        {!hasAttitudeData && (
          <div className="absolute inset-0 bg-[#090D12]/75 backdrop-blur-xs flex items-center justify-center p-4 z-20 pointer-events-none">
            <div className="bg-[var(--bg-surface-1)] border border-[var(--border-focus)] px-3 py-2 text-center rounded-[var(--radius-md)] shadow-lg space-y-1">
              <div className="flex items-center justify-center gap-1.5 text-[var(--status-alert)] font-mono-data text-xs font-bold">
                <ShieldAlert className="w-4 h-4" />
                <span>ATTITUDE DATA UNAVAILABLE</span>
              </div>
              <p className="text-[10px] text-[var(--text-secondary)] font-mono-data">
                Awaiting valid roll, pitch, and yaw telemetry from BNO055 IMU stream.
              </p>
            </div>
          </div>
        )}

        {/* Axis Reference Legend - Top Right */}
        <div className="absolute top-2 right-2 bg-[var(--bg-surface-1)]/90 border border-[var(--border-subtle)] px-2 py-1 font-mono-data text-[9px] text-[var(--text-secondary)] flex flex-col gap-0.5 pointer-events-none rounded-[var(--radius-xs)] backdrop-blur-xs">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-0.5 bg-[#EA5455]"></span>
            <span>X: Pitch (Tilt)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-0.5 bg-[#28C76F]"></span>
            <span>Y: Yaw (Spin)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-0.5 bg-[#388BFD]"></span>
            <span>Z: Roll (Bank)</span>
          </div>
        </div>

        {/* Telemetry Angle Readout Overlay Bar - Bottom */}
        <div className="absolute bottom-2 left-2 right-2 flex justify-between items-center bg-[var(--bg-surface-1)]/90 backdrop-blur-xs border border-[var(--border-subtle)] px-2.5 py-1 font-mono-data text-xs text-[var(--text-secondary)] rounded-[var(--radius-xs)]">
          <div className="flex gap-3">
            <span>
              P (X): <strong className="text-[#EA5455] tabular-nums">{hasAttitudeData ? (pitch >= 0 ? `+${pitch.toFixed(1)}` : pitch.toFixed(1)) : '--'}°</strong>
            </span>
            <span>
              Y (Y): <strong className="text-[#28C76F] tabular-nums">{hasAttitudeData ? (yaw >= 0 ? `+${yaw.toFixed(1)}` : yaw.toFixed(1)) : '--'}°</strong>
            </span>
            <span>
              R (Z): <strong className="text-[#388BFD] tabular-nums">{hasAttitudeData ? (roll >= 0 ? `+${roll.toFixed(1)}` : roll.toFixed(1)) : '--'}°</strong>
            </span>
          </div>

          <span className="text-[10px] text-[var(--text-tertiary)] hidden sm:inline uppercase font-medium">
            {manualControl ? 'MANUAL ORBIT DRAG' : (hasAttitudeData ? 'SIMULATED BNO055 STREAM' : 'STANDBY')}
          </span>
        </div>
      </div>
    </div>
  );
};
