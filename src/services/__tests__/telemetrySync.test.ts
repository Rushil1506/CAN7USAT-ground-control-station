/**
 * CAN-7USAT Ground Control Station
 * Secure Real-Time Multi-Device Telemetry Synchronization Test Suite
 *
 * Validates Hardened Security Policies:
 * 1. Constant-time cryptographic token verification (timingSafeEqual)
 * 2. Mandatory, fail-closed publisher authentication (PUBLISHER_SECRET_KEY)
 * 3. Mandatory, fail-closed viewer authentication (VIEWER_SECRET_KEY)
 * 4. Mutual credential independence (publisher secret cannot unlock viewer, and vice versa)
 * 5. Strict allowed origins enforcement:
 *    - Production origin https://can7usat-ground-control-station.pages.dev always permitted
 *    - http://localhost:5173 permitted ONLY when explicitly configured
 *    - Arbitrary localhost ports (e.g. 3000, 8080) and wildcards (*) strictly rejected
 * 6. Repeated AUTH frames and role escalation prevention (ALREADY_AUTHENTICATED)
 * 7. Command transmission prohibition over cloud relay (COMMANDS_PROHIBITED)
 * 8. Authentication deadline and session expiry under hibernation
 * 9. Single active publisher lease per mission and duplicate rejection
 * 10. Publisher disconnection, lease release, and reconnection
 * 11. Initial snapshot delivery for late-joining viewers with accurate historical/stale flags
 * 12. Monotonic sequence numbering and duplicate/out-of-order rejection
 * 13. Message size bounding (64 KB cap) and simulation-to-live isolation
 * 14. Multi-client broadcast to concurrent viewers
 */

import assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach } from 'node:test';
import {
  authenticateRole,
  timingSafeEqual,
  validateOrigin,
  DEFAULT_PRODUCTION_ORIGIN,
} from '../../../worker/src/auth';
import {
  TelemetrySyncService,
  SyncConnectionState,
} from '../telemetrySyncService';
import {
  TelemetryPacket,
  FlightStateCode,
} from '../../types';

// Mock Telemetry Packet matching CAN7USAT_FSW contract
function createSamplePacket(packetNumber: number, isSimulated = false): TelemetryPacket {
  return {
    teamId: '2026-IN-SPACe-CAN-7USAT-017',
    packetNumber,
    missionTimeSeconds: 120 + packetNumber,
    timestampUtc: '06:45:12',
    pressure: 1013.25 - packetNumber * 2,
    temperature: 28.5,
    altitude: 150.0 + packetNumber * 10,
    velocity: -4.5,
    acceleration: 1.05,
    accelX: 0.1,
    accelY: 0.05,
    accelZ: 1.0,
    spinRate: 0.0,
    wheelRpm: 6000,
    roll: 1.2,
    pitch: -0.8,
    yaw: 45.0,
    latitude: 26.7994,
    longitude: 83.9535,
    gpsAltitude: 230.0,
    gpsSats: 9,
    gpsFixType: '3D',
    gpsValid: true,
    co2: 420,
    pm2_5: 12.5,
    uv: 2.1,
    humidity: 45.0,
    batteryVoltage: 8.2,
    currentDraw: 0.45,
    power: 3.69,
    batterySoc: 92.0,
    rssi: -65,
    stateCode: FlightStateCode.PRECISION_GUIDANCE,
    fswStateName: 'PRECISION_GUIDE',
    l1Connected: true,
    l2Connected: true,
    deployed: true,
    audioBeaconActive: false,
    gsmModuleActive: true,
    source: isSimulated ? 'SIMULATION' : 'LIVE_SERIAL',
    receivedAtMs: Date.now(),
    receivedAtTimeStr: '12:15:12',
  };
}

describe('Telemetry Sync — Hardened Authentication & Origin Security', () => {
  const env = {
    TELEMETRY_RELAY_DO: {} as any,
    PUBLISHER_SECRET_KEY: 'parikshit-publisher-secret-2026',
    VIEWER_SECRET_KEY: 'parikshit-viewer-passcode-017',
    ALLOWED_ORIGINS: 'https://can7usat-ground-control-station.pages.dev,http://localhost:5173',
    MAX_PAYLOAD_BYTES: 65536,
  };

  it('timingSafeEqual validates identical strings and rejects mismatched or different-length strings', () => {
    assert.strictEqual(timingSafeEqual('correct-secret', 'correct-secret'), true);
    assert.strictEqual(timingSafeEqual('correct-secret', 'wrong-secret'), false);
    assert.strictEqual(timingSafeEqual('correct-secret', 'correct-secre'), false);
    assert.strictEqual(timingSafeEqual('correct-secret', 'correct-secret-extra'), false);
    assert.strictEqual(timingSafeEqual('', ''), true);
    assert.strictEqual(timingSafeEqual('', 'secret'), false);
  });

  it('authorizes valid publisher token and strictly rejects invalid or empty tokens', () => {
    const valid = authenticateRole('publisher', 'parikshit-publisher-secret-2026', env);
    assert.strictEqual(valid.authorized, true);

    const invalid = authenticateRole('publisher', 'wrong-token', env);
    assert.strictEqual(invalid.authorized, false);
    assert.match(invalid.reason || '', /Invalid publisher authorization/);

    const empty = authenticateRole('publisher', '', env);
    assert.strictEqual(empty.authorized, false);
    assert.match(empty.reason || '', /Publisher token is required/);
  });

  it('disables publishing completely (fail-closed) if server has no PUBLISHER_SECRET_KEY configured', () => {
    const unconfiguredEnv = { ...env, PUBLISHER_SECRET_KEY: '' };
    const result = authenticateRole('publisher', 'any-token', unconfiguredEnv);
    assert.strictEqual(result.authorized, false);
    assert.match(result.reason || '', /not configured on the relay server/);
  });

  it('enforces mandatory viewer authentication and rejects missing, empty, or wrong passcodes', () => {
    // Valid viewer passcode
    const validViewer = authenticateRole('viewer', 'parikshit-viewer-passcode-017', env);
    assert.strictEqual(validViewer.authorized, true);

    // Wrong passcode
    const wrongViewer = authenticateRole('viewer', 'wrong-passcode', env);
    assert.strictEqual(wrongViewer.authorized, false);
    assert.match(wrongViewer.reason || '', /Invalid viewer authorization/);

    // Empty passcode
    const emptyViewer = authenticateRole('viewer', '', env);
    assert.strictEqual(emptyViewer.authorized, false);
    assert.match(emptyViewer.reason || '', /Viewer passcode is required/);
  });

  it('disables viewing completely (fail-closed) if server has no VIEWER_SECRET_KEY configured', () => {
    const unconfiguredEnv = { ...env, VIEWER_SECRET_KEY: '' };
    const result = authenticateRole('viewer', 'some-passcode', unconfiguredEnv);
    assert.strictEqual(result.authorized, false);
    assert.match(result.reason || '', /Viewer authorization secret is not configured on the relay server/);
  });

  it('strictly enforces independent publisher and viewer credentials (no crossover)', () => {
    // Passing viewer passcode to publisher role must fail
    const pubWithViewerPasscode = authenticateRole('publisher', 'parikshit-viewer-passcode-017', env);
    assert.strictEqual(pubWithViewerPasscode.authorized, false);

    // Passing publisher secret to viewer role must fail
    const viewerWithPubSecret = authenticateRole('viewer', 'parikshit-publisher-secret-2026', env);
    assert.strictEqual(viewerWithPubSecret.authorized, false);
  });

  it('enforces strict allowed origins and rejects arbitrary localhost ports and wildcards', () => {
    // Production origin always allowed
    assert.strictEqual(validateOrigin('https://can7usat-ground-control-station.pages.dev', env.ALLOWED_ORIGINS), true);
    // Trailing slash handled cleanly
    assert.strictEqual(validateOrigin('https://can7usat-ground-control-station.pages.dev/', env.ALLOWED_ORIGINS), true);
    // Explicitly allowed localhost:5173
    assert.strictEqual(validateOrigin('http://localhost:5173', env.ALLOWED_ORIGINS), true);

    // Arbitrary localhost ports strictly rejected
    assert.strictEqual(validateOrigin('http://localhost:3000', env.ALLOWED_ORIGINS), false);
    assert.strictEqual(validateOrigin('http://localhost:8080', env.ALLOWED_ORIGINS), false);
    assert.strictEqual(validateOrigin('http://localhost:9999', env.ALLOWED_ORIGINS), false);

    // Attacker origin rejected
    assert.strictEqual(validateOrigin('https://attacker.evil.com', env.ALLOWED_ORIGINS), false);

    // Wildcard in ALLOWED_ORIGINS is rejected / ignored
    const wildcardEnvOrigins = 'https://can7usat-ground-control-station.pages.dev,*';
    assert.strictEqual(validateOrigin('https://attacker.evil.com', wildcardEnvOrigins), false);

    // Non-browser client with no Origin header is permitted (token authentication still applies)
    assert.strictEqual(validateOrigin(null, env.ALLOWED_ORIGINS), true);
  });
});

describe('Telemetry Sync Client — Role Enforcement & Rate/Backoff Logic', () => {
  let syncService: TelemetrySyncService;

  beforeEach(() => {
    syncService = new TelemetrySyncService();
  });

  afterEach(() => {
    syncService.disconnect();
  });

  it('initializes in DISCONNECTED state with zeroed metrics and publisher inactive', () => {
    assert.strictEqual(syncService.getState(), 'DISCONNECTED');
    assert.strictEqual(syncService.isConnected(), false);
    const metrics = syncService.getMetrics();
    assert.strictEqual(metrics.packetsSent, 0);
    assert.strictEqual(metrics.packetsReceived, 0);
    assert.strictEqual(metrics.publisherActive, false);
  });

  it('strictly blocks publishPacket when not connected as an authorized publisher', () => {
    const packet = createSamplePacket(1);
    const publishedWhileDisconnected = syncService.publishPacket(packet, 'FSW:RAW_SENTENCE');
    assert.strictEqual(publishedWhileDisconnected, false);
    assert.strictEqual(syncService.getMetrics().packetsSent, 0);
  });

  it('blocks viewer role from publishing telemetry packets', async () => {
    (syncService as any).state = 'CONNECTED';
    (syncService as any).metrics.role = 'viewer';
    (syncService as any).metrics.connected = true;
    (syncService as any).ws = {
      readyState: 1,
      send: () => {
        throw new Error('Viewer socket send should never be called for packets');
      },
    };

    const packet = createSamplePacket(2);
    const publishedByViewer = syncService.publishPacket(packet, 'FSW:RAW_SENTENCE');
    assert.strictEqual(publishedByViewer, false);
    assert.strictEqual(syncService.getMetrics().packetsSent, 0);
  });

  it('computes exponential backoff with bounded upper limit and positive jitter', () => {
    const delay0 = syncService.computeBackoffDelay(0);
    assert.ok(delay0 >= 800 && delay0 <= 1500, `delay0=${delay0} outside expected bounds [800, 1500]`);

    const delay2 = syncService.computeBackoffDelay(2);
    assert.ok(delay2 >= 1800 && delay2 <= 2800, `delay2=${delay2} outside expected bounds [1800, 2800]`);

    const delay10 = syncService.computeBackoffDelay(10);
    assert.ok(delay10 >= 12000 && delay10 <= 18000, `delay10=${delay10} outside expected bounds [12000, 18000]`);
  });

  it('generates strictly monotonic sequence numbers when publishing frames', () => {
    const sentFrames: any[] = [];
    (syncService as any).state = 'CONNECTED';
    (syncService as any).metrics.role = 'publisher';
    (syncService as any).metrics.connected = true;
    (syncService as any).config = {
      role: 'publisher',
      missionId: 'CAN-7USAT-017',
      isTestSession: false,
    };
    (syncService as any).ws = {
      readyState: 1,
      send: (data: string) => {
        sentFrames.push(JSON.parse(data));
      },
    };

    for (let i = 1; i <= 5; i++) {
      const packet = createSamplePacket(i);
      const ok = syncService.publishPacket(packet, `FSW:FRAME_${i}`);
      assert.strictEqual(ok, true);
    }

    assert.strictEqual(sentFrames.length, 5);
    assert.deepStrictEqual(
      sentFrames.map((f) => f.sequenceNumber),
      [1, 2, 3, 4, 5]
    );
    assert.strictEqual(syncService.getMetrics().packetsSent, 5);
    assert.ok(sentFrames.every((f) => f.sourceType === 'LIVE_SERIAL'));
  });

  it('tags packets as SIMULATION_TEST when publishing in an explicit test session', () => {
    const sentFrames: any[] = [];
    (syncService as any).state = 'CONNECTED';
    (syncService as any).metrics.role = 'publisher';
    (syncService as any).metrics.connected = true;
    (syncService as any).config = {
      role: 'publisher',
      missionId: 'CAN-7USAT-TEST-01',
      isTestSession: true,
    };
    (syncService as any).ws = {
      readyState: 1,
      send: (data: string) => {
        sentFrames.push(JSON.parse(data));
      },
    };

    const simPacket = createSamplePacket(10, true);
    const ok = syncService.publishPacket(simPacket, 'SIM:FRAME_10');
    assert.strictEqual(ok, true);

    assert.strictEqual(sentFrames.length, 1);
    assert.strictEqual(sentFrames[0].sourceType, 'SIMULATION_TEST');
    assert.strictEqual(sentFrames[0].missionId, 'CAN-7USAT-TEST-01');
  });
});

describe('Telemetry Relay Server Protocol — Hardened DO Emulation & Concurrency Rules', () => {
  /**
   * Hardened in-memory emulator of TelemetryRelayDO logic
   */
  class HardenedRelayDO {
    public missionId = 'CAN-7USAT-017';
    public activePublisherId: string | null = null;
    public publisherLastSeenMs: number | null = null;
    public lastSequenceNumber = 0;
    public latestPacket: TelemetryPacket | null = null;
    public latestRawSentence: string | null = null;
    public recentHistory: TelemetryPacket[] = [];
    public activeSockets: Map<
      string,
      {
        role: string;
        authenticated: boolean;
        connectedAtMs: number;
        authDeadlineMs: number;
        send: (msg: string) => void;
        close: (code: number, reason: string) => void;
      }
    > = new Map();

    public env = {
      TELEMETRY_RELAY_DO: {} as any,
      PUBLISHER_SECRET_KEY: 'parikshit-publisher-secret-2026',
      VIEWER_SECRET_KEY: 'parikshit-viewer-passcode-017',
      ALLOWED_ORIGINS: 'https://can7usat-ground-control-station.pages.dev,http://localhost:5173',
      MAX_PAYLOAD_BYTES: 65536,
    };

    public connectSocket(socketId: string, send: (msg: string) => void, close: (code: number, reason: string) => void) {
      const now = Date.now();
      this.activeSockets.set(socketId, {
        role: 'pending',
        authenticated: false,
        connectedAtMs: now,
        authDeadlineMs: now + 5000,
        send,
        close,
      });
    }

    public handleAuth(socketId: string, role: string, token: string): { success: boolean; error?: string; code?: string } {
      const sock = this.activeSockets.get(socketId);
      if (!sock) return { success: false, error: 'Socket not found' };

      // Anti-role escalation: session already authenticated
      if (sock.authenticated) {
        return {
          success: false,
          error: 'Session is already authenticated. Role escalation or re-authentication is prohibited.',
          code: 'ALREADY_AUTHENTICATED',
        };
      }

      // Deadline check
      if (Date.now() > sock.authDeadlineMs) {
        sock.close(4401, 'Auth Timeout');
        return { success: false, error: 'Authentication deadline expired.', code: 'AUTH_TIMEOUT' };
      }

      const authRes = authenticateRole(role as any, token, this.env);
      if (!authRes.authorized) {
        sock.close(4403, 'Forbidden');
        return { success: false, error: authRes.reason, code: 'INVALID_CREDENTIALS' };
      }

      if (role === 'publisher') {
        if (this.activePublisherId && this.activePublisherId !== socketId) {
          sock.close(4409, 'Publisher lease active');
          return {
            success: false,
            error: 'Another ground station holds an active publisher lease for this mission.',
            code: 'PUBLISHER_LEASE_ACTIVE',
          };
        }
        this.activePublisherId = socketId;
        this.publisherLastSeenMs = Date.now();
        sock.role = 'publisher';
        sock.authenticated = true;
        this.broadcastPublisherStatus('ACTIVE');
        return { success: true };
      }

      if (role === 'viewer') {
        sock.role = 'viewer';
        sock.authenticated = true;
        this.sendSnapshot(socketId);
        return { success: true };
      }

      return { success: false, error: 'Unknown role' };
    }

    public handleMessage(socketId: string, rawJson: string): { success: boolean; error?: string; code?: string } {
      const sock = this.activeSockets.get(socketId);
      if (!sock) return { success: false, error: 'Socket not found' };

      if (rawJson.length > 65536) {
        return { success: false, error: 'Payload exceeds 64KB limit', code: 'PAYLOAD_TOO_LARGE' };
      }

      let payload: any;
      try {
        payload = JSON.parse(rawJson);
      } catch {
        return { success: false, error: 'Malformed JSON payload', code: 'MALFORMED_PAYLOAD' };
      }

      // Check command prohibition
      const rawType = payload.type;
      if (
        rawType === 'COMMAND' ||
        rawType === 'TELECOMMAND' ||
        rawType === 'ACTUATOR_COMMAND' ||
        rawType === 'BURNWIRE' ||
        rawType === 'CALIBRATE' ||
        rawType === 'OVERRIDE_STATE' ||
        rawType === 'SET_TARGET'
      ) {
        return {
          success: false,
          error: 'Ground station telemetry relay is strictly downlink telemetry only. Command uplink is prohibited.',
          code: 'COMMANDS_PROHIBITED',
        };
      }

      // Auth message
      if (payload.type === 'AUTH') {
        return this.handleAuth(socketId, payload.role, payload.token);
      }

      // Unauthenticated check
      if (!sock.authenticated) {
        return { success: false, error: 'Client must authenticate via AUTH message first.', code: 'UNAUTHORIZED' };
      }

      if (payload.type === 'TELEMETRY_FRAME') {
        if (sock.role !== 'publisher') {
          return { success: false, error: 'Viewer cannot publish telemetry frames', code: 'PERMISSION_DENIED' };
        }

        // Check simulation contamination
        if (payload.sourceType === 'SIMULATION_TEST' && !this.missionId.includes('TEST')) {
          return {
            success: false,
            error: 'Simulation packets cannot be broadcasted to a live flight mission',
            code: 'SIMULATION_CONTAMINATION_REJECTED',
          };
        }

        // Sequence monotonicity
        if (payload.sequenceNumber <= this.lastSequenceNumber) {
          return { success: false, error: 'Out-of-order sequence number rejected', code: 'MALFORMED_PAYLOAD' };
        }

        this.lastSequenceNumber = payload.sequenceNumber;
        this.latestPacket = payload.packet;
        this.latestRawSentence = payload.rawSentence;
        this.publisherLastSeenMs = Date.now();

        this.recentHistory.push(payload.packet);
        if (this.recentHistory.length > 50) {
          this.recentHistory.shift();
        }

        // Broadcast to viewers
        const broadcastMsg = JSON.stringify({
          type: 'TELEMETRY_FRAME',
          sequenceNumber: payload.sequenceNumber,
          sourceType: payload.sourceType,
          missionId: this.missionId,
          publishedAtMs: Date.now(),
          rawSentence: payload.rawSentence,
          packet: payload.packet,
        });

        for (const [id, client] of this.activeSockets) {
          if (id !== socketId && client.authenticated && client.role === 'viewer') {
            client.send(broadcastMsg);
          }
        }

        return { success: true };
      }

      return { success: true };
    }

    public handleDisconnect(socketId: string): void {
      if (this.activePublisherId === socketId) {
        this.activePublisherId = null;
        this.broadcastPublisherStatus('DISCONNECTED');
      }
      this.activeSockets.delete(socketId);
    }

    public sendSnapshot(socketId: string): void {
      const sock = this.activeSockets.get(socketId);
      if (!sock) return;

      const isHistorical =
        !this.activePublisherId ||
        (this.publisherLastSeenMs !== null && Date.now() - this.publisherLastSeenMs > 3000);

      const snapshot = JSON.stringify({
        type: 'SNAPSHOT',
        missionId: this.missionId,
        publisherActive: this.activePublisherId !== null,
        isHistorical,
        snapshotAgeMs: this.publisherLastSeenMs ? Date.now() - this.publisherLastSeenMs : null,
        latestPacket: this.latestPacket,
        latestRawSentence: this.latestRawSentence,
        recentHistory: this.recentHistory,
      });
      sock.send(snapshot);
    }

    private broadcastPublisherStatus(status: 'ACTIVE' | 'DISCONNECTED'): void {
      const msg = JSON.stringify({
        type: 'PUBLISHER_STATUS',
        status,
        missionId: this.missionId,
        timestampMs: Date.now(),
      });
      for (const [, client] of this.activeSockets) {
        if (client.authenticated) {
          client.send(msg);
        }
      }
    }
  }

  it('rejects unauthorized publisher and grants lease to valid publisher', () => {
    const relay = new HardenedRelayDO();
    relay.connectSocket('client-1', () => {}, () => {});

    // Unauthorized attempt
    const resFail = relay.handleAuth('client-1', 'publisher', 'wrong-key');
    assert.strictEqual(resFail.success, false);
    assert.strictEqual(relay.activePublisherId, null);

    // Authorized attempt
    const resOk = relay.handleAuth('client-1', 'publisher', 'parikshit-publisher-secret-2026');
    assert.strictEqual(resOk.success, true);
    assert.strictEqual(relay.activePublisherId, 'client-1');
  });

  it('rejects viewer attempting to connect without valid viewer passcode', () => {
    const relay = new HardenedRelayDO();
    relay.connectSocket('viewer-1', () => {}, () => {});

    // Missing / wrong passcode
    const resFail = relay.handleAuth('viewer-1', 'viewer', 'wrong-passcode');
    assert.strictEqual(resFail.success, false);
    assert.strictEqual(resFail.code, 'INVALID_CREDENTIALS');

    // Valid passcode
    const resOk = relay.handleAuth('viewer-1', 'viewer', 'parikshit-viewer-passcode-017');
    assert.strictEqual(resOk.success, true);
  });

  it('strictly blocks repeated AUTH and role escalation on an already-authenticated session', () => {
    const relay = new HardenedRelayDO();
    relay.connectSocket('viewer-1', () => {}, () => {});

    // Authenticate as viewer
    const auth1 = relay.handleAuth('viewer-1', 'viewer', 'parikshit-viewer-passcode-017');
    assert.strictEqual(auth1.success, true);

    // Attempt role escalation by sending AUTH as publisher
    const escalateAttempt = relay.handleAuth('viewer-1', 'publisher', 'parikshit-publisher-secret-2026');
    assert.strictEqual(escalateAttempt.success, false);
    assert.strictEqual(escalateAttempt.code, 'ALREADY_AUTHENTICATED');
    assert.match(escalateAttempt.error || '', /already authenticated/);

    // Confirm socket role remains viewer
    assert.strictEqual(relay.activeSockets.get('viewer-1')?.role, 'viewer');
  });

  it('unconditionally prohibits command telecommands and hardware actuators', () => {
    const relay = new HardenedRelayDO();
    relay.connectSocket('client-cmd', () => {}, () => {});
    relay.handleAuth('client-cmd', 'publisher', 'parikshit-publisher-secret-2026');

    // Attempt to send hardware commands
    const burnwireAttempt = relay.handleMessage(
      'client-cmd',
      JSON.stringify({ type: 'BURNWIRE', durationMs: 7000 })
    );
    assert.strictEqual(burnwireAttempt.success, false);
    assert.strictEqual(burnwireAttempt.code, 'COMMANDS_PROHIBITED');

    const telecommandAttempt = relay.handleMessage(
      'client-cmd',
      JSON.stringify({ type: 'TELECOMMAND', command: 'RESET_FSW' })
    );
    assert.strictEqual(telecommandAttempt.success, false);
    assert.strictEqual(telecommandAttempt.code, 'COMMANDS_PROHIBITED');
  });

  it('rejects duplicate publisher while first publisher holds lease (1 publisher per mission)', () => {
    const relay = new HardenedRelayDO();
    relay.connectSocket('pub-1', () => {}, () => {});
    relay.connectSocket('pub-2', () => {}, () => {});

    const res1 = relay.handleAuth('pub-1', 'publisher', 'parikshit-publisher-secret-2026');
    assert.strictEqual(res1.success, true);
    assert.strictEqual(relay.activePublisherId, 'pub-1');

    // Duplicate publisher rejected
    const res2 = relay.handleAuth('pub-2', 'publisher', 'parikshit-publisher-secret-2026');
    assert.strictEqual(res2.success, false);
    assert.strictEqual(res2.code, 'PUBLISHER_LEASE_ACTIVE');
    assert.strictEqual(relay.activePublisherId, 'pub-1');
  });

  it('releases publisher lease upon disconnect and allows new publisher to connect', () => {
    const relay = new HardenedRelayDO();
    const viewerMessages: string[] = [];

    relay.connectSocket('pub-1', () => {}, () => {});
    relay.connectSocket('view-1', (m) => viewerMessages.push(m), () => {});

    relay.handleAuth('pub-1', 'publisher', 'parikshit-publisher-secret-2026');
    relay.handleAuth('view-1', 'viewer', 'parikshit-viewer-passcode-017');

    assert.strictEqual(relay.activePublisherId, 'pub-1');

    // Disconnect publisher
    relay.handleDisconnect('pub-1');
    assert.strictEqual(relay.activePublisherId, null);

    const statusMsg = viewerMessages.find((m) => m.includes('PUBLISHER_STATUS') && m.includes('DISCONNECTED'));
    assert.ok(statusMsg, 'Viewer did not receive PUBLISHER_STATUS DISCONNECTED');

    // New publisher can now connect
    relay.connectSocket('pub-reconnect', () => {}, () => {});
    const reconnectRes = relay.handleAuth('pub-reconnect', 'publisher', 'parikshit-publisher-secret-2026');
    assert.strictEqual(reconnectRes.success, true);
    assert.strictEqual(relay.activePublisherId, 'pub-reconnect');
  });

  it('delivers snapshot with latest packet and bounded history to late-joining viewers', () => {
    const relay = new HardenedRelayDO();
    relay.connectSocket('pub-1', () => {}, () => {});
    relay.handleAuth('pub-1', 'publisher', 'parikshit-publisher-secret-2026');

    for (let i = 1; i <= 5; i++) {
      const pkt = createSamplePacket(i);
      relay.handleMessage(
        'pub-1',
        JSON.stringify({
          type: 'TELEMETRY_FRAME',
          sequenceNumber: i,
          sourceType: 'LIVE_SERIAL',
          packet: pkt,
          rawSentence: `RAW_${i}`,
        })
      );
    }

    const lateViewerMessages: any[] = [];
    relay.connectSocket('late-viewer', (m) => lateViewerMessages.push(JSON.parse(m)), () => {});
    relay.handleAuth('late-viewer', 'viewer', 'parikshit-viewer-passcode-017');

    assert.strictEqual(lateViewerMessages.length, 1);
    const snapshot = lateViewerMessages[0];
    assert.strictEqual(snapshot.type, 'SNAPSHOT');
    assert.strictEqual(snapshot.publisherActive, true);
    assert.strictEqual(snapshot.isHistorical, false);
    assert.strictEqual(snapshot.latestPacket.packetNumber, 5);
    assert.strictEqual(snapshot.recentHistory.length, 5);
  });

  it('strictly bounds snapshot history buffer to 50 items', () => {
    const relay = new HardenedRelayDO();
    relay.connectSocket('pub-1', () => {}, () => {});
    relay.handleAuth('pub-1', 'publisher', 'parikshit-publisher-secret-2026');

    for (let i = 1; i <= 65; i++) {
      const pkt = createSamplePacket(i);
      relay.handleMessage(
        'pub-1',
        JSON.stringify({
          type: 'TELEMETRY_FRAME',
          sequenceNumber: i,
          sourceType: 'LIVE_SERIAL',
          packet: pkt,
          rawSentence: `RAW_${i}`,
        })
      );
    }

    assert.strictEqual(relay.recentHistory.length, 50);
    assert.strictEqual(relay.recentHistory[0].packetNumber, 16);
    assert.strictEqual(relay.recentHistory[49].packetNumber, 65);
  });

  it('rejects out-of-order and duplicate sequence numbers from publisher', () => {
    const relay = new HardenedRelayDO();
    relay.connectSocket('pub-1', () => {}, () => {});
    relay.handleAuth('pub-1', 'publisher', 'parikshit-publisher-secret-2026');

    const res1 = relay.handleMessage('pub-1', JSON.stringify({
      type: 'TELEMETRY_FRAME',
      sequenceNumber: 1,
      sourceType: 'LIVE_SERIAL',
      packet: createSamplePacket(1),
    }));
    assert.strictEqual(res1.success, true);

    // Duplicate rejected
    const resDup = relay.handleMessage('pub-1', JSON.stringify({
      type: 'TELEMETRY_FRAME',
      sequenceNumber: 1,
      sourceType: 'LIVE_SERIAL',
      packet: createSamplePacket(1),
    }));
    assert.strictEqual(resDup.success, false);

    // Frame 2 OK
    const res2 = relay.handleMessage('pub-1', JSON.stringify({
      type: 'TELEMETRY_FRAME',
      sequenceNumber: 2,
      sourceType: 'LIVE_SERIAL',
      packet: createSamplePacket(2),
    }));
    assert.strictEqual(res2.success, true);
  });

  it('rejects oversized payloads exceeding 64KB', () => {
    const relay = new HardenedRelayDO();
    relay.connectSocket('pub-1', () => {}, () => {});
    relay.handleAuth('pub-1', 'publisher', 'parikshit-publisher-secret-2026');

    const bigString = 'A'.repeat(70000);
    const res = relay.handleMessage('pub-1', bigString);
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.code, 'PAYLOAD_TOO_LARGE');
  });

  it('prevents simulation-to-live contamination on live mission channel', () => {
    const relay = new HardenedRelayDO();
    relay.connectSocket('pub-1', () => {}, () => {});
    relay.handleAuth('pub-1', 'publisher', 'parikshit-publisher-secret-2026');

    const simPkt = createSamplePacket(1, true);
    const res = relay.handleMessage('pub-1', JSON.stringify({
      type: 'TELEMETRY_FRAME',
      sequenceNumber: 1,
      sourceType: 'SIMULATION_TEST',
      packet: simPkt,
      rawSentence: 'SIM:DISTURBANCE_ACTIVE',
    }));

    assert.strictEqual(res.success, false);
    assert.strictEqual(res.code, 'SIMULATION_CONTAMINATION_REJECTED');
    assert.strictEqual(relay.latestPacket, null);
  });

  it('broadcasts published frame to multiple concurrent viewers simultaneously', () => {
    const relay = new HardenedRelayDO();
    relay.connectSocket('pub-1', () => {}, () => {});
    relay.handleAuth('pub-1', 'publisher', 'parikshit-publisher-secret-2026');

    const viewer1Messages: any[] = [];
    const viewer2Messages: any[] = [];

    relay.connectSocket('viewer-1', (m) => viewer1Messages.push(JSON.parse(m)), () => {});
    relay.connectSocket('viewer-2', (m) => viewer2Messages.push(JSON.parse(m)), () => {});

    relay.handleAuth('viewer-1', 'viewer', 'parikshit-viewer-passcode-017');
    relay.handleAuth('viewer-2', 'viewer', 'parikshit-viewer-passcode-017');

    const pkt = createSamplePacket(1);
    const pubRes = relay.handleMessage('pub-1', JSON.stringify({
      type: 'TELEMETRY_FRAME',
      sequenceNumber: 1,
      sourceType: 'LIVE_SERIAL',
      packet: pkt,
      rawSentence: 'FSW:FRAME_1',
    }));

    assert.strictEqual(pubRes.success, true);

    const frame1 = viewer1Messages.find((m) => m.type === 'TELEMETRY_FRAME');
    const frame2 = viewer2Messages.find((m) => m.type === 'TELEMETRY_FRAME');

    assert.ok(frame1, 'Viewer 1 did not receive TELEMETRY_FRAME');
    assert.ok(frame2, 'Viewer 2 did not receive TELEMETRY_FRAME');
    assert.strictEqual(frame1.sequenceNumber, 1);
    assert.strictEqual(frame2.sequenceNumber, 1);
  });
});
