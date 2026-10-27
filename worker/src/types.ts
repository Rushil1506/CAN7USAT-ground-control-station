/**
 * CAN-7USAT Ground Control Station
 * Secure Real-Time Telemetry Synchronization Protocol Types
 * (Version 1.0.0)
 */

export type SyncRole = 'publisher' | 'viewer';

export type SyncSourceType = 'LIVE_SERIAL' | 'SIMULATION_TEST';

export interface AuthClientMessage {
  type: 'AUTH';
  role: SyncRole;
  missionId: string;
  token?: string;
  clientLabel?: string;
}

export interface TelemetryFrameMessage {
  type: 'TELEMETRY_FRAME';
  schemaVersion: number;
  sequenceNumber: number;
  sourceType: SyncSourceType;
  missionId: string;
  receivedAtMs: number;
  publishedAtMs: number;
  rawSentence: string;
  packet: Record<string, unknown>;
}

export interface PingMessage {
  type: 'PING';
  timestamp: number;
}

export interface HeartbeatMessage {
  type: 'HEARTBEAT';
  timestamp: number;
}

export type ClientMessage =
  | AuthClientMessage
  | TelemetryFrameMessage
  | PingMessage
  | HeartbeatMessage;

export interface AuthSuccessServerMessage {
  type: 'AUTH_SUCCESS';
  role: SyncRole;
  missionId: string;
  serverTimeMs: number;
  publisherActive: boolean;
  publisherLastSeenMs: number | null;
  activeViewersCount: number;
}

export interface AuthErrorServerMessage {
  type: 'AUTH_ERROR';
  code:
    | 'INVALID_CREDENTIALS'
    | 'AUTH_TIMEOUT'
    | 'PUBLISHER_LEASE_ACTIVE'
    | 'SESSION_CLOSED'
    | 'MALFORMED_AUTH'
    | 'ALREADY_AUTHENTICATED'
    | 'MISSING_SECRET_CONFIG';
  message: string;
}

export interface SnapshotServerMessage {
  type: 'SNAPSHOT';
  missionId: string;
  serverTimeMs: number;
  publisherActive: boolean;
  isHistorical: boolean;
  snapshotAgeMs: number | null;
  latestPacket: Record<string, unknown> | null;
  latestRawSentence: string | null;
  recentHistory: Record<string, unknown>[];
}

export interface RelayedTelemetryFrameMessage extends TelemetryFrameMessage {
  relayTimestampMs: number;
}

export interface PublisherStatusServerMessage {
  type: 'PUBLISHER_STATUS';
  status: 'ACTIVE' | 'STALE' | 'DISCONNECTED';
  timestamp: number;
  lastSeenMs: number | null;
  activeViewersCount: number;
}

export interface PongServerMessage {
  type: 'PONG';
  clientTimestamp: number;
  serverTimeMs: number;
}

export interface ErrorServerMessage {
  type: 'ERROR';
  code:
    | 'PERMISSION_DENIED'
    | 'PAYLOAD_TOO_LARGE'
    | 'RATE_LIMITED'
    | 'MALFORMED_PAYLOAD'
    | 'SIMULATION_CONTAMINATION_REJECTED'
    | 'UNAUTHORIZED'
    | 'ALREADY_AUTHENTICATED'
    | 'COMMANDS_PROHIBITED';
  message: string;
}

export type ServerMessage =
  | AuthSuccessServerMessage
  | AuthErrorServerMessage
  | SnapshotServerMessage
  | RelayedTelemetryFrameMessage
  | PublisherStatusServerMessage
  | PongServerMessage
  | ErrorServerMessage;

export interface WebSocketSessionAttachment {
  id: string;
  role: SyncRole;
  missionId: string;
  authenticated: boolean;
  clientLabel: string;
  connectedAtMs: number;
  authDeadlineMs: number;
  lastPingMs: number;
}

export interface TelemetryWorkerEnv {
  TELEMETRY_RELAY_DO: any;
  PUBLISHER_SECRET_KEY?: string;
  VIEWER_SECRET_KEY?: string;
  ALLOWED_ORIGINS?: string;
  MAX_PAYLOAD_BYTES?: number | string;
  HEARTBEAT_TIMEOUT_MS?: number | string;
  DEFAULT_MISSION_ID?: string;
}
