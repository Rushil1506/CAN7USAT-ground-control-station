/**
 * CAN-7USAT Ground Control Station
 * Secure Real-Time Telemetry Synchronization Service
 *
 * Manages WebSocket connectivity to the Cloudflare Worker & Durable Object relay.
 * Supports both Ground-Station Publisher mode and Read-Only Remote Viewer mode.
 */

import { TelemetryPacket } from '../types';

export type SyncRole = 'publisher' | 'viewer';

export type SyncConnectionState =
  | 'DISCONNECTED'
  | 'CONNECTING'
  | 'CONNECTED'
  | 'RECONNECTING'
  | 'ERROR'
  | 'AUTH_FAILED';

export interface SyncMetrics {
  connected: boolean;
  role: SyncRole | 'none';
  missionId: string;
  packetsSent: number;
  packetsReceived: number;
  lastPacketTimeMs: number | null;
  publisherActive: boolean;
  publisherLastSeenMs: number | null;
  serverTimeOffsetMs: number;
  rttMs: number;
  reconnectAttempts: number;
  lastError: string | null;
}

export interface SyncConfig {
  endpoint: string;
  missionId: string;
  role: SyncRole;
  token?: string;
  clientLabel?: string;
  isTestSession?: boolean;
}

export interface SyncEventListener {
  onPacket?: (
    packet: TelemetryPacket,
    rawSentence: string,
    metadata: {
      sequenceNumber: number;
      latencyMs: number;
      isRelayed: boolean;
      sourceType: string;
    }
  ) => void;
  onSnapshot?: (snapshot: {
    latestPacket: TelemetryPacket | null;
    rawSentence: string | null;
    isHistorical: boolean;
    snapshotAgeMs: number | null;
    recentHistory: TelemetryPacket[];
  }) => void;
  onStatusChange?: (
    state: SyncConnectionState,
    metrics: SyncMetrics,
    message?: string
  ) => void;
  onPublisherStatus?: (
    status: 'ACTIVE' | 'STALE' | 'DISCONNECTED',
    viewersCount: number
  ) => void;
}

export const DEFAULT_RELAY_ENDPOINT =
  typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'ws://localhost:8787/api/v1/telemetry/ws'
    : 'wss://telemetry-relay.can7usat.pages.dev/api/v1/telemetry/ws';

export class TelemetrySyncService {
  private ws: WebSocket | null = null;
  private state: SyncConnectionState = 'DISCONNECTED';
  private config: SyncConfig | null = null;
  private listeners: Set<SyncEventListener> = new Set();

  private sequenceNumber: number = 0;
  private reconnectAttempts: number = 0;
  private reconnectTimer: number | null = null;
  private heartbeatTimer: number | null = null;
  private intentionalDisconnect: boolean = false;

  private metrics: SyncMetrics = {
    connected: false,
    role: 'none',
    missionId: 'CAN-7USAT-017',
    packetsSent: 0,
    packetsReceived: 0,
    lastPacketTimeMs: null,
    publisherActive: false,
    publisherLastSeenMs: null,
    serverTimeOffsetMs: 0,
    rttMs: 0,
    reconnectAttempts: 0,
    lastError: null,
  };

  public getState(): SyncConnectionState {
    return this.state;
  }

  public getMetrics(): SyncMetrics {
    return { ...this.metrics };
  }

  public isConnected(): boolean {
    return this.state === 'CONNECTED' && this.ws?.readyState === WebSocket.OPEN;
  }

  public getRole(): SyncRole | 'none' {
    return this.metrics.role;
  }

  public subscribe(listener: SyncEventListener): () => void {
    this.listeners.add(listener);
    // Immediately notify of current status
    listener.onStatusChange?.(this.state, this.getMetrics());
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Connects to the relay server as an authorized Ground Station Publisher.
   */
  public async startPublisher(
    endpoint: string,
    missionId: string,
    publisherKey: string,
    clientLabel: string = 'GroundStation-Primary',
    isTestSession: boolean = false
  ): Promise<void> {
    this.intentionalDisconnect = false;
    this.config = {
      endpoint,
      missionId,
      role: 'publisher',
      token: publisherKey,
      clientLabel,
      isTestSession,
    };
    this.reconnectAttempts = 0;
    this.metrics.role = 'publisher';
    this.metrics.missionId = missionId;
    await this.connect();
  }

  /**
   * Connects to the relay server as an authenticated Read-Only Remote Viewer.
   */
  public async startViewer(
    endpoint: string,
    missionId: string,
    viewerPasscode: string,
    clientLabel: string = 'RemoteViewer-Field'
  ): Promise<void> {
    this.intentionalDisconnect = false;
    this.config = {
      endpoint,
      missionId,
      role: 'viewer',
      token: viewerPasscode,
      clientLabel,
    };
    this.reconnectAttempts = 0;
    this.metrics.role = 'viewer';
    this.metrics.missionId = missionId;
    await this.connect();
  }

  /**
   * Disconnects and shuts down active connection and reconnect loop.
   */
  public disconnect(): void {
    this.intentionalDisconnect = true;
    this.clearTimers();
    if (this.ws) {
      try {
        this.ws.close(1000, 'Client disconnected');
      } catch {
        // ignore
      }
      this.ws = null;
    }
    this.metrics.connected = false;
    this.setState('DISCONNECTED', 'Synchronized session terminated by operator.');
  }

  /**
   * Publishes a validated live telemetry packet to the relay server.
   * Strictly blocked if not connected as an authorized publisher.
   */
  public publishPacket(packet: TelemetryPacket, rawSentence: string): boolean {
    if (!this.isConnected() || this.metrics.role !== 'publisher') {
      return false;
    }

    const now = Date.now();
    this.sequenceNumber++;

    const payload = {
      type: 'TELEMETRY_FRAME',
      schemaVersion: 1,
      sequenceNumber: this.sequenceNumber,
      sourceType: this.config?.isTestSession ? 'SIMULATION_TEST' : 'LIVE_SERIAL',
      missionId: this.config?.missionId || 'CAN-7USAT-017',
      receivedAtMs: packet.receivedAtMs || now,
      publishedAtMs: now,
      rawSentence,
      packet,
    };

    try {
      this.ws!.send(JSON.stringify(payload));
      this.metrics.packetsSent++;
      this.metrics.lastPacketTimeMs = now;
      this.notifyStatusChange();
      return true;
    } catch (err) {
      console.error('[TelemetrySync] Failed to publish packet:', err);
      return false;
    }
  }

  // --- Private Implementation Methods ---

  private async connect(): Promise<void> {
    if (!this.config) return;

    this.clearTimers();
    this.setState(
      this.reconnectAttempts > 0 ? 'RECONNECTING' : 'CONNECTING',
      `Connecting to relay ${this.config.endpoint} (${this.config.role})...`
    );

    try {
      // Build WebSocket URL with query params
      const wsUrl = new URL(this.config.endpoint);
      wsUrl.searchParams.set('missionId', this.config.missionId);
      wsUrl.searchParams.set('role', this.config.role);

      const ws = new WebSocket(wsUrl.toString());
      this.ws = ws;

      ws.onopen = () => {
        if (ws !== this.ws) return;
        // On connection, immediately send AUTH frame
        this.sendAuthFrame();
      };

      ws.onmessage = (event) => {
        if (ws !== this.ws) return;
        this.handleMessage(event.data);
      };

      ws.onclose = (event) => {
        if (ws !== this.ws) return;
        this.handleClose(event.code, event.reason);
      };

      ws.onerror = (err) => {
        if (ws !== this.ws) return;
        console.warn('[TelemetrySync] WebSocket error:', err);
      };
    } catch (err: any) {
      this.handleConnectionFailure(err?.message || 'WebSocket connection failed');
    }
  }

  private sendAuthFrame(): void {
    if (!this.ws || !this.config) return;

    const authPayload = {
      type: 'AUTH',
      role: this.config.role,
      missionId: this.config.missionId,
      token: this.config.token || '',
      clientLabel: this.config.clientLabel,
    };

    try {
      this.ws.send(JSON.stringify(authPayload));
    } catch (err) {
      this.handleConnectionFailure('Failed to send authentication handshake');
    }
  }

  private handleMessage(data: any): void {
    let msg: any;
    try {
      msg = JSON.parse(typeof data === 'string' ? data : new TextDecoder().decode(data));
    } catch {
      return;
    }

    const now = Date.now();

    if (msg.type === 'AUTH_SUCCESS') {
      this.reconnectAttempts = 0;
      this.metrics.connected = true;
      this.metrics.serverTimeOffsetMs = msg.serverTimeMs ? msg.serverTimeMs - now : 0;
      this.metrics.publisherActive = msg.publisherActive ?? false;
      this.metrics.publisherLastSeenMs = msg.publisherLastSeenMs ?? null;

      this.setState(
        'CONNECTED',
        `Authenticated as ${msg.role.toUpperCase()} for mission ${msg.missionId}`
      );

      // Start periodic heartbeats
      this.startHeartbeats();
      return;
    }

    if (msg.type === 'AUTH_ERROR') {
      this.metrics.lastError = msg.message;
      this.setState('AUTH_FAILED', `Authentication rejected: ${msg.message}`);
      // Do not auto-reconnect on auth failure
      this.intentionalDisconnect = true;
      return;
    }

    if (msg.type === 'SNAPSHOT') {
      this.metrics.publisherActive = msg.publisherActive ?? false;
      const ageMs = msg.snapshotAgeMs ?? null;

      // Notify snapshot listeners
      for (const listener of this.listeners) {
        listener.onSnapshot?.({
          latestPacket: msg.latestPacket as TelemetryPacket | null,
          rawSentence: msg.latestRawSentence ?? null,
          isHistorical: msg.isHistorical ?? false,
          snapshotAgeMs: ageMs,
          recentHistory: (msg.recentHistory || []) as TelemetryPacket[],
        });
      }
      return;
    }

    if (msg.type === 'TELEMETRY_FRAME') {
      this.metrics.packetsReceived++;
      this.metrics.lastPacketTimeMs = now;
      this.metrics.publisherActive = true;
      this.metrics.publisherLastSeenMs = msg.publishedAtMs || now;

      const latencyMs = msg.publishedAtMs ? Math.max(0, now - msg.publishedAtMs) : 0;
      const packet = msg.packet as TelemetryPacket;

      // Notify packet listeners
      for (const listener of this.listeners) {
        listener.onPacket?.(packet, msg.rawSentence || '', {
          sequenceNumber: msg.sequenceNumber,
          latencyMs,
          isRelayed: true,
          sourceType: msg.sourceType,
        });
      }
      return;
    }

    if (msg.type === 'PUBLISHER_STATUS') {
      this.metrics.publisherActive = msg.status === 'ACTIVE';
      this.metrics.publisherLastSeenMs = msg.lastSeenMs ?? null;

      for (const listener of this.listeners) {
        listener.onPublisherStatus?.(msg.status, msg.activeViewersCount || 0);
      }
      this.notifyStatusChange();
      return;
    }

    if (msg.type === 'PONG') {
      if (msg.clientTimestamp) {
        this.metrics.rttMs = Math.max(0, now - msg.clientTimestamp);
      }
      if (msg.serverTimeMs) {
        this.metrics.serverTimeOffsetMs = msg.serverTimeMs - now;
      }
      this.notifyStatusChange();
      return;
    }

    if (msg.type === 'ERROR') {
      this.metrics.lastError = msg.message;
      this.notifyStatusChange();
      return;
    }
  }

  private handleClose(code: number, reason: string): void {
    this.clearTimers();
    this.metrics.connected = false;

    if (code === 4403 || code === 4401 || code === 4409) {
      this.setState('AUTH_FAILED', `Relay closed: ${reason} (code ${code})`);
      return;
    }

    if (this.intentionalDisconnect) {
      this.setState('DISCONNECTED', 'Session closed.');
      return;
    }

    // Schedule automatic reconnection with exponential backoff + jitter
    this.scheduleReconnect();
  }

  private handleConnectionFailure(errorMsg: string): void {
    this.metrics.lastError = errorMsg;
    this.metrics.connected = false;
    this.setState('ERROR', errorMsg);
    if (!this.intentionalDisconnect) {
      this.scheduleReconnect();
    }
  }

  /**
   * Computes exponential backoff delay with bounded cap and +/-20% random jitter.
   */
  public computeBackoffDelay(attempts: number): number {
    const baseDelay = Math.min(15000, 1000 * Math.pow(1.5, Math.min(attempts, 8)));
    const jitter = baseDelay * 0.2 * (Math.random() * 2 - 1);
    return Math.max(800, Math.round(baseDelay + jitter));
  }

  private scheduleReconnect(): void {
    this.reconnectAttempts++;
    this.metrics.reconnectAttempts = this.reconnectAttempts;

    const delay = this.computeBackoffDelay(this.reconnectAttempts);

    this.setState(
      'RECONNECTING',
      `Connection lost. Reconnecting in ${(delay / 1000).toFixed(1)}s (attempt ${
        this.reconnectAttempts
      })...`
    );

    this.reconnectTimer = window.setTimeout(() => {
      void this.connect();
    }, delay);
  }

  private startHeartbeats(): void {
    if (this.heartbeatTimer) window.clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = window.setInterval(() => {
      if (this.isConnected()) {
        try {
          this.ws!.send(
            JSON.stringify({
              type: 'PING',
              timestamp: Date.now(),
            })
          );
        } catch {
          // ignore
        }
      }
    }, 3000);
  }

  private clearTimers(): void {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.heartbeatTimer !== null) {
      window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private setState(nextState: SyncConnectionState, message?: string): void {
    this.state = nextState;
    this.notifyStatusChange(message);
  }

  private notifyStatusChange(message?: string): void {
    const metricsCopy = this.getMetrics();
    for (const listener of this.listeners) {
      listener.onStatusChange?.(this.state, metricsCopy, message);
    }
  }
}

export const globalTelemetrySync = new TelemetrySyncService();
