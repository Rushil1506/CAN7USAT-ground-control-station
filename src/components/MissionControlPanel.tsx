import React, { useState } from 'react';
import { Play, Pause, Sliders, Zap, RotateCcw, ShieldAlert } from 'lucide-react';

interface MissionControlPanelProps {
  isRunning: boolean;
  onTogglePlay: () => void;
  onCalibrateSensors: () => void;
  onInjectDisturbance: () => void;
  onResetSimulation: () => void;
}

export const MissionControlPanel: React.FC<MissionControlPanelProps> = ({
  isRunning,
  onTogglePlay,
  onCalibrateSensors,
  onInjectDisturbance,
  onResetSimulation,
}) => {
  const [calibrating, setCalibrating] = useState<boolean>(false);
  const [calibMessage, setCalibMessage] = useState<string | null>(null);

  const handleCalibrate = () => {
    setCalibrating(true);
    setCalibMessage('IMU ZEROING...');
    onCalibrateSensors();
    setTimeout(() => {
      setCalibrating(false);
      setCalibMessage('SENSORS CALIBRATED');
      setTimeout(() => setCalibMessage(null), 2500);
    }, 1800);
  };

  return (
    <div className="telemetry-panel panel-amber-accent p-3 select-none flex flex-col gap-2.5">
      {/* Title */}
      <div className="flex justify-between items-center">
        <span className="font-mono-data text-xs font-bold text-[#D7C4AC] uppercase tracking-wider">
          MISSION CONTROL
        </span>
        {calibMessage && (
          <span className="font-mono-data text-[10px] text-[#38FA87] font-bold animate-pulse">
            {calibMessage}
          </span>
        )}
      </div>

      {/* Primary Action GO Button */}
      <button
        onClick={onTogglePlay}
        className="w-full bg-[#FFB000] text-[#432C00] font-mono-data text-xs py-3 sm:py-3.5 uppercase hover:bg-[#FFD597] transition-all cursor-pointer active:opacity-80 font-extrabold tracking-widest go-button flex items-center justify-center gap-2"
      >
        {isRunning ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 fill-current" />}
        <span>{isRunning ? 'PAUSE TELEMETRY' : 'START TELEMETRY'}</span>
      </button>

      {/* Secondary Action Button: CALIBRATE SENSORS */}
      <button
        onClick={handleCalibrate}
        disabled={calibrating}
        className="w-full bg-[#272A31] text-[#E1E2EB] font-mono-data text-xs py-2 uppercase hover:bg-[#32353C] border border-[#524533] transition-colors cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-50"
      >
        <Sliders className="w-3.5 h-3.5 text-[#FFD597]" />
        <span>{calibrating ? 'CALIBRATING...' : 'CALIBRATE SENSORS'}</span>
      </button>

      {/* Quick Test / Disturbance Controls */}
      <div className="grid grid-cols-2 gap-2 mt-0.5">
        <button
          onClick={onInjectDisturbance}
          title="Inject random pitch/roll turbulence to test IMU response"
          className="bg-[#1D2026] text-[#98CBFF] hover:bg-[#272A31] border border-[#2A2E35] py-1.5 font-mono-data text-[11px] uppercase transition-colors cursor-pointer flex items-center justify-center gap-1"
        >
          <Zap className="w-3 h-3 text-[#98CBFF]" />
          TURBULENCE
        </button>

        <button
          onClick={onResetSimulation}
          title="Reset mission time to 0 and re-launch"
          className="bg-[#1D2026] text-[#D7C4AC] hover:bg-[#272A31] border border-[#2A2E35] py-1.5 font-mono-data text-[11px] uppercase transition-colors cursor-pointer flex items-center justify-center gap-1"
        >
          <RotateCcw className="w-3 h-3 text-[#9F8E78]" />
          RESTART
        </button>
      </div>
    </div>
  );
};
