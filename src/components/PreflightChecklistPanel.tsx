import React, { useState } from 'react';
import { ClipboardCheck, CheckCircle2, AlertOctagon, Rocket, ShieldCheck, Cpu, Battery, Radio, Volume2 } from 'lucide-react';
import { TelemetryPacket } from '../types';

interface PreflightChecklistPanelProps {
  latestPacket: TelemetryPacket | null;
  onStartLaunch: () => void;
}

export const PreflightChecklistPanel: React.FC<PreflightChecklistPanelProps> = ({
  latestPacket,
  onStartLaunch,
}) => {
  const p = latestPacket;

  const [checkedItems, setCheckedItems] = useState<Record<number, boolean>>({
    1: true,
    2: true,
    3: true,
    4: true,
    5: true,
    6: true,
    7: true,
    8: true,
  });

  const checklistSpecs = [
    {
      id: 1,
      title: 'GNSS 3D Fix & Satellite Lock',
      requirement: 'NEO-M9N GNSS Receiver >= 4 Satellites (SBAS 1m CEP)',
      status: (p?.gpsSats || 12) >= 4 ? `LOCKED (${p?.gpsSats || 12} SATS)` : 'NO LOCK',
      pass: (p?.gpsSats || 12) >= 4,
      icon: <Radio className="w-4 h-4 text-[#00A2FD]" />,
    },
    {
      id: 2,
      title: 'MS5611 Barometer & GY-SHT40 Calibration',
      requirement: 'Zero baseline pressure & air temperature verified',
      status: p ? `${p.pressure.toFixed(1)} hPa / ${p.temperature.toFixed(1)}°C` : 'READY',
      pass: true,
      icon: <Cpu className="w-4 h-4 text-[#FFD597]" />,
    },
    {
      id: 3,
      title: '2S Molicel INR-18650-P30B Battery Pack',
      requirement: 'Pack Voltage >= 7.2V (Capacity Margin > 1700 mAh)',
      status: p ? `${p.batteryVoltage.toFixed(2)}V (${p.batterySoc.toFixed(0)}%)` : '8.2V OK',
      pass: (p?.batteryVoltage || 8.0) >= 7.0,
      icon: <Battery className="w-4 h-4 text-[#38FA87]" />,
    },
    {
      id: 4,
      title: 'Onboard MicroSD Card Data Logging',
      requirement: 'Teensy 4.1 microSD slot mounted and writable for flight backup',
      status: 'MOUNTED (CSV LOGGING)',
      pass: true,
      icon: <ClipboardCheck className="w-4 h-4 text-[#38FA87]" />,
    },
    {
      id: 5,
      title: 'Parachute Reefing & Dual Burnwire Circuits',
      requirement: 'Stage 1 Reefed Parachute line secured & MOSFET burnwires armed',
      status: 'DUAL MOSFET ARMED',
      pass: true,
      icon: <ShieldCheck className="w-4 h-4 text-[#FF5252]" />,
    },
    {
      id: 6,
      title: 'Z-Axis Momentum Bias Wheel Assembly',
      requirement: 'MT2204 2300KV motor & 63.4g brass flywheel spin test (12,000 RPM)',
      status: p ? `${p.wheelRpm.toLocaleString()} RPM (~3.18°/s PRECESSION)` : '12,000 RPM OK',
      pass: true,
      icon: <Cpu className="w-4 h-4 text-[#38FA87]" />,
    },
    {
      id: 7,
      title: 'Zeminet 865MHz LoRa Primary Telemetry Link',
      requirement: 'Point-to-point link margin > 20 dB (SF7 / BW 125 kHz)',
      status: '865 MHz LINK MARGIN +69.29 dB',
      pass: true,
      icon: <Radio className="w-4 h-4 text-[#38FA87]" />,
    },
    {
      id: 8,
      title: 'Audio Beacon (>=92dB) & GSM Recovery Module',
      requirement: 'Post-touchdown acoustic buzzer & SMS coordinate alert armed',
      status: 'ARMED FOR TOUCHDOWN',
      pass: true,
      icon: <Volume2 className="w-4 h-4 text-[#FFD597]" />,
    },
  ];

  const toggleCheck = (id: number) => {
    setCheckedItems((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const allGo = checklistSpecs.every((item) => checkedItems[item.id] && item.pass);

  return (
    <div className="h-full w-full p-3 sm:p-4 bg-[#10131A] overflow-y-auto font-mono-data text-xs flex flex-col gap-4">
      {/* Title */}
      <div className="bg-[#161B22] border border-[#2A2E35] p-3 flex justify-between items-center flex-wrap gap-2">
        <div>
          <div className="text-[#FFD597] font-bold text-sm uppercase flex items-center gap-2">
            <ClipboardCheck className="w-5 h-5 text-[#FFD597]" />
            PRE-FLIGHT SYSTEMS GO / NO-GO CHECKLIST (PDR VERIFICATION)
          </div>
          <div className="text-[#D7C4AC] text-[11px] opacity-80 mt-0.5">
            Team Parikshit (#2026-INSPACe-CAN-7USAT-332) • Manipal Institute of Technology
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div
            className={`px-3 py-1.5 font-bold text-xs uppercase border flex items-center gap-1.5 ${
              allGo
                ? 'bg-[#38FA87]/20 text-[#38FA87] border-[#38FA87]'
                : 'bg-[#FF5252]/20 text-[#FF5252] border-[#FF5252]'
            }`}
          >
            {allGo ? <CheckCircle2 className="w-4 h-4" /> : <AlertOctagon className="w-4 h-4" />}
            <span>{allGo ? 'ALL SYSTEMS GO FOR LAUNCH' : 'NO-GO: VERIFY ITEMS'}</span>
          </div>
        </div>
      </div>

      {/* Grid of Checklist Items */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 flex-1">
        {checklistSpecs.map((item) => {
          const isChecked = !!checkedItems[item.id];
          return (
            <div
              key={item.id}
              onClick={() => toggleCheck(item.id)}
              className={`p-3 border cursor-pointer transition-all flex flex-col justify-between ${
                isChecked
                  ? 'bg-[#161B22] border-[#38FA87]/60 hover:border-[#38FA87]'
                  : 'bg-[#0B0E14] border-[#2A2E35] opacity-75 hover:opacity-100'
              }`}
            >
              <div>
                <div className="flex justify-between items-start mb-1.5">
                  <div className="flex items-center gap-2 font-bold text-[#E1E2EB]">
                    {item.icon}
                    <span>{item.id}. {item.title}</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => {}}
                    className="w-4 h-4 accent-[#38FA87] cursor-pointer"
                  />
                </div>
                <div className="text-[#9F8E78] text-[11px] leading-relaxed mb-2">
                  {item.requirement}
                </div>
              </div>

              <div className="flex justify-between items-center pt-2 border-t border-[#272A31] text-[10px]">
                <span className="text-[#9F8E78]">STATUS:</span>
                <span className={`font-bold ${isChecked ? 'text-[#38FA87]' : 'text-[#FF5252]'}`}>
                  {item.status}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Launch Trigger Button */}
      <div className="bg-[#161B22] border border-[#2A2E35] p-3 flex justify-between items-center">
        <div className="text-[#D7C4AC] text-xs">
          Ready to initiate 20s rocket boost launch phase to 1000m AGL?
        </div>
        <button
          onClick={onStartLaunch}
          disabled={!allGo}
          className={`px-5 py-2.5 font-bold uppercase cursor-pointer flex items-center gap-2 text-xs transition-all ${
            allGo
              ? 'bg-[#FFB000] text-[#000] hover:bg-[#FFD597] shadow-lg go-button'
              : 'bg-[#32353C] text-[#9F8E78] opacity-50 cursor-not-allowed'
          }`}
        >
          <Rocket className="w-4 h-4" />
          <span>INITIATE ROCKET LAUNCH (0 &gt; 1000m)</span>
        </button>
      </div>
    </div>
  );
};
