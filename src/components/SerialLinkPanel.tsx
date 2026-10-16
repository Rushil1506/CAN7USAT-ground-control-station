import React, { useState } from 'react';
import { Cable, Radio, Check, RefreshCw } from 'lucide-react';
import { AVAILABLE_PORTS, BAUD_RATES } from '../constants';
import { SerialConfig } from '../types';

interface SerialLinkPanelProps {
  config: SerialConfig;
  onUpdateConfig: (newConfig: Partial<SerialConfig>) => void;
  onToggleConnect: () => void;
}

export const SerialLinkPanel: React.FC<SerialLinkPanelProps> = ({
  config,
  onUpdateConfig,
  onToggleConnect,
}) => {
  const [selectedPort, setSelectedPort] = useState<string>(AVAILABLE_PORTS[0]);
  const [baudRate, setBaudRate] = useState<number>(115200);

  const handleConnectToggle = () => {
    onUpdateConfig({ port: selectedPort, baudRate });
    onToggleConnect();
  };

  return (
    <div className="telemetry-panel panel-gray-accent p-3 select-none flex flex-col gap-2">
      {/* Title */}
      <div className="flex justify-between items-center mb-1">
        <span className="font-mono-data text-xs font-bold text-[#D7C4AC] uppercase tracking-wider flex items-center gap-1.5">
          <Cable className="w-3.5 h-3.5 text-[#9F8E78]" />
          SERIAL LINK
        </span>
        <span
          className={`font-mono-data text-[10px] px-1.5 py-0.5 uppercase font-bold border ${
            config.connected
              ? 'bg-[#38FA87]/20 text-[#38FA87] border-[#38FA87]'
              : 'bg-[#32353C] text-[#9F8E78] border-[#524533]'
          }`}
        >
          {config.connected ? 'CONNECTED' : 'DISCONNECTED'}
        </span>
      </div>

      {/* Port & Baud Selectors */}
      <div className="flex gap-2">
        <select
          value={selectedPort}
          onChange={(e) => setSelectedPort(e.target.value)}
          disabled={config.connected}
          className="bg-[#1D2026] border border-[#524533] text-[#E1E2EB] font-mono-data text-xs px-2 py-1 flex-1 focus:border-[#98CBFF] outline-none h-8 rounded-none cursor-pointer disabled:opacity-50"
        >
          {AVAILABLE_PORTS.map((port) => (
            <option key={port} value={port}>
              {port}
            </option>
          ))}
        </select>

        <select
          value={baudRate}
          onChange={(e) => setBaudRate(Number(e.target.value))}
          disabled={config.connected}
          className="bg-[#1D2026] border border-[#524533] text-[#E1E2EB] font-mono-data text-xs px-2 py-1 w-24 focus:border-[#98CBFF] outline-none h-8 rounded-none cursor-pointer disabled:opacity-50 hidden sm:block"
        >
          {BAUD_RATES.map((rate) => (
            <option key={rate} value={rate}>
              {rate}
            </option>
          ))}
        </select>

        <button
          onClick={handleConnectToggle}
          title={config.connected ? 'Disconnect Serial Port' : 'Connect Serial Port'}
          className={`font-mono-data text-xs px-3 h-8 border transition-all cursor-pointer flex items-center justify-center ${
            config.connected
              ? 'bg-[#FFB4AB]/20 text-[#FFB4AB] border-[#FFB4AB] hover:bg-[#FFB4AB]/30'
              : 'bg-[#272A31] hover:bg-[#32353C] text-[#E1E2EB] border-[#524533]'
          }`}
        >
          <Cable className="w-4 h-4" />
        </button>
      </div>

      {/* Link Rx/Tx Traffic LED Activity */}
      <div className="flex justify-between items-center px-2 py-1 bg-[#0B0E14] border border-[#272A31] text-[10px] font-mono-data text-[#9F8E78]">
        <div className="flex items-center gap-1.5">
          <span>RX:</span>
          <span className="text-[#38FA87] font-bold">{config.rxCount || 1240}</span>
          <div className="w-1.5 h-1.5 rounded-full bg-[#38FA87] active-link-indicator"></div>
        </div>
        <div className="flex items-center gap-1.5">
          <span>TX:</span>
          <span className="text-[#FFD597] font-bold">{config.txCount || 42}</span>
          <div className="w-1.5 h-1.5 rounded-full bg-[#FFD597]"></div>
        </div>
        <div>115200 8N1</div>
      </div>
    </div>
  );
};
