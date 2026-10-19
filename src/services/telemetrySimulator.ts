import { BASE_GPS, TEAM_INFO } from '../constants';
import { FlightStateCode, TelemetryPacket } from '../types';
import { convertGnssUtcToIst } from './telemetryParser';

export class TelemetryEngine {
  private packetCount: number = 1240;
  private missionTime: number = 35; // Default initial mission time (~450m drogue-descent phase)
  private isRunning: boolean = true;
  private stateOverride: FlightStateCode | null = null;
  private disturbanceFactor: number = 0;
  private listeners: ((packet: TelemetryPacket, rawSentence: string) => void)[] = [];
  private timer: number | null = null;
  private sampleRateHz: number = 10; // 10Hz updates
  private baseGps = { latitude: BASE_GPS.latitude, longitude: BASE_GPS.longitude, altitude: BASE_GPS.altitude };

  // Mission Physics Constants (2026 PDR Specification)
  private apogee: number = 1000.0;     // meters AGL
  private parafoilTransitionAlt: number = 600.0;  // meters AGL (approximate drogue -> main parafoil transition)
  private simulatedPressurePa: number | null = null;

  constructor() {
    this.start();
  }

  public setBaseGps(lat: number, lon: number, altitude: number = 55) {
    this.baseGps = { latitude: lat, longitude: lon, altitude };
    this.tick();
  }

  public getBaseGps() {
    return this.baseGps;
  }

  public subscribe(callback: (packet: TelemetryPacket, rawSentence: string) => void) {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== callback);
    };
  }

  public start() {
    if (this.timer) return;
    this.isRunning = true;
    this.timer = window.setInterval(() => this.tick(), 1000 / this.sampleRateHz);
  }

  public pause() {
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public togglePlay() {
    if (this.isRunning) {
      this.pause();
    } else {
      this.start();
    }
  }

  public resetMission() {
    this.missionTime = 0;
    this.packetCount = 0;
    this.stateOverride = null;
    this.disturbanceFactor = 0;
    this.simulatedPressurePa = null;
    this.tick();
  }

  public setStateOverride(state: FlightStateCode | null) {
    this.stateOverride = state;
  }

  public injectPressurePa(pressurePa: number) {
    this.simulatedPressurePa = pressurePa;
  }

  public injectDisturbance(intensity: number = 1.0) {
    this.disturbanceFactor = intensity;
    setTimeout(() => {
      this.disturbanceFactor = 0;
    }, 3000);
  }

  public getIsRunning() {
    return this.isRunning;
  }

  public getCurrentMissionTime() {
    return this.missionTime;
  }

  private tick() {
    if (!this.isRunning) return;

    this.packetCount++;
    const dt = 1 / this.sampleRateHz;
    this.missionTime += dt;

    const packet = this.generateCurrentPacket();
    const rawSentence = this.formatPdrTelemetrySentence(packet);

    this.listeners.forEach((listener) => listener(packet, rawSentence));
  }

  public generateCurrentPacket(): TelemetryPacket {
    const t = this.missionTime;
    let state = FlightStateCode.DESCENT;

    // Timeline-based FSW state transition logic (0 -> 1000m -> 600m -> 0m)
    if (this.stateOverride !== null) {
      state = this.stateOverride;
    } else if (t < 5) {
      state = FlightStateCode.LAUNCH_PAD;
    } else if (t < 25) {
      state = FlightStateCode.ASCENT; // 20s rocket ascent to 1000m
    } else if (t < 28) {
      state = FlightStateCode.ROCKET_DEPLOY; // Ejection at 1000m apogee
    } else {
      // During descent: calculate current altitude first to switch drogue -> parafoil phase at ~600m
      const descentTime = t - 28;
      let estimatedAlt = Math.max(0, 1000.0 - descentTime * 17.0);

      // Check simulated barometric pressure altitude conversion if injected
      if (this.simulatedPressurePa !== null) {
        // Baro pressure formula: alt = 44330 * (1 - (p / 1013.25)^0.1903)
        const pressHpa = this.simulatedPressurePa / 100.0;
        estimatedAlt = 44330 * (1 - Math.pow(pressHpa / 1013.25, 0.1903));
      }

      if (estimatedAlt > this.parafoilTransitionAlt) {
        state = FlightStateCode.DESCENT; // Stage 1 Drogue descent (1000m -> ~600m @ 17m/s)
      } else if (estimatedAlt > 1.0) {
        state = FlightStateCode.AEROBREAK_RELEASE; // Stage 2 Main parafoil phase (~600m -> 0m @ 1-3m/s)
      } else {
        state = FlightStateCode.IMPACT; // Touchdown
      }
    }

    // Physics calculations per FSW State
    let altitude = 0;
    let velocity = 0;
    let accelX = 0;
    let accelY = 0;
    let accelZ = 1.0; // 1G static
    let wheelRpm = 0;
    let spinRate = 0.2;
    let roll = 0;
    let pitch = 0;
    let yaw = 0;
    let currentDraw = 0.12; // Amps

    const noise = () => (Math.random() - 0.5) * 0.3 * (1 + this.disturbanceFactor * 4);

    switch (state) {
      case FlightStateCode.BOOT:
      case FlightStateCode.TEST_MODE:
      case FlightStateCode.LAUNCH_PAD:
        altitude = 0 + noise() * 0.1;
        velocity = 0 + noise() * 0.05;
        accelX = noise() * 0.05;
        accelY = noise() * 0.05;
        accelZ = 1.0 + noise() * 0.05;
        wheelRpm = 0;
        spinRate = 0.2 + noise() * 0.1;
        roll = noise() * 0.5;
        pitch = noise() * 0.5;
        yaw = 0;
        currentDraw = 0.12;
        break;

      case FlightStateCode.ASCENT: {
        // Rocket launch 0m -> 1000m AGL over 20s
        const progress = Math.min((t - 5) / 20, 1.0);
        altitude = Math.max(0, this.apogee * Math.pow(progress, 1.4) + noise() * 1.5);
        velocity = 50.0 * Math.pow(progress, 0.4) + noise() * 0.5;

        // Acceleration spike during boost (up to 15 Gs launch requirement)
        accelZ = 1.0 + 14.0 * Math.sin(progress * Math.PI) + noise() * 0.5;
        accelX = noise() * 0.5;
        accelY = noise() * 0.5;

        wheelRpm = 0;
        spinRate = 4.2 + noise() * 0.3;
        roll = 12.0 + Math.sin(t * 0.3) * 3 + noise();
        pitch = -4.0 + Math.cos(t * 0.4) * 2 + noise();
        yaw = ((t * 12) % 360) - 180;
        currentDraw = 0.35;
        break;
      }

      case FlightStateCode.ROCKET_DEPLOY: {
        // 1000m Apogee ejection shock (30G requirement)
        altitude = 1000.0 + noise() * 0.5;
        velocity = 1.5 + noise() * 0.5;

        // Shock force spike
        accelZ = 28.5 + noise() * 2.0;
        accelX = noise() * 4.0;
        accelY = noise() * 4.0;

        // Soft-start momentum wheel spin-up 0 -> 12,000 RPM
        wheelRpm = 6000.0 + noise() * 200;
        spinRate = 2.5 + noise() * 0.5;
        roll = 8.0 + noise() * 3.0;
        pitch = -5.0 + noise() * 2.0;
        yaw = (t * 20) % 360 - 180;
        currentDraw = 3.2; // BLDC inrush current
        break;
      }

      case FlightStateCode.DESCENT: {
        // Stage 1 Drogue parachute: 1000m -> ~600m @ 17m/s (± 2 m/s)
        const stage1Time = t - 28;
        altitude = Math.max(this.parafoilTransitionAlt, 1000.0 - stage1Time * 17.0 + noise() * 1.2);
        velocity = 17.0 + Math.sin(stage1Time * 0.2) * 1.2 + noise() * 0.5;

        accelZ = 1.0 + noise() * 0.15;
        accelX = noise() * 0.15;
        accelY = noise() * 0.15;

        // Z-Axis Momentum Wheel at constant 12,000 RPM cruising speed
        wheelRpm = 12000.0 + noise() * 50.0;
        // Gyroscopic stiffness dampens pitch/roll into controlled yaw precession ~3.18 deg/s
        spinRate = 3.18 + noise() * 0.15;
        roll = 3.5 + Math.sin(stage1Time * 0.3) * 1.5 + noise();
        pitch = -2.2 + Math.cos(stage1Time * 0.3) * 1.2 + noise();
        yaw = ((stage1Time * 3.18) % 360) - 180;
        currentDraw = 2.45; // MT2204 motor cruising
        break;
      }

      case FlightStateCode.AEROBREAK_RELEASE: {
        // Stage 2 Main parafoil phase from ~600m AGL: 600m -> 0m @ 1 - 3 m/s (nominal 2.2 m/s)
        const stage2Time = Math.max(0, t - 51.5);
        altitude = Math.max(0, 600.0 - stage2Time * 2.2 + noise() * 0.8);
        velocity = 2.2 + Math.sin(stage2Time * 0.1) * 0.3 + noise() * 0.2;

        accelZ = 1.0 + noise() * 0.08;
        accelX = noise() * 0.08;
        accelY = noise() * 0.08;

        wheelRpm = 12000.0 + noise() * 30.0;
        spinRate = 2.8 + noise() * 0.1;
        roll = 2.0 + Math.sin(stage2Time * 0.2) * 1.0 + noise();
        pitch = -1.5 + Math.cos(stage2Time * 0.2) * 0.8 + noise();
        yaw = ((stage2Time * 2.8) % 360) - 180;
        currentDraw = 2.40;
        break;
      }

      case FlightStateCode.IMPACT:
        altitude = 0.0;
        velocity = 0.0;
        accelX = 0;
        accelY = 0;
        accelZ = 1.0;
        wheelRpm = Math.max(0, 12000.0 - (t - 320) * 1000);
        spinRate = 0.0;
        roll = 2.1;
        pitch = 6.4;
        yaw = 48.0;
        currentDraw = 0.18; // Audio beacon 92dB + GSM active
        break;
    }

    const totalAccelG = Math.sqrt(accelX * accelX + accelY * accelY + accelZ * accelZ);

    // MS5611 Barometric pressure calculation (hPa)
    const pressureHpa = 1013.25 * Math.pow(1 - 2.25577e-5 * altitude, 5.25588) + noise() * 0.2;
    const temperatureC = 28.5 - (altitude / 1000.0) * 6.5 + noise() * 0.1;
    const humidityPercent = Math.max(10.0, Math.min(95.0, 58.0 + (altitude / 200.0) + noise() * 0.5));

    // Environmental Bonus Sensors (SCD40 CO2, SPS30 PM2.5, LTR390 UV)
    const co2Ppm = 412.0 + noise() * 3.0;
    const pm2_5 = Math.max(1.0, 11.5 - altitude / 300.0 + noise() * 0.4);
    const uvIndex = Math.max(0, 4.2 + altitude / 250.0 + noise() * 0.2);

    // 2S Molicel INR-18650-P30B battery pack (3000mAh, 6.4V to 8.4V)
    const dt = 1 / this.sampleRateHz;
    const consumedMah = (currentDraw * (dt / 3600.0)) * 1000.0;
    const batterySoc = Math.max(10.0, 98.5 - (this.packetCount / 3500) * 100.0);
    const batteryVoltage = Math.max(6.4, 6.4 + (batterySoc / 100.0) * 2.0 + noise() * 0.01);
    const powerW = batteryVoltage * currentDraw;

    // NEO-M9N GNSS trajectory drift around Manipal Base
    const driftOffset = (t / 100) * 0.0001;
    const latitude = this.baseGps.latitude + driftOffset * 0.8 + Math.sin(t * 0.05) * 0.0001;
    const longitude = this.baseGps.longitude + driftOffset * 1.1 + Math.cos(t * 0.05) * 0.0001;

    const now = new Date();
    const utcTimeStr = now.toISOString().split('T')[1].slice(0, 8);

    return {
      source: 'SIMULATION',
      receivedAtMs: now.getTime(),
      receivedAtTimeStr: utcTimeStr,
      teamId: TEAM_INFO.id,
      packetNumber: this.packetCount,
      missionTimeSeconds: Math.floor(t * 10) / 10,
      timestampUtc: utcTimeStr,
      gnssTimeIst: convertGnssUtcToIst(utcTimeStr),
      altitude: Math.round(altitude * 10) / 10,
      velocity: Math.round(velocity * 10) / 10,
      acceleration: Math.round(totalAccelG * 100) / 100,
      accelX: Math.round(accelX * 100) / 100,
      accelY: Math.round(accelY * 100) / 100,
      accelZ: Math.round(accelZ * 100) / 100,
      wheelRpm: Math.round(wheelRpm),
      spinRate: Math.round(spinRate * 100) / 100,
      roll: Math.round(roll * 10) / 10,
      pitch: Math.round(pitch * 10) / 10,
      yaw: Math.round(yaw * 10) / 10,
      latitude,
      longitude,
      gpsAltitude: Math.round(altitude + this.baseGps.altitude),
      gpsSats: 12,
      gpsFixType: '3D',
      gpsValid: true,
      rawLatitude: latitude,
      rawLongitude: longitude,
      rawGpsAltitude: Math.round(altitude + this.baseGps.altitude),
      co2: Math.round(co2Ppm * 10) / 10,
      pm2_5: Math.round(pm2_5 * 10) / 10,
      uv: Math.round(uvIndex * 10) / 10,
      humidity: Math.round(humidityPercent * 10) / 10,
      temperature: Math.round(temperatureC * 10) / 10,
      pressure: Math.round(pressureHpa * 10) / 10,
      rawPressurePa: Math.round(pressureHpa * 100),
      batteryVoltage: Math.round(batteryVoltage * 100) / 100,
      currentDraw: Math.round(currentDraw * 100) / 100,
      power: Math.round(powerW * 100) / 100,
      batterySoc: Math.round(batterySoc * 10) / 10,
      rssi: Math.round(-68 + noise() * 3),
      stateCode: state,
      fswStateName: FlightStateCode[state],
      l1Connected: true,
      l2Connected: false,
      deployed: state === FlightStateCode.AEROBREAK_RELEASE || state === FlightStateCode.IMPACT,
      audioBeaconActive: state === FlightStateCode.IMPACT,
      gsmModuleActive: state === FlightStateCode.IMPACT,
    };
  }

  // Exact 2026 PDR Telemetry string format
  private formatPdrTelemetrySentence(p: TelemetryPacket): string {
    const accelStr = `${p.accelX ?? 0}:${p.accelY ?? 0}:${p.accelZ ?? 0}`;
    const optionalStr = `CO2=${p.co2 ?? 0};PM=${p.pm2_5 ?? 0};UV=${p.uv ?? 0};RH=${p.humidity ?? 0};RPM=${p.wheelRpm ?? 0};I=${p.currentDraw ?? 0}A`;

    return `${p.teamId},${p.missionTimeSeconds.toFixed(1)},${p.packetNumber},${(p.altitude ?? 0).toFixed(2)},${(p.pressure ?? 0).toFixed(2)},${(p.temperature ?? 0).toFixed(2)},${(p.batteryVoltage ?? 0).toFixed(2)},${p.timestampUtc},${(p.latitude ?? 0).toFixed(6)},${(p.longitude ?? 0).toFixed(6)},${(p.gpsAltitude ?? 0).toFixed(2)},${p.gpsSats ?? 0},${accelStr},${(p.spinRate ?? 0).toFixed(2)},${p.stateCode ?? 0},${optionalStr}`;
  }
}

// Global Singleton Instance
export const globalTelemetryEngine = new TelemetryEngine();
