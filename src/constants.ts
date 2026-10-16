import { FlightStateCode, FlightStateInfo } from './types';

export const TEAM_INFO = {
  id: '2026-INSPACe-CAN-7USAT-332',
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
    color: '#9F8E78',
    bgGlow: 'rgba(159, 142, 120, 0.2)',
  },
  [FlightStateCode.TEST_MODE]: {
    code: FlightStateCode.TEST_MODE,
    label: '1: TEST_MODE',
    description: 'Bench testing & pre-flight verification',
    color: '#98CBFF',
    bgGlow: 'rgba(152, 203, 255, 0.2)',
  },
  [FlightStateCode.LAUNCH_PAD]: {
    code: FlightStateCode.LAUNCH_PAD,
    label: '2: LAUNCH_PAD',
    description: 'Awaiting launch command on launch pad',
    color: '#00A2FD',
    bgGlow: 'rgba(0, 162, 253, 0.25)',
  },
  [FlightStateCode.ASCENT]: {
    code: FlightStateCode.ASCENT,
    label: '3: ASCENT',
    description: 'Rocket boost ascent (0 - 1000m AGL, 15G acceleration)',
    color: '#38FA87',
    bgGlow: 'rgba(56, 250, 135, 0.3)',
  },
  [FlightStateCode.ROCKET_DEPLOY]: {
    code: FlightStateCode.ROCKET_DEPLOY,
    label: '4: ROCKET_DEPLOY',
    description: '1000m Apogee rocket ejection & 30G shock',
    color: '#FFD597',
    bgGlow: 'rgba(255, 213, 151, 0.35)',
  },
  [FlightStateCode.DESCENT]: {
    code: FlightStateCode.DESCENT,
    label: '5: DESCENT (REEFED)',
    description: 'Stage 1 Reefed Parachute (1000m -> 600m @ 17m/s, 12,000 RPM wheel)',
    color: '#FFB000',
    bgGlow: 'rgba(255, 176, 0, 0.35)',
  },
  [FlightStateCode.AEROBREAK_RELEASE]: {
    code: FlightStateCode.AEROBREAK_RELEASE,
    label: '6: AEROBREAK (600m DISREEFED)',
    description: 'Stage 2 Disreefed Parachute (600m -> 0m @ 1-3m/s, burnwire active)',
    color: '#FF5252',
    bgGlow: 'rgba(255, 82, 82, 0.4)',
  },
  [FlightStateCode.IMPACT]: {
    code: FlightStateCode.IMPACT,
    label: '7: TOUCHDOWN / RECOVERY',
    description: 'Landing completed! Audio beacon (92dB) & GSM SMS active',
    color: '#B388FF',
    bgGlow: 'rgba(179, 136, 255, 0.35)',
  },
};

export const AVAILABLE_PORTS = [
  'COM10 (Zeminet LoRa-Mod865 865MHz)',
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
