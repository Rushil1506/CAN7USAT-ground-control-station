import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { RotateCcw, Compass, Eye } from 'lucide-react';
import { TelemetryPacket } from '../types';

interface ThreeAttitudeViewportProps {
  latestPacket: TelemetryPacket | null;
}

export const ThreeAttitudeViewport: React.FC<ThreeAttitudeViewportProps> = ({ latestPacket }) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const satelliteGroupRef = useRef<THREE.Group | null>(null);
  const [wireframeMode, setWireframeMode] = useState<boolean>(false);
  const [manualControl, setManualControl] = useState<boolean>(false);

  const roll = latestPacket?.roll ?? 12.0;
  const pitch = latestPacket?.pitch ?? -4.0;
  const yaw = latestPacket?.yaw ?? 0.0;

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const width = mount.clientWidth || 300;
    const height = mount.clientHeight || 200;

    // 1. Scene, Camera, Renderer
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b0e14);

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    camera.position.set(0, 2.5, 6);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);

    // 2. Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(ambientLight);

    const dirLight1 = new THREE.DirectionalLight(0x98cbff, 1.5);
    dirLight1.position.set(5, 10, 7);
    scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0xffd597, 1.0);
    dirLight2.position.set(-5, -5, -5);
    scene.add(dirLight2);

    // 3. Grid Helper & Axis Indicators
    const grid = new THREE.GridHelper(10, 20, 0x524533, 0x272a31);
    grid.position.y = -1.8;
    scene.add(grid);

    // 4. CanSat Satellite Vehicle Group
    const cansatGroup = new THREE.Group();
    satelliteGroupRef.current = cansatGroup;
    scene.add(cansatGroup);

    // CanSat Body Cylinder
    const bodyGeo = new THREE.CylinderGeometry(0.8, 0.8, 2.2, 16);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x1d2026,
      metalness: 0.8,
      roughness: 0.2,
      wireframe: wireframeMode,
    });
    const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
    cansatGroup.add(bodyMesh);

    // Solar Panel Stripes
    const stripGeo = new THREE.CylinderGeometry(0.81, 0.81, 0.4, 16);
    const stripMat = new THREE.MeshStandardMaterial({
      color: 0x00a2fd,
      emissive: 0x003558,
      metalness: 0.9,
      roughness: 0.1,
    });
    const stripMesh1 = new THREE.Mesh(stripGeo, stripMat);
    stripMesh1.position.y = 0.5;
    cansatGroup.add(stripMesh1);

    const stripMesh2 = new THREE.Mesh(stripGeo, stripMat);
    stripMesh2.position.y = -0.5;
    cansatGroup.add(stripMesh2);

    // Antenna Wire
    const antennaGeo = new THREE.CylinderGeometry(0.02, 0.02, 1.2, 8);
    const antennaMat = new THREE.MeshBasicMaterial({ color: 0xffd597 });
    const antennaMesh = new THREE.Mesh(antennaGeo, antennaMat);
    antennaMesh.position.set(0, 1.7, 0);
    cansatGroup.add(antennaMesh);

    // Parachute Mount Ring
    const ringGeo = new THREE.TorusGeometry(0.85, 0.03, 8, 24);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x38fa87 });
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    ringMesh.rotation.x = Math.PI / 2;
    ringMesh.position.y = 1.1;
    cansatGroup.add(ringMesh);

    // Camera Lens Eye
    const lensGeo = new THREE.SphereGeometry(0.15, 12, 12);
    const lensMat = new THREE.MeshStandardMaterial({ color: 0xff3b30, roughness: 0.1 });
    const lensMesh = new THREE.Mesh(lensGeo, lensMat);
    lensMesh.position.set(0, 0, 0.82);
    cansatGroup.add(lensMesh);

    // 3D Axis Indicators (X - Roll Amber/Red, Y - Pitch Green, Z - Yaw Blue)
    const axesHelper = new THREE.AxesHelper(1.8);
    // Custom axis colors
    (axesHelper.material as THREE.Material).transparent = true;
    (axesHelper.material as THREE.Material).opacity = 0.8;
    cansatGroup.add(axesHelper);

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

    // Animation Loop
    let animationFrameId: number;
    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);

      // Apply telemetry orientation if not manually dragging
      if (satelliteGroupRef.current && !isDragging) {
        // Convert Euler degrees to radians
        const radRoll = THREE.MathUtils.degToRad(roll);
        const radPitch = THREE.MathUtils.degToRad(pitch);
        const radYaw = THREE.MathUtils.degToRad(yaw);

        satelliteGroupRef.current.rotation.set(radPitch, radYaw, radRoll, 'XYZ');
      }

      renderer.render(scene, camera);
    };

    animate();

    // Resize Handler
    const handleResize = () => {
      if (!mount) return;
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationFrameId);
      domElement.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);

      if (mount && renderer.domElement) {
        mount.removeChild(renderer.domElement);
      }
      renderer.dispose();
    };
  }, [wireframeMode]);

  // Update rotation on telemetry packet change
  useEffect(() => {
    if (satelliteGroupRef.current && !manualControl) {
      const radRoll = THREE.MathUtils.degToRad(roll);
      const radPitch = THREE.MathUtils.degToRad(pitch);
      const radYaw = THREE.MathUtils.degToRad(yaw);
      satelliteGroupRef.current.rotation.set(radPitch, radYaw, radRoll, 'XYZ');
    }
  }, [roll, pitch, yaw, manualControl]);

  return (
    <div className="telemetry-panel panel-blue-accent flex flex-col h-full select-none overflow-hidden group">
      {/* Panel Header */}
      <div className="p-2 sm:p-2.5 bg-[#10131A] border-b border-[#272A31] flex justify-between items-center">
        <div className="flex items-center gap-2">
          <Compass className="w-3.5 h-3.5 text-[#98CBFF]" />
          <span className="font-mono-data text-xs font-bold text-[#D7C4AC] uppercase tracking-wider">
            ATTITUDE / 6-DOF
          </span>
        </div>

        <div className="flex items-center gap-1 font-mono-data text-[10px]">
          <button
            onClick={() => setWireframeMode(!wireframeMode)}
            title="Toggle Wireframe Mode"
            className={`px-1.5 py-0.5 border cursor-pointer ${
              wireframeMode ? 'bg-[#98CBFF] text-[#001D33] border-[#98CBFF]' : 'bg-[#1D2026] text-[#9F8E78] border-[#2A2E35]'
            }`}
          >
            <Eye className="w-3 h-3 inline mr-1" />
            WF
          </button>
          <button
            onClick={() => setManualControl(false)}
            title="Reset to Live Telemetry Orientation"
            className="px-1.5 py-0.5 bg-[#1D2026] text-[#9F8E78] hover:text-[#98CBFF] border border-[#2A2E35] cursor-pointer"
          >
            <RotateCcw className="w-3 h-3 inline mr-1" />
            RESET
          </button>
        </div>
      </div>

      {/* 3D WebGL Canvas Area */}
      <div className="flex-1 relative bg-[#0B0E14] min-h-[180px]">
        <div ref={mountRef} className="w-full h-full cursor-grab active:cursor-grabbing" />

        {/* Tactical Crosshair Watermark */}
        <div className="absolute inset-0 pointer-events-none border border-[#272A31]/30 m-2 flex items-center justify-center">
          <div className="w-12 h-12 border border-[#98CBFF]/10 rounded-full flex items-center justify-center">
            <div className="w-2 h-2 bg-[#98CBFF]/30 rounded-full"></div>
          </div>
        </div>

        {/* Telemetry Angle Readout Overlay */}
        <div className="absolute bottom-2 left-2 right-2 flex justify-between items-center bg-[#10131A]/85 backdrop-blur-sm border border-[#2A2E35] px-2.5 py-1 font-mono-data text-xs text-[#98CBFF]">
          <div className="flex gap-3">
            <span>
              R: <strong className="text-[#FFD597]">{roll >= 0 ? `+${roll}` : roll}°</strong>
            </span>
            <span>
              P: <strong className="text-[#98CBFF]">{pitch >= 0 ? `+${pitch}` : pitch}°</strong>
            </span>
            <span>
              Y: <strong className="text-[#38FA87]">{yaw >= 0 ? `+${yaw}` : yaw}°</strong>
            </span>
          </div>

          <span className="text-[10px] text-[#9F8E78] hidden sm:inline uppercase">
            {manualControl ? 'MANUAL DRAG' : 'LIVE TELEMETRY'}
          </span>
        </div>
      </div>
    </div>
  );
};
