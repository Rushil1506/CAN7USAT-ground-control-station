import { TelemetryPacket, TelemetrySource } from '../types';

/**
 * Escapes a cell value for standard CSV format.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export const TELEMETRY_CSV_COLUMNS = [
  'TelemetrySource',
  'TeamID',
  'MissionTimeSec',
  'PacketNumber',
  'Altitude_m',
  'Pressure_Pa',
  'Pressure_hPa',
  'Temp_C',
  'Batt_V',
  'GnssTime_UTC',
  'GnssTime_IST',
  'ComputerRxTime_UTC',
  'Latitude',
  'Longitude',
  'GpsAltitude_m',
  'GpsSats',
  'GpsFixType',
  'AccelX',
  'AccelY',
  'AccelZ',
  'Roll_deg',
  'Pitch_deg',
  'SpinRate_degs',
  'FswStateName',
  'MappedStateCode',
  'Velocity_ms',
  'Yaw_deg',
  'WheelRpm',
  'CO2_ppm',
  'PM2_5_ugm3',
  'UV_Index',
  'Humidity_RH',
  'Current_A',
  'Power_W',
] as const;

/**
 * Builds the canonical 34-column CSV string from history packets and triggers a browser download.
 * Returns the generated filename.
 */
export function exportTelemetryPacketsToCsv(
  historyPackets: TelemetryPacket[],
  telemetrySource: TelemetrySource
): string {
  const isSim = telemetrySource === 'SIMULATION';
  const headers = TELEMETRY_CSV_COLUMNS.join(',');

  const rows = historyPackets.map((p) =>
    [
      csvCell(p.source ?? telemetrySource),
      csvCell(p.teamId),
      csvCell(p.missionTimeSeconds),
      csvCell(p.packetNumber),
      csvCell(p.altitude),
      csvCell(p.rawPressurePa),
      csvCell(p.pressure),
      csvCell(p.temperature),
      csvCell(p.batteryVoltage),
      csvCell(p.timestampUtc),
      csvCell(p.gnssTimeIst),
      csvCell(p.receivedAtTimeStr),
      csvCell(p.latitude),
      csvCell(p.longitude),
      csvCell(p.gpsAltitude),
      csvCell(p.gpsSats),
      csvCell(p.gpsFixType),
      csvCell(p.accelX),
      csvCell(p.accelY),
      csvCell(p.accelZ),
      csvCell(p.roll),
      csvCell(p.pitch),
      csvCell(p.spinRate),
      csvCell(p.fswStateName),
      csvCell(p.stateCode),
      csvCell(p.velocity),
      csvCell(p.yaw),
      csvCell(p.wheelRpm),
      csvCell(p.co2),
      csvCell(p.pm2_5),
      csvCell(p.uv),
      csvCell(p.humidity),
      csvCell(p.currentDraw),
      csvCell(p.power),
    ].join(',')
  );

  const csvContent = 'data:text/csv;charset=utf-8,' + [headers, ...rows].join('\n');
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);

  const prefix = isSim ? 'CANSAT_SIM_TELEMETRY_LOG' : 'CANSAT_LIVE_SERIAL_LOG';
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `${prefix}_${timestamp}.csv`;

  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  return filename;
}
