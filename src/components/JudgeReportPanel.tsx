import React from 'react';
import { Award, Download, FileText } from 'lucide-react';
import { TelemetryPacket, TelemetrySource } from '../types';
import { TEAM_INFO } from '../constants';

interface JudgeReportPanelProps {
  historyPackets: TelemetryPacket[];
  latestPacket: TelemetryPacket | null;
  telemetrySource?: TelemetrySource;
}

const isValidNum = (val: unknown): val is number =>
  typeof val === 'number' && Number.isFinite(val);

export const JudgeReportPanel: React.FC<JudgeReportPanelProps> = ({
  historyPackets,
  latestPacket,
  telemetrySource = 'SIMULATION',
}) => {
  const isSim = telemetrySource === 'SIMULATION';
  const totalFrames = historyPackets.length;

  const altitudes = historyPackets.map((p) => p.altitude).filter(isValidNum);
  const apogee =
    altitudes.length > 0
      ? Math.max(...altitudes)
      : isValidNum(latestPacket?.altitude)
      ? latestPacket.altitude
      : null;

  const velocities = historyPackets.map((p) => p.velocity).filter(isValidNum);
  const maxVel =
    velocities.length > 0
      ? Math.max(...velocities)
      : isValidNum(latestPacket?.velocity)
      ? latestPacket.velocity
      : null;

  const accels = historyPackets.map((p) => p.acceleration).filter(isValidNum);
  const maxAccel =
    accels.length > 0
      ? Math.max(...accels)
      : isValidNum(latestPacket?.acceleration)
      ? latestPacket.acceleration
      : null;

  const rpms = historyPackets.map((p) => p.wheelRpm).filter(isValidNum);
  const maxRpm =
    rpms.length > 0
      ? Math.max(...rpms)
      : isValidNum(latestPacket?.wheelRpm)
      ? latestPacket.wheelRpm
      : null;

  const volts = historyPackets
    .map((p) => p.batteryVoltage)
    .filter(isValidNum);
  const minVolt =
    volts.length > 0
      ? Math.min(...volts)
      : isValidNum(latestPacket?.batteryVoltage)
      ? latestPacket.batteryVoltage
      : null;
  const maxVolt =
    volts.length > 0
      ? Math.max(...volts)
      : isValidNum(latestPacket?.batteryVoltage)
      ? latestPacket.batteryVoltage
      : null;

  const stage1Velocities = historyPackets
    .filter((p) => p.stateCode === 5)
    .map((p) => p.velocity)
    .filter(isValidNum);
  const stage2Velocities = historyPackets
    .filter((p) => p.stateCode === 6)
    .map((p) => p.velocity)
    .filter(isValidNum);

  const stage1DescentRate =
    stage1Velocities.length > 0
      ? `${(
          stage1Velocities.reduce((acc, curr) => acc + curr, 0) /
          stage1Velocities.length
        ).toFixed(1)} m/s`
      : 'UNAVAILABLE';

  const stage2DescentRate =
    stage2Velocities.length > 0
      ? `${(
          stage2Velocities.reduce((acc, curr) => acc + curr, 0) /
          stage2Velocities.length
        ).toFixed(1)} m/s`
      : 'UNAVAILABLE';

  const apogeeStr = apogee !== null ? `${apogee.toFixed(1)} m` : 'UNAVAILABLE';
  const maxVelStr =
    maxVel !== null ? `${maxVel.toFixed(1)} m/s` : 'UNAVAILABLE';
  const maxAccelStr =
    maxAccel !== null ? `${maxAccel.toFixed(2)} Gs` : 'UNAVAILABLE';
  const maxRpmStr =
    maxRpm !== null ? `${Math.round(maxRpm).toLocaleString()} RPM` : 'UNAVAILABLE';
  const voltRangeStr =
    minVolt !== null && maxVolt !== null
      ? `${minVolt.toFixed(2)}V - ${maxVolt.toFixed(2)}V`
      : 'UNAVAILABLE';

  const generateReportText = () => {
    return `================================================================================
           IN-SPACe CAN-7USAT INDIA STUDENT COMPETITION 2026-27
                     OFFICIAL POST-FLIGHT MISSION REPORT
================================================================================
Telemetry Source:   ${isSim ? 'SIMULATION ENGINE' : 'LIVE USB-SERIAL RECEIVER'}
Team Name:          ${TEAM_INFO.name}
Team Identifier:    ${latestPacket?.teamId ?? TEAM_INFO.id} (PDR Ref: ${TEAM_INFO.pdrId})
Institution:        ${TEAM_INFO.institution}
Faculty Advisor:    ${TEAM_INFO.facultyAdvisor}
Team Leader:        ${TEAM_INFO.teamLeader}
Generated Date:     ${new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC
================================================================================

1. MISSION EXECUTED PERFORMANCE METRICS:
--------------------------------------------------------------------------------
- Maximum Altitude (Apogee):           ${apogeeStr}
- Total Telemetry Records Logged:      ${totalFrames} frames
- Maximum Ascent / Descent Speed:      ${maxVelStr}
- Peak Acceleration Load:              ${maxAccelStr}

2. DESCENT CONTROL SUBSYSTEM (DCS) PERFORMANCE:
--------------------------------------------------------------------------------
- Stage 1 (Reefed Parachute) Speed:     ${stage1DescentRate} (Target: 17 ± 2 m/s)
- Disreefing Trigger Altitude:          600.0 m (Configurable Assumption)
- Stage 2 (Disreefed Parachute) Speed:  ${stage2DescentRate} (Target: 1 - 3 m/s)
- Z-Axis Momentum Wheel Speed:          ${maxRpmStr} (Target: 12,000 RPM)
- Latest Flight Software State:         ${latestPacket?.fswStateName ?? 'UNAVAILABLE'}

3. ELECTRICAL POWER & TELEMETRY QUALITY:
--------------------------------------------------------------------------------
- 2S Molicel INR-18650-P30B Voltage:    ${voltRangeStr}
- Telemetry RF Frequency:               865 MHz LoRa
================================================================================`;
  };

  const downloadReport = () => {
    const reportStr = generateReportText();
    const blob = new Blob([reportStr], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Judge_Mission_Report_CAN7USAT_${
      isSim ? 'SIM' : 'LIVE'
    }_${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="ops-card p-4 flex flex-col gap-3 h-full select-none">
      {/* Header Bar */}
      <div className="flex justify-between items-center flex-wrap gap-2 border-b border-[var(--border-subtle)] pb-2.5">
        <div className="flex items-center gap-2">
          <Award className="w-4 h-4 text-[var(--accent-cobalt)]" />
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-primary)]">
              Post-Flight Mission Summary &amp; Judge Report (
              {isSim ? 'SIMULATION' : 'LIVE SERIAL'})
            </h3>
            <p className="text-[11px] text-[var(--text-secondary)]">
              {TEAM_INFO.competition}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={downloadReport}
          className="bg-[var(--accent-cobalt)] hover:bg-[var(--accent-cobalt-hover)] text-white font-semibold px-3 py-1.5 rounded-[var(--radius-sm)] cursor-pointer flex items-center gap-1.5 text-xs transition-colors"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Export Report (.TXT)</span>
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <div className="bg-[var(--bg-surface-2)] border border-[var(--border-subtle)] rounded-[var(--radius-sm)] p-2.5 flex flex-col gap-0.5">
          <span className="text-[var(--text-tertiary)] text-[10px] font-semibold uppercase">
            Peak Altitude (Apogee)
          </span>
          <span className="font-mono-data text-[var(--accent-cobalt)] font-bold text-base">
            {apogeeStr}
          </span>
          <span className="text-[var(--text-secondary)] text-[10px] font-mono-data">
            {isSim ? 'SIMULATION METRIC' : 'LIVE SERIAL METRIC'}
          </span>
        </div>

        <div className="bg-[var(--bg-surface-2)] border border-[var(--border-subtle)] rounded-[var(--radius-sm)] p-2.5 flex flex-col gap-0.5">
          <span className="text-[var(--text-tertiary)] text-[10px] font-semibold uppercase">
            Stage 1 Reefed Rate
          </span>
          <span className="font-mono-data text-[var(--text-primary)] font-bold text-base">
            {stage1DescentRate}
          </span>
          <span className="text-[var(--text-secondary)] text-[10px] font-mono-data">
            Ref Target: 17 ± 2 m/s
          </span>
        </div>

        <div className="bg-[var(--bg-surface-2)] border border-[var(--border-subtle)] rounded-[var(--radius-sm)] p-2.5 flex flex-col gap-0.5">
          <span className="text-[var(--text-tertiary)] text-[10px] font-semibold uppercase">
            Stage 2 Disreefed Rate
          </span>
          <span className="font-mono-data text-[var(--accent-teal)] font-bold text-base">
            {stage2DescentRate}
          </span>
          <span className="text-[var(--text-secondary)] text-[10px] font-mono-data">
            Ref Target: 1 - 3 m/s
          </span>
        </div>

        <div className="bg-[var(--bg-surface-2)] border border-[var(--border-subtle)] rounded-[var(--radius-sm)] p-2.5 flex flex-col gap-0.5">
          <span className="text-[var(--text-tertiary)] text-[10px] font-semibold uppercase">
            Momentum Wheel Peak
          </span>
          <span className="font-mono-data text-[var(--text-primary)] font-bold text-base">
            {maxRpmStr}
          </span>
          <span className="text-[var(--text-secondary)] text-[10px] font-mono-data">
            {maxRpm !== null ? 'TELEMETRY RECORDED' : 'NOT TRANSMITTED'}
          </span>
        </div>
      </div>

      {/* Main Formatted Report Window */}
      <div className="flex-1 bg-[var(--bg-surface-2)] border border-[var(--border-subtle)] rounded-[var(--radius-sm)] p-3 flex flex-col min-h-[240px]">
        <div className="flex justify-between items-center border-b border-[var(--border-subtle)] pb-2 mb-2">
          <span className="text-[var(--text-secondary)] text-[11px] uppercase font-bold flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5 text-[var(--accent-cobalt)]" />
            Generated Mission Verification Document
          </span>
          <span
            className={`font-mono-data text-[10px] px-2 py-0.5 border rounded-[var(--radius-xs)] font-semibold ${
              isSim
                ? 'bg-[var(--status-info-bg)] text-[var(--accent-cobalt)] border-[var(--accent-cobalt)]/25'
                : 'bg-[var(--accent-teal-soft)] text-[var(--accent-teal)] border-[var(--accent-teal)]/30'
            }`}
          >
            {isSim ? 'SIMULATION DATA' : 'LIVE SERIAL DATA'}
          </span>
        </div>

        <textarea
          readOnly
          value={generateReportText()}
          className="w-full flex-1 bg-transparent text-[var(--text-primary)] font-mono-data text-xs outline-none resize-none leading-relaxed select-text"
        />
      </div>
    </div>
  );
};
