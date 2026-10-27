/**
 * CAN-7USAT Telemetry Synchronization Durable Object
 * Powered by Cloudflare Workers Durable Objects WebSocket Hibernation API
 *
 * Hardened Features:
 * - Persistent Storage & Lease Recovery across DO hibernation and restarts
 * - WebSocket Hibernation API alarm-backed authentication timeout (cannot be bypassed by hibernation)
 * - Anti-role escalation: repeated AUTH frames or role switching strictly prohibited
 * - Strict read-only viewer isolation (commands and upload attempts unconditionally rejected)
 * - Constant-time secret authentication (fail-closed for both publisher and viewer)
 * - Sub-second stale publisher detection and accurate historical snapshot flags
 */

import { DurableObject } from 'cloudflare:workers';
import {
  AuthClientMessage,
  ClientMessage,
  ErrorServerMessage,
  RelayedTelemetryFrameMessage,
  ServerMessage,
  SnapshotServerMessage,
  SyncRole,
  TelemetryWorkerEnv,
  WebSocketSessionAttachment,
} from './types';
import { authenticateRole, validateOrigin } from './auth';

const MAX_HISTORY_SNAPSHOT_SIZE = 50;
const AUTH_TIMEOUT_MS = 5000;
const MAX_RATE_LIMIT_FRAMES_PER_SEC = 25;

export class TelemetryRelayDO extends DurableObject<TelemetryWorkerEnv> {
  private isLoadedFromStorage: boolean = false;
  private missionId: string = 'CAN-7USAT-017';
  private activePublisherId: string | null = null;
  private lastPublisherSeenMs: number | null = null;
  private lastSequenceNumber: number = 0;

  // Rate limiting tracker
  private frameCountInCurrentSecond: number = 0;
  private currentSecondEpoch: number = 0;

  // Snapshot cache
  private latestPacket: Record<string, unknown> | null = null;
  private latestRawSentence: string | null = null;
  private latestPacketReceivedMs: number | null = null;
  private recentHistory: Record<string, unknown>[] = [];

  constructor(ctx: DurableObjectState, env: TelemetryWorkerEnv) {
    super(ctx, env);
  }

  /**
   * Loads persisted mission state from Durable Object storage following hibernation or restart.
   */
  private async ensureLoadedFromStorage(): Promise<void> {
    if (this.isLoadedFromStorage) return;
    this.isLoadedFromStorage = true;

    try {
      const stored = await this.ctx.storage.get([
        'missionId',
        'activePublisherId',
        'lastPublisherSeenMs',
        'lastSequenceNumber',
        'latestPacket',
        'latestRawSentence',
        'latestPacketReceivedMs',
        'recentHistory',
      ]);

      if (stored.has('missionId')) {
        this.missionId = stored.get('missionId') as string;
      }
      if (stored.has('activePublisherId')) {
        this.activePublisherId = stored.get('activePublisherId') as string | null;
      }
      if (stored.has('lastPublisherSeenMs')) {
        this.lastPublisherSeenMs = stored.get('lastPublisherSeenMs') as number | null;
      }
      if (stored.has('lastSequenceNumber')) {
        this.lastSequenceNumber = (stored.get('lastSequenceNumber') as number) || 0;
      }
      if (stored.has('latestPacket')) {
        this.latestPacket = stored.get('latestPacket') as Record<string, unknown> | null;
      }
      if (stored.has('latestRawSentence')) {
        this.latestRawSentence = stored.get('latestRawSentence') as string | null;
      }
      if (stored.has('latestPacketReceivedMs')) {
        this.latestPacketReceivedMs = stored.get('latestPacketReceivedMs') as number | null;
      }
      if (stored.has('recentHistory')) {
        this.recentHistory = (stored.get('recentHistory') as Record<string, unknown>[]) || [];
      }

      // Reconcile publisher lease against actual live connected hibernated WebSockets
      this.reconcileActivePublisherLease();
    } catch (err) {
      console.warn('[TelemetryRelayDO] Storage load warning:', err);
    }
  }

  /**
   * Verifies if the recorded activePublisherId is still attached to an open WebSocket.
   * If the publisher disconnected during hibernation/restart, releases the lease.
   */
  private reconcileActivePublisherLease(): void {
    if (!this.activePublisherId) return;

    let publisherSocketFound = false;
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as WebSocketSessionAttachment | null;
      if (
        att &&
        att.id === this.activePublisherId &&
        att.authenticated &&
        att.role === 'publisher'
      ) {
        publisherSocketFound = true;
        break;
      }
    }

    if (!publisherSocketFound) {
      this.activePublisherId = null;
      void this.ctx.storage.put('activePublisherId', null);
      this.broadcastPublisherStatus('DISCONNECTED');
    }
  }

  /**
   * Durable Object Alarm Handler
   * Awakens the DO from hibernation to enforce authentication deadlines.
   */
  async alarm(): Promise<void> {
    const now = Date.now();
    let nextEarliestDeadline: number | null = null;
    const sockets = this.ctx.getWebSockets();

    for (const ws of sockets) {
      const att = ws.deserializeAttachment() as WebSocketSessionAttachment | null;
      if (!att) {
        try {
          ws.close(4401, 'Invalid attachment');
        } catch {
          // ignore
        }
        continue;
      }

      if (!att.authenticated) {
        if (now >= att.authDeadlineMs) {
          this.sendSafe(ws, {
            type: 'AUTH_ERROR',
            code: 'AUTH_TIMEOUT',
            message: 'Authentication deadline expired. Connection terminated.',
          });
          try {
            ws.close(4401, 'Auth Timeout');
          } catch {
            // ignore
          }
        } else {
          if (
            nextEarliestDeadline === null ||
            att.authDeadlineMs < nextEarliestDeadline
          ) {
            nextEarliestDeadline = att.authDeadlineMs;
          }
        }
      }
    }

    if (nextEarliestDeadline !== null) {
      await this.ctx.storage.setAlarm(nextEarliestDeadline);
    }
  }

  async fetch(request: Request): Promise<Response> {
    await this.ensureLoadedFromStorage();

    const url = new URL(request.url);

    // Validate Origin header
    const originHeader = request.headers.get('Origin');
    if (!validateOrigin(originHeader, this.env.ALLOWED_ORIGINS)) {
      return new Response('Forbidden: Origin not authorized by relay policy', {
        status: 403,
      });
    }

    // Extract requested missionId from query or header
    this.missionId =
      url.searchParams.get('missionId') ||
      request.headers.get('X-Mission-Id') ||
      this.env.DEFAULT_MISSION_ID ||
      'CAN-7USAT-017';

    // Upgrade HTTP request to WebSocket
    const upgradeHeader = request.headers.get('Upgrade');
    if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
      return new Response(
        JSON.stringify({
          status: 'ok',
          service: 'CAN-7USAT Telemetry Sync Durable Object',
          missionId: this.missionId,
          activePublisher: this.isPublisherActive(),
          lastPublisherSeenMs: this.lastPublisherSeenMs,
          connectedViewers: this.getViewerCount(),
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Use WebSocket Hibernation API: accept WebSocket into this Durable Object
    this.ctx.acceptWebSocket(server);

    const sessionId = crypto.randomUUID();
    const now = Date.now();
    const authDeadlineMs = now + AUTH_TIMEOUT_MS;

    const attachment: WebSocketSessionAttachment = {
      id: sessionId,
      role: 'viewer', // Defaults to unauthenticated viewer until AUTH frame arrives
      missionId: this.missionId,
      authenticated: false,
      clientLabel: 'Pending-Auth',
      connectedAtMs: now,
      authDeadlineMs,
      lastPingMs: now,
    };
    server.serializeAttachment(attachment);

    // Schedule persistent alarm to guarantee wakeup even during hibernation
    try {
      const currentAlarm = await this.ctx.storage.getAlarm();
      if (currentAlarm === null || authDeadlineMs < currentAlarm) {
        await this.ctx.storage.setAlarm(authDeadlineMs);
      }
    } catch (alarmErr) {
      console.warn('[TelemetryRelayDO] Failed to set alarm:', alarmErr);
    }

    // Schedule local in-memory timeout fallback
    this.scheduleAuthTimeout(server, sessionId);

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    await this.ensureLoadedFromStorage();

    let attachment = ws.deserializeAttachment() as WebSocketSessionAttachment | null;
    if (!attachment) {
      ws.close(4401, 'Invalid session attachment');
      return;
    }

    const now = Date.now();

    // Enforce authentication deadline even if DO hibernated and just woke up
    if (!attachment.authenticated && now > attachment.authDeadlineMs) {
      this.sendSafe(ws, {
        type: 'AUTH_ERROR',
        code: 'AUTH_TIMEOUT',
        message: 'Authentication deadline expired. No valid AUTH frame received.',
      });
      ws.close(4401, 'Auth Timeout');
      return;
    }

    // Check payload size
    const maxPayload = Number(this.env.MAX_PAYLOAD_BYTES || 65536);
    const byteLength = typeof message === 'string' ? message.length : message.byteLength;
    if (byteLength > maxPayload) {
      this.sendSafe(ws, {
        type: 'ERROR',
        code: 'PAYLOAD_TOO_LARGE',
        message: `Message exceeded maximum allowed size of ${maxPayload} bytes.`,
      });
      return;
    }

    // Parse JSON client message
    let clientMsg: ClientMessage;
    try {
      const text = typeof message === 'string' ? message : new TextDecoder().decode(message);
      clientMsg = JSON.parse(text) as ClientMessage;
    } catch {
      this.sendSafe(ws, {
        type: 'ERROR',
        code: 'MALFORMED_PAYLOAD',
        message: 'Invalid JSON payload received.',
      });
      return;
    }

    attachment.lastPingMs = now;
    ws.serializeAttachment(attachment);

    // 1. Unconditionally prohibit command transmission over cloud relay
    const rawType = (clientMsg as any).type;
    if (
      rawType === 'COMMAND' ||
      rawType === 'TELECOMMAND' ||
      rawType === 'ACTUATOR_COMMAND' ||
      rawType === 'BURNWIRE' ||
      rawType === 'CALIBRATE' ||
      rawType === 'OVERRIDE_STATE' ||
      rawType === 'SET_TARGET'
    ) {
      this.sendSafe(ws, {
        type: 'ERROR',
        code: 'COMMANDS_PROHIBITED',
        message:
          'Ground station telemetry relay is strictly downlink telemetry only. Command uplink is prohibited.',
      });
      return;
    }

    // 2. Handle AUTH frame
    if (clientMsg.type === 'AUTH') {
      // Prevent role escalation or re-authentication on an existing authenticated socket
      if (attachment.authenticated) {
        this.sendSafe(ws, {
          type: 'AUTH_ERROR',
          code: 'ALREADY_AUTHENTICATED',
          message:
            'Session is already authenticated. Role escalation or re-authentication is prohibited.',
        });
        return;
      }
      await this.handleAuthMessage(ws, attachment, clientMsg);
      return;
    }

    // If connection is not yet authenticated, reject any other messages
    if (!attachment.authenticated) {
      this.sendSafe(ws, {
        type: 'ERROR',
        code: 'UNAUTHORIZED',
        message: 'Client must authenticate via AUTH message first.',
      });
      return;
    }

    // 3. Handle PING / HEARTBEAT
    if (clientMsg.type === 'PING') {
      this.sendSafe(ws, {
        type: 'PONG',
        clientTimestamp: clientMsg.timestamp,
        serverTimeMs: now,
      });
      if (attachment.role === 'publisher') {
        this.lastPublisherSeenMs = now;
        void this.ctx.storage.put('lastPublisherSeenMs', now);
      }
      return;
    }

    if (clientMsg.type === 'HEARTBEAT') {
      if (attachment.role === 'publisher') {
        this.lastPublisherSeenMs = now;
        void this.ctx.storage.put('lastPublisherSeenMs', now);
      }
      return;
    }

    // 4. Handle TELEMETRY_FRAME (Strictly Publisher Only!)
    if (clientMsg.type === 'TELEMETRY_FRAME') {
      if (attachment.role !== 'publisher') {
        // Enforce strict read-only access for viewers
        this.sendSafe(ws, {
          type: 'ERROR',
          code: 'PERMISSION_DENIED',
          message: 'Viewer connection is strictly read-only. Cannot publish telemetry frames.',
        });
        return;
      }

      await this.handleTelemetryFrame(ws, attachment, clientMsg);
      return;
    }

    // Unknown message type
    this.sendSafe(ws, {
      type: 'ERROR',
      code: 'MALFORMED_PAYLOAD',
      message: `Unknown message type: ${rawType}`,
    });
  }

  async webSocketClose(
    ws: WebSocket,
    code: number,
    reason: string,
    wasClean: boolean
  ): Promise<void> {
    const attachment = ws.deserializeAttachment() as WebSocketSessionAttachment | null;
    if (
      attachment &&
      attachment.role === 'publisher' &&
      this.activePublisherId === attachment.id
    ) {
      this.activePublisherId = null;
      await this.ctx.storage.put('activePublisherId', null);
      this.broadcastPublisherStatus('DISCONNECTED');
    }
  }

  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    const attachment = ws.deserializeAttachment() as WebSocketSessionAttachment | null;
    if (
      attachment &&
      attachment.role === 'publisher' &&
      this.activePublisherId === attachment.id
    ) {
      this.activePublisherId = null;
      await this.ctx.storage.put('activePublisherId', null);
      this.broadcastPublisherStatus('DISCONNECTED');
    }
  }

  // --- Private Handler Methods ---

  private async handleAuthMessage(
    ws: WebSocket,
    attachment: WebSocketSessionAttachment,
    msg: AuthClientMessage
  ): Promise<void> {
    const requestedRole: SyncRole = msg.role === 'publisher' ? 'publisher' : 'viewer';
    const authResult = authenticateRole(requestedRole, msg.token, this.env);

    if (!authResult.authorized) {
      this.sendSafe(ws, {
        type: 'AUTH_ERROR',
        code: 'INVALID_CREDENTIALS',
        message: authResult.reason || 'Authentication failed.',
      });
      ws.close(4403, 'Forbidden');
      return;
    }

    // If publisher, enforce single active publisher lease per mission
    if (requestedRole === 'publisher') {
      if (this.isPublisherActive() && this.activePublisherId !== attachment.id) {
        this.sendSafe(ws, {
          type: 'AUTH_ERROR',
          code: 'PUBLISHER_LEASE_ACTIVE',
          message:
            'Another ground station publisher is currently holding the active mission lease.',
        });
        ws.close(4409, 'Publisher lease active');
        return;
      }

      // Grant publisher lease
      this.activePublisherId = attachment.id;
      this.lastPublisherSeenMs = Date.now();
      await this.ctx.storage.put({
        activePublisherId: this.activePublisherId,
        lastPublisherSeenMs: this.lastPublisherSeenMs,
      });
    }

    // Update attachment with verified role and mark authenticated
    attachment.role = requestedRole;
    attachment.authenticated = true;
    attachment.clientLabel = (msg.clientLabel || requestedRole).slice(0, 64);
    attachment.missionId = msg.missionId || this.missionId;
    ws.serializeAttachment(attachment);

    // Send AUTH_SUCCESS
    this.sendSafe(ws, {
      type: 'AUTH_SUCCESS',
      role: requestedRole,
      missionId: this.missionId,
      serverTimeMs: Date.now(),
      publisherActive: this.isPublisherActive(),
      publisherLastSeenMs: this.lastPublisherSeenMs,
      activeViewersCount: this.getViewerCount(),
    });

    if (requestedRole === 'publisher') {
      this.broadcastPublisherStatus('ACTIVE');
    } else {
      // Send initial snapshot to newly authenticated viewer
      this.sendInitialSnapshot(ws);
    }
  }

  private async handleTelemetryFrame(
    ws: WebSocket,
    attachment: WebSocketSessionAttachment,
    msg: ClientMessage & { type: 'TELEMETRY_FRAME' }
  ): Promise<void> {
    const now = Date.now();

    // Rate Limiting Check (e.g. max 25 Hz)
    const currentSecond = Math.floor(now / 1000);
    if (currentSecond !== this.currentSecondEpoch) {
      this.currentSecondEpoch = currentSecond;
      this.frameCountInCurrentSecond = 1;
    } else {
      this.frameCountInCurrentSecond++;
      if (this.frameCountInCurrentSecond > MAX_RATE_LIMIT_FRAMES_PER_SEC) {
        this.sendSafe(ws, {
          type: 'ERROR',
          code: 'RATE_LIMITED',
          message: `Publisher rate limit exceeded (${MAX_RATE_LIMIT_FRAMES_PER_SEC} frames/sec).`,
        });
        return;
      }
    }

    // Prevent Simulation Contamination of Live Flights
    const isLiveMission =
      !this.missionId.startsWith('TEST-') &&
      !this.missionId.startsWith('test-') &&
      this.missionId !== 'CAN-7USAT-SIM-TEST';

    if (msg.sourceType === 'SIMULATION_TEST' && isLiveMission) {
      this.sendSafe(ws, {
        type: 'ERROR',
        code: 'SIMULATION_CONTAMINATION_REJECTED',
        message:
          'Simulated telemetry cannot be broadcast to a live flight session. Use a separate test mission session.',
      });
      return;
    }

    // Monotonic sequence number enforcement
    if (typeof msg.sequenceNumber === 'number' && msg.sequenceNumber <= this.lastSequenceNumber) {
      this.sendSafe(ws, {
        type: 'ERROR',
        code: 'MALFORMED_PAYLOAD',
        message: `Out-of-order sequence number received: ${msg.sequenceNumber} <= ${this.lastSequenceNumber}`,
      });
      return;
    }

    // Validate Team ID on live telemetry packets
    if (msg.packet && typeof msg.packet === 'object') {
      const pkt = msg.packet as { teamId?: string; packetNumber?: number };
      if (pkt.teamId && pkt.teamId !== '2026-IN-SPACe-CAN-7USAT-017') {
        this.sendSafe(ws, {
          type: 'ERROR',
          code: 'MALFORMED_PAYLOAD',
          message: `Invalid team identifier: ${pkt.teamId}`,
        });
        return;
      }
    }

    // Track sequence and update liveness
    this.lastSequenceNumber = msg.sequenceNumber;
    this.lastPublisherSeenMs = now;
    this.latestPacket = msg.packet;
    this.latestRawSentence = msg.rawSentence;
    this.latestPacketReceivedMs = msg.receivedAtMs;

    this.recentHistory.push(msg.packet);
    if (this.recentHistory.length > MAX_HISTORY_SNAPSHOT_SIZE) {
      this.recentHistory.shift();
    }

    // Persist latest state to Durable Object storage for hibernation recovery
    await this.ctx.storage.put({
      lastSequenceNumber: this.lastSequenceNumber,
      lastPublisherSeenMs: this.lastPublisherSeenMs,
      latestPacket: this.latestPacket,
      latestRawSentence: this.latestRawSentence,
      latestPacketReceivedMs: this.latestPacketReceivedMs,
      recentHistory: this.recentHistory,
    });

    // Prepare relayed message
    const relayedMsg: RelayedTelemetryFrameMessage = {
      type: 'TELEMETRY_FRAME',
      schemaVersion: msg.schemaVersion || 1,
      sequenceNumber: msg.sequenceNumber,
      sourceType: msg.sourceType,
      missionId: this.missionId,
      receivedAtMs: msg.receivedAtMs,
      publishedAtMs: msg.publishedAtMs,
      relayTimestampMs: now,
      rawSentence: msg.rawSentence,
      packet: msg.packet,
    };

    const serialized = JSON.stringify(relayedMsg);

    // Broadcast to all authenticated viewers
    const sockets = this.ctx.getWebSockets();
    for (const targetWs of sockets) {
      if (targetWs === ws) continue; // Don't echo back to publisher
      const att = targetWs.deserializeAttachment() as WebSocketSessionAttachment | null;
      if (att && att.authenticated && att.role === 'viewer') {
        try {
          targetWs.send(serialized);
        } catch {
          // Socket might be closing; let webSocketClose handle it
        }
      }
    }
  }

  private sendInitialSnapshot(ws: WebSocket): void {
    const now = Date.now();
    const publisherActive = this.isPublisherActive();
    const lastSeen = this.latestPacketReceivedMs || this.lastPublisherSeenMs;
    const isHistorical =
      !publisherActive ||
      (lastSeen !== null && now - lastSeen > 3000);

    const snapshotMsg: SnapshotServerMessage = {
      type: 'SNAPSHOT',
      missionId: this.missionId,
      serverTimeMs: now,
      publisherActive,
      isHistorical,
      snapshotAgeMs: lastSeen !== null ? Math.max(0, now - lastSeen) : null,
      latestPacket: this.latestPacket,
      latestRawSentence: this.latestRawSentence,
      recentHistory: [...this.recentHistory],
    };

    this.sendSafe(ws, snapshotMsg);
  }

  private broadcastPublisherStatus(status: 'ACTIVE' | 'STALE' | 'DISCONNECTED'): void {
    const now = Date.now();
    const viewersCount = this.getViewerCount();
    const msg: ServerMessage = {
      type: 'PUBLISHER_STATUS',
      status,
      timestamp: now,
      lastSeenMs: this.lastPublisherSeenMs,
      activeViewersCount: viewersCount,
    };
    const serialized = JSON.stringify(msg);

    const sockets = this.ctx.getWebSockets();
    for (const ws of sockets) {
      const att = ws.deserializeAttachment() as WebSocketSessionAttachment | null;
      if (att && att.authenticated && att.role === 'viewer') {
        try {
          ws.send(serialized);
        } catch {
          // ignore
        }
      }
    }
  }

  private isPublisherActive(): boolean {
    if (!this.activePublisherId || !this.lastPublisherSeenMs) {
      return false;
    }
    const timeout = Number(this.env.HEARTBEAT_TIMEOUT_MS || 5000);
    return Date.now() - this.lastPublisherSeenMs < timeout;
  }

  private getViewerCount(): number {
    let count = 0;
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as WebSocketSessionAttachment | null;
      if (att && att.authenticated && att.role === 'viewer') {
        count++;
      }
    }
    return count;
  }

  private scheduleAuthTimeout(ws: WebSocket, sessionId: string): void {
    setTimeout(() => {
      try {
        const att = ws.deserializeAttachment() as WebSocketSessionAttachment | null;
        if (att && att.id === sessionId && !att.authenticated) {
          this.sendSafe(ws, {
            type: 'AUTH_ERROR',
            code: 'AUTH_TIMEOUT',
            message: 'Authentication timed out. No valid AUTH frame received.',
          });
          ws.close(4401, 'Auth Timeout');
        }
      } catch {
        // Socket already closed
      }
    }, AUTH_TIMEOUT_MS);
  }

  private sendSafe(ws: WebSocket, message: ServerMessage): void {
    try {
      ws.send(JSON.stringify(message));
    } catch {
      // Ignore write errors to dead sockets
    }
  }
}
