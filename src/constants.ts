import { FlightStateCode, FlightStateInfo } from './types';

export const TEAM_INFO = {
  id: '2026-IN-SPACe-CAN-7USAT-017',
  number: '017',
  displayLabel: 'CAN-7USAT | TEAM 017',
  pdrId: 'RITM0021257',
  name: 'Team Parikshit',
  competition: 'IN-SPACe CAN-7USAT India Student Competition 2026-27 (3rd Edition)',
  institution: 'Manipal Institute of Technology, MAHE, Manipal',
  facultyAdvisor: 'Dr. Balbir',
  teamLeader: 'Om Kale',
  members: [
    'Om Kale (Team Leader)',
    'Saloni Bagra',
    'Nischal Nori',
    'Ardra Sajeev',
    'Dev Tandon',
    'Rushil Jindal',
    'Ravi Sai Vamsi',
    'Vatsal Agarwal',
  ],
};

export const FLIGHT_STATES: Record<FlightStateCode, FlightStateInfo> = {
  [FlightStateCode.BOOT]: {
    code: FlightStateCode.BOOT,
    label: '0: BOOT',
    description: 'Power-on reset & sensor self-calibration',
    color: '#475569',
    bgGlow: 'rgba(71, 85, 105, 0.12)',
  },
  [FlightStateCode.TEST_MODE]: {
    code: FlightStateCode.TEST_MODE,
    label: '1: TEST_MODE',
    description: 'Bench testing & pre-flight verification',
    color: '#0284c7',
    bgGlow: 'rgba(2, 132, 199, 0.12)',
  },
  [FlightStateCode.LAUNCH_PAD]: {
    code: FlightStateCode.LAUNCH_PAD,
    label: '2: LAUNCH_PAD',
    description: 'Awaiting launch command on launch pad',
    color: '#1d4ed8',
    bgGlow: 'rgba(29, 78, 216, 0.14)',
  },
  [FlightStateCode.ASCENT]: {
    code: FlightStateCode.ASCENT,
    label: '3: ASCENT',
    description: 'Rocket boost ascent (0 - 1000m AGL, 15G acceleration)',
    color: '#15803d',
    bgGlow: 'rgba(21, 128, 61, 0.14)',
  },
  [FlightStateCode.ROCKET_DEPLOY]: {
    code: FlightStateCode.ROCKET_DEPLOY,
    label: '4: ROCKET_DEPLOY',
    description: '1000m Apogee rocket ejection & 30G shock',
    color: '#b45309',
    bgGlow: 'rgba(180, 83, 9, 0.14)',
  },
  [FlightStateCode.DESCENT]: {
    code: FlightStateCode.DESCENT,
    label: '5: DESCENT (DROGUE)',
    description: 'Stage 1 drogue parachute descent (1000m -> ~600m @ 17m/s)',
    color: '#0f766e',
    bgGlow: 'rgba(15, 118, 110, 0.14)',
  },
  [FlightStateCode.AEROBREAK_RELEASE]: {
    code: FlightStateCode.AEROBREAK_RELEASE,
    label: '6: PARAFOIL (~600m)',
    description: 'Stage 2 main parafoil phase (~600m -> 0m @ 1-3m/s, two-servo steering)',
    color: '#b91c1c',
    bgGlow: 'rgba(185, 28, 28, 0.14)',
  },
  [FlightStateCode.IMPACT]: {
    code: FlightStateCode.IMPACT,
    label: '7: TOUCHDOWN / RECOVERY',
    description: 'Landing completed! Audio beacon (92dB) & GSM SMS active',
    color: '#4338ca',
    bgGlow: 'rgba(67, 56, 202, 0.14)',
  },
};

export const AVAILABLE_PORTS = [
  'COM10 (Zeminet LoRa 865.50MHz)',
  'COM4 (Digi XBee-PRO S2C 2.4GHz)',
  'ttyUSB0 (Teensy 4.1 USB Serial)',
  'SIMULATOR (Flight Engine Loopback)',
];

export const BAUD_RATES = [9600, 19200, 38400, 57600, 115200];

export const COLOR_TOKENS = {
  bgLowest: '#090D12',
  bgSurface: '#0E141B',
  surfaceContainer: '#161E28',
  surfaceHigh: '#1D2633',
  amberPrimary: '#E5A93C',
  amberGo: '#E5A93C',
  blueSecondary: '#388BFD',
  greenNominal: '#28C76F',
  redAlert: '#EA5455',
  outline: '#324254',
  outlineVariant: '#222C38',
  textOnSurface: '#F0F4F8',
  textVariant: '#8A99AD',
};

// Manipal Institute of Technology, MAHE, Manipal, Karnataka, India
export const BASE_GPS = {
  latitude: 13.3525,
  longitude: 74.7928,
  altitude: 55, // Ground elevation AMSL
};
