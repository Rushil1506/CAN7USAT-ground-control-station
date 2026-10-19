/**
 * Team 017 radio assignment — informational reference data.
 *
 * Source of truth: "CAN7USAT Team_Frequency_Assignments_19_10.pdf" (IN-SPACe CAN-7USAT /
 * Model Rocketry India Student Competition 2026), page 2, Team Number 017 row:
 *   868 Main 865.50 MHz | 868 Backup 867.25 MHz | SF7 | Sync 0x91 |
 *   XBee Main Ch 17 (2435 MHz) | XBee Backup Ch 21 (2455 MHz) | PAN ID 0x1011
 *
 * These are COMPETITION ASSIGNMENTS. The browser GCS is receive-only and cannot read or
 * configure radio hardware, so nothing here is "hardware-verified" or "currently configured".
 */

export const RADIO_ASSIGNMENT_SOURCE =
  'CAN7USAT Team_Frequency_Assignments_19_10.pdf (page 2, Team 017 row)';

export const RADIO_TEAM_NUMBER = 17; // Team 017

export interface LoRaAssignment {
  modulation: 'LoRa';
  bandLabel: string;
  mainMHz: number;
  backupMHz: number;
  spreadingFactor: number;
  bandwidthKHz: number;
  codingRate: string;
  syncWord: number; // 0x80 + team number
  txPowerPadDbm: number;
  txPowerFlightDbm: number;
}

export interface XBeeAssignment {
  variant: string;
  mode: string;
  mainChannel: number;
  mainMHz: number;
  backupChannel: number;
  backupMHz: number;
  panId: number; // 0x1000 + team number
}

export interface RadioAssignment {
  lora: LoRaAssignment;
  xbee: XBeeAssignment;
  autoShutdownMinutesAfterLaunchDetect: number;
}

export const TEAM_017_RADIO_ASSIGNMENT: RadioAssignment = {
  lora: {
    modulation: 'LoRa',
    bandLabel: '865 - 868 MHz (India licence-free)',
    mainMHz: 865.5,
    backupMHz: 867.25,
    spreadingFactor: 7,
    bandwidthKHz: 125,
    codingRate: '4/5',
    syncWord: 0x91,
    txPowerPadDbm: 10,
    txPowerFlightDbm: 14,
  },
  xbee: {
    variant: '2.4 GHz XBee',
    mode: '802.15.4 (not XBee 900)',
    mainChannel: 17,
    mainMHz: 2435,
    backupChannel: 21,
    backupMHz: 2455,
    panId: 0x1011,
  },
  autoShutdownMinutesAfterLaunchDetect: 90,
};

export function formatHex(value: number, minDigits = 2): string {
  return `0x${value.toString(16).toUpperCase().padStart(minDigits, '0')}`;
}

/** Competition rule: sync word = 0x80 + team number; PAN ID = 0x1000 + team number. */
export function deriveSyncWord(teamNumber: number): number {
  return 0x80 + teamNumber;
}

export function derivePanId(teamNumber: number): number {
  return 0x1000 + teamNumber;
}

export const RADIO_OPERATING_CONSTRAINTS: string[] = [
  'Use the MAIN channel by default; switch to BACKUP only when Net Control instructs.',
  'Never transmit on a frequency or channel that is not assigned to Team 017.',
  'Competition rule: every CanSat must automatically stop transmitting 90 minutes after launch detection (an onboard requirement; not implemented or verified by this GCS).',
  'Competition rule: each link (LoRa and XBee) must be switchable ON/OFF by telecommand (an onboard requirement; this GCS is receive-only and sends no telecommands).',
];
