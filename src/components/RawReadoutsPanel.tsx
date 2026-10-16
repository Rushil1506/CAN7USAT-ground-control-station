import React from 'react';
import { ListFilter, Battery, Cpu, Volume2, Radio, Wind, Sparkles } from 'lucide-react';
import { TelemetryPacket } from '../types';

interface RawReadoutsPanelProps {
  latestPacket: TelemetryPacket | null;
  historyPackets?: TelemetryPacket[];
}

export const RawReadoutsPanel: React.FC<RawReadoutsPanelProps> = ({ latestPacket, historyPackets = [] }) => {
  const p = latestPacket || {
    temperature: 24.2,
    pressure: 958.4,
    batteryVoltage: 7.85,
    currentDraw: 2.45,
    power: 19.2,
    batterySoc: 85.0,
    gpsSats: 12,
    altitude: 450.2,
    packetNumber: 1240,
    rssi: -68,
    humidity: 58.0,
    wheelRpm: 12000,
    spinRate: 3.18,
    co2: 412.0,
    pm2_5: 11.5,
    uv: 4.2,
    audioBeaconActive: false,
    gsmModuleActive: false,
  };

  return (
    <div className="telemetry-panel panel-gray-accent p-3 select-none flex flex-col gap-2">
      {/* Header */}
      <div className="flex justify-between items-center mb-1">
        <span className="font-mono-data text-xs font-bold text-[#D7C4AC] uppercase tracking-wider flex items-center gap-1.5">
          <ListFilter className="w-3.5 h-3.5 text-[#9F8E78]" />
          TELEMETRY & SENSORS SUMMARY
        </span>
        <span className="font-mono-data text-[10px] text-[#38FA87] bg-[#1D2026] px-1.5 py-0.5 border border-[#2A2E35]">
          PDR SPECIFICATION
        </span>
      </div>

      {/* Grid of Raw Readouts */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 font-mono-data text-xs text-[#D7C4AC]">
        {/* Air Temp (SHT40) */}
        <div className="flex justify-between border-b border-[#272A31] pb-1 items-center">
          <span className="text-[#9F8E78]">TEMP (SHT40):</span>
          <span className="text-[#E1E2EB] font-semibold">{p.temperature.toFixed(1)}°C</span>
        </div>

        {/* Pressure (MS5611) */}
        <div className="flex justify-between border-b border-[#272A31] pb-1 items-center">
          <span className="text-[#9F8E78]">BARO PRES:</span>
          <span className="text-[#E1E2EB] font-semibold">{p.pressure.toFixed(1)} hPa</span>
        </div>

        {/* Humidity (SHT40) */}
        <div className="flex justify-between border-b border-[#272A31] pb-1 items-center">
          <span className="text-[#9F8E78]">HUMIDITY:</span>
          <span className="text-[#00A2FD] font-semibold">{p.humidity.toFixed(1)}% RH</span>
        </div>

        {/* Momentum Wheel RPM */}
        <div className="flex justify-between border-b border-[#272A31] pb-1 items-center">
          <span className="text-[#9F8E78]">DCS FLYWHEEL:</span>
          <span className="text-[#38FA87] font-bold">{p.wheelRpm.toLocaleString()} RPM</span>
        </div>

        {/* 2S Molicel Battery Pack */}
        <div className="col-span-2 flex justify-between border-b border-[#272A31] pb-1.5 pt-1 items-center bg-[#0B0E14]/60 px-2 my-0.5 border-l-2 border-l-[#38FA87]">
          <div className="flex items-center gap-1.5">
            <Battery className="w-3.5 h-3.5 text-[#38FA87]" />
            <span className="text-[#9F8E78]">2S BATT:</span>
            <span className="text-[#38FA87] font-bold text-xs">{p.batteryVoltage.toFixed(2)}V</span>
            <span className="text-[10px] text-[#9F8E78]">({p.batterySoc.toFixed(0)}%)</span>
          </div>

          <div className="flex items-center gap-2 text-[10px] text-[#D7C4AC]">
            <span className="text-[#9F8E78]">I: <strong className="text-[#FFD597]">{p.currentDraw.toFixed(2)}A</strong></span>
            <span className="text-[#9F8E78]">P: <strong className="text-[#FFD597]">{p.power.toFixed(1)}W</strong></span>
          </div>
        </div>

        {/* Environmental Bonus Sensors Section */}
        <div className="col-span-2 pt-1">
          <div className="text-[10px] text-[#FFD597] font-bold uppercase mb-1 flex items-center gap-1">
            <Sparkles className="w-3 h-3 text-[#FFD597]" />
            ENVIRONMENTAL SENSORS (BONUS OBJECTIVES)
          </div>
          <div className="grid grid-cols-3 gap-1 bg-[#10131A] p-1.5 border border-[#272A31] text-[10px]">
            <div>
              <span className="text-[#9F8E78] block">CO₂ (SCD40):</span>
              <span className="text-[#38FA87] font-bold">{p.co2.toFixed(1)} ppm</span>
            </div>
            <div>
              <span className="text-[#9F8E78] block">PM2.5 (SPS30):</span>
              <span className="text-[#38FA87] font-bold">{p.pm2_5.toFixed(1)} µg/m³</span>
            </div>
            <div>
              <span className="text-[#9F8E78] block">UV (LTR390):</span>
              <span className="text-[#FFD597] font-bold">{p.uv.toFixed(1)} Index</span>
            </div>
          </div>
        </div>

        {/* Recovery Subsystem Status */}
        <div className="col-span-2 flex justify-between items-center pt-1 border-t border-[#272A31] mt-1 text-[10px]">
          <div className="flex items-center gap-1">
            <Volume2 className={`w-3.5 h-3.5 ${p.audioBeaconActive ? 'text-[#38FA87] animate-pulse' : 'text-[#9F8E78]'}`} />
            <span>92dB BUZZER: <strong className={p.audioBeaconActive ? 'text-[#38FA87]' : 'text-[#9F8E78]'}>{p.audioBeaconActive ? 'BUZZING' : 'STANDBY'}</strong></span>
          </div>
          <div className="flex items-center gap-1">
            <Radio className={`w-3.5 h-3.5 ${p.gsmModuleActive ? 'text-[#38FA87] animate-pulse' : 'text-[#9F8E78]'}`} />
            <span>GSM SMS: <strong className={p.gsmModuleActive ? 'text-[#38FA87]' : 'text-[#9F8E78]'}>{p.gsmModuleActive ? 'TRANSMITTING' : 'READY'}</strong></span>
          </div>
        </div>
      </div>
    </div>
  );
};
