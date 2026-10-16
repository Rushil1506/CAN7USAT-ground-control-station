import React from 'react';
import { ChevronDown, Layers } from 'lucide-react';
import { FLIGHT_STATES } from '../constants';
import { FlightStateCode, TelemetryPacket } from '../types';

interface FlightStatePanelProps {
  latestPacket: TelemetryPacket | null;
  onOverrideState: (state: FlightStateCode | null) => void;
}

export const FlightStatePanel: React.FC<FlightStatePanelProps> = ({
  latestPacket,
  onOverrideState,
}) => {
  const currentStateCode = latestPacket?.stateCode ?? FlightStateCode.DESCENT;
  const stateInfo = FLIGHT_STATES[currentStateCode] || FLIGHT_STATES[FlightStateCode.DESCENT];

  const handleSelectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    if (val === 'AUTO') {
      onOverrideState(null);
    } else {
      onOverrideState(Number(val) as FlightStateCode);
    }
  };

  const allStates = [
    FlightStateCode.BOOT,
    FlightStateCode.TEST_MODE,
    FlightStateCode.LAUNCH_PAD,
    FlightStateCode.ASCENT,
    FlightStateCode.ROCKET_DEPLOY,
    FlightStateCode.DESCENT,
    FlightStateCode.AEROBREAK_RELEASE,
    FlightStateCode.IMPACT,
  ];

  return (
    <div className="telemetry-panel panel-amber-accent p-3 select-none flex-1 flex flex-col min-h-[200px]">
      {/* Header */}
      <div className="flex justify-between items-center mb-2">
        <span className="font-mono-data text-xs font-bold text-[#D7C4AC] uppercase tracking-wider flex items-center gap-1.5">
          <Layers className="w-3.5 h-3.5 text-[#FFD597]" />
          FLIGHT SOFTWARE STATE (FSW)
        </span>

        {/* State Selection Dropdown Override */}
        <div className="relative">
          <select
            value={currentStateCode}
            onChange={handleSelectChange}
            className="bg-[#1D2026] border border-[#524533] text-[#FFD597] font-mono-data text-[10px] px-2 py-0.5 outline-none rounded-none cursor-pointer uppercase appearance-none pr-5"
          >
            <option value="AUTO">AUTO (2026 PDR PHYSICS)</option>
            {Object.values(FLIGHT_STATES).map((st) => (
              <option key={st.code} value={st.code}>
                [{st.code}] {st.label}
              </option>
            ))}
          </select>
          <ChevronDown className="w-3 h-3 text-[#9F8E78] absolute right-1 top-1.5 pointer-events-none" />
        </div>
      </div>

      {/* Primary Display Banner with Dot Matrix Background */}
      <div
        className="flex-1 flex flex-col items-center justify-center border border-[#524533] bg-[#0B0E14] dot-matrix-bg relative overflow-hidden p-3 my-1"
        style={{
          boxShadow: `inset 0 0 24px ${stateInfo.bgGlow}`,
        }}
      >
        <div className="font-mono-data text-[10px] text-[#9F8E78] tracking-widest uppercase mb-1">
          STATE CODE [{stateInfo.code}]
        </div>

        <div
          className="font-mono-data text-xl sm:text-2xl lg:text-3xl font-extrabold tracking-widest z-10 text-center animate-pulse"
          style={{ color: stateInfo.color }}
        >
          {stateInfo.label}
        </div>

        <div className="font-mono-data text-[11px] text-[#D7C4AC] opacity-90 text-center mt-2 max-w-[340px] leading-relaxed">
          {stateInfo.description}
        </div>
      </div>

      {/* Mission Phase Timeline Bar (8 States) */}
      <div className="mt-2 flex gap-1">
        {allStates.map((code) => {
          const isCurrent = currentStateCode === code;
          const isPassed = currentStateCode > code;
          const st = FLIGHT_STATES[code];
          return (
            <div
              key={code}
              title={`${st.label}: ${st.description}`}
              className={`h-2.5 flex-1 transition-all rounded-none cursor-pointer ${
                isCurrent
                  ? 'bg-[#FFD597] shadow-[0_0_10px_#FFD597]'
                  : isPassed
                  ? 'bg-[#38FA87]/70'
                  : 'bg-[#272A31]'
              }`}
            />
          );
        })}
      </div>
    </div>
  );
};
