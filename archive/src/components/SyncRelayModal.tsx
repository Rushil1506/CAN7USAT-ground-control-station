import React, { useState, useEffect } from 'react';
import {
  Cloud,
  Radio,
  Eye,
  Lock,
  CheckCircle2,
  AlertTriangle,
  X,
  RefreshCw,
  Server,
  Activity,
  ShieldCheck,
  Wifi,
  WifiOff,
} from 'lucide-react';
import {
  globalTelemetrySync,
  SyncConnectionState,
  SyncMetrics,
  DEFAULT_RELAY_ENDPOINT,
} from '../services/telemetrySyncService';
import { TelemetrySource } from '../types';

interface SyncRelayModalProps {
  isOpen: boolean;
  onClose: () => void;
  telemetrySource: TelemetrySource;
  onSelectSource: (source: TelemetrySource) => void;
}

export const SyncRelayModal: React.FC<SyncRelayModalProps> = ({
  isOpen,
  onClose,
  telemetrySource,
  onSelectSource,
}) => {
  const [role, setRole] = useState<'publisher' | 'viewer'>(
    telemetrySource === 'REMOTE_VIEWER' ? 'viewer' : 'publisher'
  );
  const [endpoint, setEndpoint] = useState<string>(DEFAULT_RELAY_ENDPOINT);
  const [missionId, setMissionId] = useState<string>('CAN-7USAT-017');
  const [isTestSession, setIsTestSession] = useState<boolean>(
    telemetrySource === 'SIMULATION'
  );
  const [publisherKey, setPublisherKey] = useState<string>('');
  const [viewerPasscode, setViewerPasscode] = useState<string>('');
  const [clientLabel, setClientLabel] = useState<string>('');

  const [syncState, setSyncState] = useState<SyncConnectionState>(
    globalTelemetrySync.getState()
  );
  const [metrics, setMetrics] = useState<SyncMetrics>(
    globalTelemetrySync.getMetrics()
  );
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = globalTelemetrySync.subscribe({
      onStatusChange: (state, nextMetrics, msg) => {
        setSyncState(state);
        setMetrics(nextMetrics);
        if (msg) setStatusMessage(msg);
      },
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (telemetrySource === 'REMOTE_VIEWER') {
      setRole('viewer');
    }
  }, [telemetrySource]);

  if (!isOpen) return null;

  const isConnected = syncState === 'CONNECTED';
  const isConnecting = syncState === 'CONNECTING' || syncState === 'RECONNECTING';

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatusMessage(null);

    const activeMissionId = isTestSession
      ? missionId.startsWith('TEST-') || missionId === 'CAN-7USAT-SIM-TEST'
        ? missionId
        : `TEST-${missionId}`
      : missionId;

    if (role === 'publisher') {
      if (!publisherKey.trim()) {
        setStatusMessage('Publisher Secret Key is required to authorize ground-station publishing.');
        return;
      }
      await globalTelemetrySync.startPublisher(
        endpoint.trim(),
        activeMissionId.trim(),
        publisherKey.trim(),
        clientLabel.trim() || 'GroundStation-Primary',
        isTestSession
      );
    } else {
      if (!viewerPasscode.trim()) {
        setStatusMessage('Viewer Passcode is required to authorize spectator viewing.');
        return;
      }
      await globalTelemetrySync.startViewer(
        endpoint.trim(),
        activeMissionId.trim(),
        viewerPasscode.trim(),
        clientLabel.trim() || 'RemoteViewer-Field'
      );
      // Automatically switch UI to REMOTE_VIEWER mode
      onSelectSource('REMOTE_VIEWER');
    }
  };

  const handleDisconnect = () => {
    globalTelemetrySync.disconnect();
    setStatusMessage('Disconnected from relay.');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-sm animate-fade-in">
      <div className="bg-[var(--bg-surface-1)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] w-full max-w-xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden font-sans">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-surface-2)]">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-[var(--radius-sm)] bg-[var(--accent-cobalt-soft)] text-[var(--accent-cobalt)]">
              <Cloud className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
                Real-Time Telemetry Synchronization
                <span className="text-[10px] font-mono-data px-1.5 py-0.5 rounded bg-[var(--bg-base)] text-[var(--text-secondary)] border border-[var(--border-subtle)]">
                  Cloudflare Relay
                </span>
              </h2>
              <p className="text-[11px] text-[var(--text-tertiary)]">
                Secure multi-device flight telemetry broadcast & read-only spectator view
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] p-1 rounded hover:bg-[var(--bg-surface-elevated)] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 overflow-y-auto space-y-4 text-xs">
          {/* Connection Status Banner */}
          <div
            className={`p-3 rounded-[var(--radius-md)] border flex items-center justify-between ${
              isConnected
                ? 'bg-[var(--status-nominal-bg)] border-[var(--status-nominal)]/30 text-[var(--status-nominal)]'
                : isConnecting
                ? 'bg-[var(--status-info-bg)] border-[var(--accent-cobalt)]/30 text-[var(--accent-cobalt)]'
                : syncState === 'AUTH_FAILED'
                ? 'bg-[var(--status-alert-bg)] border-[var(--status-alert)]/30 text-[var(--status-alert)]'
                : 'bg-[var(--bg-surface-2)] border-[var(--border-subtle)] text-[var(--text-secondary)]'
            }`}
          >
            <div className="flex items-center gap-2.5">
              {isConnected ? (
                <Wifi className="w-4 h-4 animate-pulse" />
              ) : isConnecting ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <WifiOff className="w-4 h-4" />
              )}
              <div>
                <div className="font-semibold font-mono-data uppercase">
                  {syncState}
                  {isConnected && ` • ROLE: ${metrics.role.toUpperCase()}`}
                </div>
                {statusMessage && (
                  <div className="text-[11px] opacity-80 mt-0.5 max-w-sm truncate">
                    {statusMessage}
                  </div>
                )}
              </div>
            </div>

            {isConnected && (
              <button
                type="button"
                onClick={handleDisconnect}
                className="px-2.5 py-1 text-[11px] font-mono-data font-semibold bg-[var(--status-alert-bg)] text-[var(--status-alert)] border border-[var(--status-alert)]/40 rounded hover:bg-[var(--status-alert)] hover:text-white transition-colors"
              >
                DISCONNECT
              </button>
            )}
          </div>

          {/* Role Selector Tabs */}
          {!isConnected && (
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-[var(--text-secondary)] uppercase">
                Operation Mode
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setRole('publisher')}
                  className={`p-2.5 rounded-[var(--radius-md)] border text-left flex items-start gap-2.5 transition-all ${
                    role === 'publisher'
                      ? 'bg-[var(--accent-teal)]/10 border-[var(--accent-teal)] text-[var(--text-primary)]'
                      : 'bg-[var(--bg-surface-2)] border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-surface-elevated)]'
                  }`}
                >
                  <Radio className={`w-4 h-4 mt-0.5 ${role === 'publisher' ? 'text-[var(--accent-teal)]' : ''}`} />
                  <div>
                    <div className="font-bold text-xs">Ground Station Publisher</div>
                    <div className="text-[10px] text-[var(--text-tertiary)] mt-0.5">
                      Stream verified LoRa telemetry to the cloud (Requires Publisher Secret)
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setRole('viewer')}
                  className={`p-2.5 rounded-[var(--radius-md)] border text-left flex items-start gap-2.5 transition-all ${
                    role === 'viewer'
                      ? 'bg-[var(--accent-cobalt-soft)] border-[var(--accent-cobalt)] text-[var(--text-primary)]'
                      : 'bg-[var(--bg-surface-2)] border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-surface-elevated)]'
                  }`}
                >
                  <Eye className={`w-4 h-4 mt-0.5 ${role === 'viewer' ? 'text-[var(--accent-cobalt)]' : ''}`} />
                  <div>
                    <div className="font-bold text-xs">Remote Spectator Viewer</div>
                    <div className="text-[10px] text-[var(--text-tertiary)] mt-0.5">
                      Receive live telemetry on mobile/tablet (Strictly Read-Only)
                    </div>
                  </div>
                </button>
              </div>
            </div>
          )}

          {/* Form Settings */}
          {!isConnected ? (
            <form onSubmit={handleConnect} className="space-y-3 pt-1">
              {/* Relay Server Endpoint */}
              <div>
                <label className="block text-[11px] font-medium text-[var(--text-secondary)] mb-1">
                  Cloudflare Relay Endpoint (WebSocket)
                </label>
                <div className="relative">
                  <Server className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-[var(--text-tertiary)]" />
                  <input
                    type="text"
                    value={endpoint}
                    onChange={(e) => setEndpoint(e.target.value)}
                    required
                    placeholder="wss://... or ws://localhost:8787/api/v1/telemetry/ws"
                    className="w-full pl-8 pr-2.5 py-1.5 bg-[var(--bg-base)] border border-[var(--border-subtle)] focus:border-[var(--accent-cobalt)] rounded text-xs font-mono-data text-[var(--text-primary)] outline-none"
                  />
                </div>
              </div>

              {/* Mission ID & Test Session */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-medium text-[var(--text-secondary)] mb-1">
                    Mission Session ID
                  </label>
                  <input
                    type="text"
                    value={missionId}
                    onChange={(e) => setMissionId(e.target.value)}
                    required
                    className="w-full px-2.5 py-1.5 bg-[var(--bg-base)] border border-[var(--border-subtle)] focus:border-[var(--accent-cobalt)] rounded text-xs font-mono-data text-[var(--text-primary)] outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-[var(--text-secondary)] mb-1">
                    Device / Operator Label
                  </label>
                  <input
                    type="text"
                    value={clientLabel}
                    onChange={(e) => setClientLabel(e.target.value)}
                    placeholder={role === 'publisher' ? 'Primary-Laptop-T41' : 'FieldPhone-01'}
                    className="w-full px-2.5 py-1.5 bg-[var(--bg-base)] border border-[var(--border-subtle)] focus:border-[var(--accent-cobalt)] rounded text-xs text-[var(--text-primary)] outline-none"
                  />
                </div>
              </div>

              {/* Test Session Notice for Simulation */}
              {telemetrySource === 'SIMULATION' && (
                <div className="flex items-center gap-2 p-2 rounded bg-[var(--status-info-bg)] border border-[var(--accent-cobalt)]/20 text-[11px] text-[var(--accent-cobalt)]">
                  <input
                    type="checkbox"
                    id="testSessionCheck"
                    checked={isTestSession}
                    onChange={(e) => setIsTestSession(e.target.checked)}
                    className="rounded text-[var(--accent-cobalt)]"
                  />
                  <label htmlFor="testSessionCheck" className="cursor-pointer">
                    Publish to isolated test session (Prevents simulation contamination of live missions)
                  </label>
                </div>
              )}

              {/* Authentication Credentials */}
              {role === 'publisher' ? (
                <div>
                  <label className="block text-[11px] font-medium text-[var(--text-secondary)] mb-1">
                    Publisher Authorization Secret Key
                  </label>
                  <div className="relative">
                    <Lock className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-[var(--text-tertiary)]" />
                    <input
                      type="password"
                      value={publisherKey}
                      onChange={(e) => setPublisherKey(e.target.value)}
                      required
                      placeholder="Enter server-configured PUBLISHER_SECRET_KEY"
                      className="w-full pl-8 pr-2.5 py-1.5 bg-[var(--bg-base)] border border-[var(--border-subtle)] focus:border-[var(--accent-teal)] rounded text-xs font-mono-data text-[var(--text-primary)] outline-none"
                    />
                  </div>
                  <p className="text-[10px] text-[var(--text-tertiary)] mt-1 flex items-center gap-1">
                    <ShieldCheck className="w-3 h-3 text-[var(--status-nominal)] shrink-0" />
                    Key is held in volatile memory only for this session. It is never written to disk or localStorage.
                  </p>
                </div>
              ) : (
                <div>
                  <label className="block text-[11px] font-medium text-[var(--text-secondary)] mb-1">
                    Viewer Authorization Passcode (Mandatory)
                  </label>
                  <div className="relative">
                    <Lock className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-[var(--text-tertiary)]" />
                    <input
                      type="password"
                      value={viewerPasscode}
                      onChange={(e) => setViewerPasscode(e.target.value)}
                      required
                      placeholder="Enter server-configured VIEWER_SECRET_KEY"
                      className="w-full pl-8 pr-2.5 py-1.5 bg-[var(--bg-base)] border border-[var(--border-subtle)] focus:border-[var(--accent-cobalt)] rounded text-xs font-mono-data text-[var(--text-primary)] outline-none"
                    />
                  </div>
                  <p className="text-[10px] text-[var(--text-tertiary)] mt-1 flex items-center gap-1">
                    <ShieldCheck className="w-3 h-3 text-[var(--status-nominal)] shrink-0" />
                    Mandatory spectator passcode. Held in volatile memory only; never stored in localStorage.
                  </p>
                </div>
              )}

              {/* Submit Button */}
              <div className="pt-2">
                <button
                  type="submit"
                  disabled={isConnecting}
                  className={`w-full py-2 px-4 rounded-[var(--radius-md)] text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer transition-colors shadow-[var(--shadow-xs)] ${
                    role === 'publisher'
                      ? 'bg-[var(--accent-teal)] text-white hover:bg-[var(--accent-teal)]/90'
                      : 'bg-[var(--accent-cobalt)] text-white hover:bg-[var(--accent-cobalt)]/90'
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  {isConnecting ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Connecting...</span>
                    </>
                  ) : (
                    <>
                      {role === 'publisher' ? <Radio className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      <span>{role === 'publisher' ? 'Authorize & Start Publishing' : 'Connect as Remote Viewer'}</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          ) : (
            /* Connected Metrics Panel */
            <div className="space-y-3 bg-[var(--bg-surface-2)] p-3 rounded-[var(--radius-md)] border border-[var(--border-subtle)] font-mono-data text-[11px]">
              <div className="font-semibold text-xs text-[var(--text-primary)] font-sans flex items-center gap-1.5">
                <Activity className="w-4 h-4 text-[var(--status-nominal)]" />
                Live Synchronized Session Metrics
              </div>

              <div className="grid grid-cols-2 gap-2 text-[10px]">
                <div className="p-2 bg-[var(--bg-base)] rounded border border-[var(--border-subtle)]">
                  <div className="text-[var(--text-tertiary)] uppercase">Mission Session</div>
                  <div className="font-bold text-xs text-[var(--text-primary)] truncate mt-0.5">
                    {metrics.missionId}
                  </div>
                </div>

                <div className="p-2 bg-[var(--bg-base)] rounded border border-[var(--border-subtle)]">
                  <div className="text-[var(--text-tertiary)] uppercase">Round-Trip Latency</div>
                  <div className="font-bold text-xs text-[var(--accent-cobalt)] mt-0.5">
                    {metrics.rttMs > 0 ? `${metrics.rttMs} ms` : '< 10 ms'}
                  </div>
                </div>

                <div className="p-2 bg-[var(--bg-base)] rounded border border-[var(--border-subtle)]">
                  <div className="text-[var(--text-tertiary)] uppercase">
                    {metrics.role === 'publisher' ? 'Packets Published' : 'Packets Received'}
                  </div>
                  <div className="font-bold text-xs text-[var(--text-primary)] mt-0.5">
                    {metrics.role === 'publisher' ? metrics.packetsSent : metrics.packetsReceived}
                  </div>
                </div>

                <div className="p-2 bg-[var(--bg-base)] rounded border border-[var(--border-subtle)]">
                  <div className="text-[var(--text-tertiary)] uppercase">Ground Station Publisher</div>
                  <div className="font-bold text-xs mt-0.5 flex items-center gap-1.5">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        metrics.publisherActive ? 'bg-[var(--status-nominal)] animate-pulse' : 'bg-[var(--status-alert)]'
                      }`}
                    />
                    <span className={metrics.publisherActive ? 'text-[var(--status-nominal)]' : 'text-[var(--status-alert)]'}>
                      {metrics.publisherActive ? 'ACTIVE' : 'OFFLINE'}
                    </span>
                  </div>
                </div>
              </div>

              {metrics.role === 'viewer' && (
                <div className="p-2 bg-[var(--bg-surface-elevated)] rounded border border-[var(--border-subtle)] text-[10px] text-[var(--text-secondary)] font-sans">
                  <strong>Read-Only Mode:</strong> This device is acting as a remote spectator. Telecommands, hardware calibration, actuator triggers, and flight configurations are locked.
                </div>
              )}
            </div>
          )}

          {/* Security & Architecture Disclaimers */}
          <div className="pt-2 border-t border-[var(--border-subtle)] text-[10px] text-[var(--text-tertiary)] space-y-1">
            <div className="flex items-center gap-1 font-semibold text-[var(--text-secondary)]">
              <ShieldCheck className="w-3 h-3 text-[var(--status-nominal)]" />
              Security Architecture & Safe Isolation
            </div>
            <p>
              • Single active publisher lease enforced per mission session by Cloudflare Durable Object.
            </p>
            <p>
              • Viewers cannot transmit commands, affect hardware serial connections, or publish telemetry frames.
            </p>
            <p>
              • Disconnection or network loss automatically displays STALE without silently falling back to simulated data.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
