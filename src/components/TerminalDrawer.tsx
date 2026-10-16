import React, { useState, useRef, useEffect } from 'react';
import { Terminal, Download, Trash2, Send, X, Copy, Check } from 'lucide-react';
import { TelemetryPacket } from '../types';

interface TerminalDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  rawLogEntries: { time: string; text: string; type: 'rx' | 'tx' | 'sys' }[];
  historyPackets: TelemetryPacket[];
  onSendCommand: (cmd: string) => void;
  onClearLogs: () => void;
}

export const TerminalDrawer: React.FC<TerminalDrawerProps> = ({
  isOpen,
  onClose,
  rawLogEntries,
  historyPackets,
  onSendCommand,
  onClearLogs,
}) => {
  const [inputCommand, setInputCommand] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'rx' | 'tx'>('all');
  const [copied, setCopied] = useState(false);
  const logEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [rawLogEntries.length, isOpen]);

  if (!isOpen) return null;

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputCommand.trim()) return;
    onSendCommand(inputCommand);
    setInputCommand('');
  };

  const downloadCsvLog = () => {
    if (historyPackets.length === 0) return;
    const headers = [
      'PacketNumber',
      'MissionTimeSec',
      'TimestampUtc',
      'Altitude_m',
      'Velocity_ms',
      'Acceleration_ms2',
      'SpinRate_degs',
      'Roll_deg',
      'Pitch_deg',
      'Yaw_deg',
      'Latitude',
      'Longitude',
      'Temp_C',
      'Pressure_kPa',
      'Batt_V',
      'StateCode',
    ].join(',');

    const rows = historyPackets.map((p) =>
      [
        p.packetNumber,
        p.missionTimeSeconds,
        p.timestampUtc,
        p.altitude,
        p.velocity,
        p.acceleration,
        p.spinRate,
        p.roll,
        p.pitch,
        p.yaw,
        p.latitude,
        p.longitude,
        p.temperature,
        p.pressure,
        p.batteryVoltage,
        p.stateCode,
      ].join(',')
    );

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers, ...rows].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `CANSAT_TELEMETRY_LOG_${new Date().toISOString().slice(0, 19)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const copyToClipboard = () => {
    const text = rawLogEntries.map((l) => `[${l.time}] [${l.type.toUpperCase()}] ${l.text}`).join('\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const filteredLogs = rawLogEntries.filter((l) => {
    if (filterType === 'all') return true;
    return l.type === filterType;
  });

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 bg-[#10131A]/95 border-t-2 border-[#FFD597] shadow-2xl backdrop-blur-md flex flex-col h-80 sm:h-96 select-none">
      {/* Drawer Header */}
      <div className="flex justify-between items-center px-4 py-2 bg-[#161B22] border-b border-[#272A31]">
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-[#FFD597]" />
          <span className="font-mono-data text-xs font-bold text-[#E1E2EB] uppercase tracking-wider">
            RAW SERIAL TERMINAL & TELEMETRY LOGS
          </span>
          <span className="font-mono-data text-[10px] text-[#38FA87] bg-[#1D2026] px-2 py-0.5 border border-[#2A2E35]">
            115200 BAUD / NMEA 0183
          </span>
        </div>

        <div className="flex items-center gap-2 font-mono-data text-xs">
          {/* Filter */}
          <div className="flex bg-[#1D2026] border border-[#2A2E35] p-0.5 text-[10px]">
            {(['all', 'rx', 'tx'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilterType(f)}
                className={`px-2 py-0.5 uppercase cursor-pointer ${
                  filterType === f ? 'bg-[#272A31] text-[#FFD597]' : 'text-[#9F8E78] hover:text-[#E1E2EB]'
                }`}
              >
                {f}
              </button>
            ))}
          </div>

          <button
            onClick={copyToClipboard}
            title="Copy Logs"
            className="p-1.5 bg-[#1D2026] hover:bg-[#272A31] text-[#D7C4AC] border border-[#2A2E35] cursor-pointer"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-[#38FA87]" /> : <Copy className="w-3.5 h-3.5" />}
          </button>

          <button
            onClick={downloadCsvLog}
            className="px-2.5 py-1 bg-[#272A31] hover:bg-[#32353C] text-[#FFD597] border border-[#524533] cursor-pointer flex items-center gap-1 text-[11px]"
          >
            <Download className="w-3.5 h-3.5" />
            <span>EXPORT CSV ({historyPackets.length})</span>
          </button>

          <button
            onClick={onClearLogs}
            title="Clear Terminal"
            className="p-1.5 bg-[#1D2026] hover:bg-[#272A31] text-[#FFB4AB] border border-[#2A2E35] cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={onClose}
            className="p-1.5 text-[#9F8E78] hover:text-[#FFD597] cursor-pointer ml-2"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Terminal Output Console */}
      <div className="flex-1 p-3 overflow-y-auto font-mono-data text-xs text-[#E1E2EB] space-y-1 bg-[#0B0E14]">
        {filteredLogs.length === 0 ? (
          <div className="text-[#9F8E78] text-center mt-12 italic">
            NO TELEMETRY LOGS RECORDED YET...
          </div>
        ) : (
          filteredLogs.map((log, idx) => (
            <div key={idx} className="flex gap-2 items-start leading-relaxed hover:bg-[#1D2026]/40 px-1">
              <span className="text-[#9F8E78] select-none text-[10px] min-w-[65px]">{log.time}</span>
              <span
                className={`text-[10px] font-bold uppercase px-1 min-w-[32px] text-center ${
                  log.type === 'rx'
                    ? 'text-[#38FA87] bg-[#38FA87]/10'
                    : log.type === 'tx'
                    ? 'text-[#FFD597] bg-[#FFD597]/10'
                    : 'text-[#98CBFF] bg-[#98CBFF]/10'
                }`}
              >
                {log.type}
              </span>
              <span
                className={`break-all ${
                  log.type === 'tx' ? 'text-[#FFD597] font-semibold' : 'text-[#D7C4AC]'
                }`}
              >
                {log.text}
              </span>
            </div>
          ))
        )}
        <div ref={logEndRef} />
      </div>

      {/* Command Uplink Form */}
      <form onSubmit={handleSend} className="flex gap-2 p-2 bg-[#161B22] border-t border-[#272A31]">
        <div className="flex items-center text-[#FFD597] font-mono-data text-xs pl-2">
          UPLINK_CMD&gt;
        </div>
        <input
          type="text"
          value={inputCommand}
          onChange={(e) => setInputCommand(e.target.value)}
          placeholder="Enter uplink command e.g. $CMD,CANSAT,CALIB,101 or $CMD,CANSAT,DEPLOY"
          className="flex-1 bg-[#0B0E14] border border-[#524533] text-[#FFD597] font-mono-data text-xs px-3 py-1.5 outline-none focus:border-[#FFD597]"
        />
        <button
          type="submit"
          className="bg-[#FFB000] hover:bg-[#FFD597] text-[#432C00] font-mono-data text-xs font-bold px-4 py-1.5 uppercase cursor-pointer transition-colors flex items-center gap-1"
        >
          <Send className="w-3.5 h-3.5" />
          SEND
        </button>
      </form>
    </div>
  );
};
