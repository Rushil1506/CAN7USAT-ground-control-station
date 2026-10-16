import React, { useState } from 'react';
import { Settings as SettingsIcon, X, Volume2, Radio, Info } from 'lucide-react';
import { TEAM_INFO } from '../constants';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const [telemetryRate, setTelemetryRate] = useState<number>(10);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [unitSystem, setUnitSystem] = useState<'METRIC' | 'IMPERIAL'>('METRIC');
  const [callsign, setCallsign] = useState<string>(TEAM_INFO.id);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-[#0B0E14]/80 backdrop-blur-md flex items-center justify-center p-4 select-none">
      <div className="bg-[#161B22] border border-[#524533] w-full max-w-lg p-5 shadow-2xl relative flex flex-col gap-4 font-mono-data text-xs">
        {/* Header */}
        <div className="flex justify-between items-center border-b border-[#524533] pb-3">
          <div className="flex items-center gap-2 text-[#FFD597]">
            <SettingsIcon className="w-5 h-5" />
            <h3 className="font-bold uppercase tracking-wider text-sm">
              GROUND STATION & TEAM HARDWARE CONFIGURATION
            </h3>
          </div>
          <button onClick={onClose} className="text-[#9F8E78] hover:text-[#E1E2EB] cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Team Metadata Box */}
        <div className="bg-[#0B0E14] border border-[#272A31] p-3 space-y-1 text-[11px] text-[#D7C4AC]">
          <div className="text-[#FFD597] font-bold">{TEAM_INFO.name} ({TEAM_INFO.id})</div>
          <div>Institution: {TEAM_INFO.institution}</div>
          <div>Faculty Mentor: {TEAM_INFO.facultyAdvisor}</div>
          <div className="text-[10px] text-[#9F8E78] pt-1 border-t border-[#272A31]">
            Team Members: {TEAM_INFO.members.join(', ')}
          </div>
        </div>

        {/* Form Fields */}
        <div className="flex flex-col gap-3">
          {/* Mission Callsign */}
          <div className="flex flex-col gap-1">
            <label className="text-[#9F8E78] uppercase">UNIQUE TEAM IDENTIFIER (NET ID / PAN ID):</label>
            <input
              type="text"
              value={callsign}
              onChange={(e) => setCallsign(e.target.value)}
              className="bg-[#0B0E14] border border-[#524533] text-[#E1E2EB] px-3 py-1.5 outline-none focus:border-[#FFD597]"
            />
          </div>

          {/* Telemetry Refresh Rate */}
          <div className="flex flex-col gap-1">
            <label className="text-[#9F8E78] uppercase">LORA TELEMETRY SAMPLE RATE (Hz):</label>
            <div className="grid grid-cols-4 gap-2">
              {[1, 5, 10, 20].map((rate) => (
                <button
                  key={rate}
                  onClick={() => setTelemetryRate(rate)}
                  className={`py-1.5 border uppercase cursor-pointer ${
                    telemetryRate === rate
                      ? 'bg-[#FFB000] text-[#000] font-bold border-[#FFB000]'
                      : 'bg-[#1D2026] text-[#D7C4AC] border-[#2A2E35] hover:bg-[#272A31]'
                  }`}
                >
                  {rate} Hz
                </button>
              ))}
            </div>
          </div>

          {/* Unit System */}
          <div className="flex flex-col gap-1">
            <label className="text-[#9F8E78] uppercase">UNIT DISPLAY SYSTEM:</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setUnitSystem('METRIC')}
                className={`py-1.5 border uppercase cursor-pointer ${
                  unitSystem === 'METRIC'
                    ? 'bg-[#00A2FD] text-[#001D33] font-bold border-[#00A2FD]'
                    : 'bg-[#1D2026] text-[#D7C4AC] border-[#2A2E35]'
                }`}
              >
                METRIC (m, m/s, °C, hPa)
              </button>
              <button
                onClick={() => setUnitSystem('IMPERIAL')}
                className={`py-1.5 border uppercase cursor-pointer ${
                  unitSystem === 'IMPERIAL'
                    ? 'bg-[#00A2FD] text-[#001D33] font-bold border-[#00A2FD]'
                    : 'bg-[#1D2026] text-[#D7C4AC] border-[#2A2E35]'
                }`}
              >
                IMPERIAL (ft, ft/s, °F, psi)
              </button>
            </div>
          </div>

          {/* Sound Alerts */}
          <div className="flex justify-between items-center p-2 bg-[#0B0E14] border border-[#2A2E35]">
            <span className="text-[#D7C4AC] flex items-center gap-2">
              <Volume2 className="w-4 h-4 text-[#38FA87]" /> RECOVERY AUDIO BEACON STATUS BEEP
            </span>
            <button
              onClick={() => setSoundEnabled(!soundEnabled)}
              className={`px-3 py-1 font-bold cursor-pointer ${
                soundEnabled ? 'bg-[#38FA87] text-[#003918]' : 'bg-[#32353C] text-[#9F8E78]'
              }`}
            >
              {soundEnabled ? 'ENABLED' : 'MUTED'}
            </button>
          </div>
        </div>

        {/* Save Button */}
        <button
          onClick={onClose}
          className="bg-[#FFB000] hover:bg-[#FFD597] text-[#000] font-bold py-2.5 uppercase transition-colors cursor-pointer mt-2"
        >
          SAVE CONFIGURATION
        </button>
      </div>
    </div>
  );
};
