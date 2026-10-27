import { SerialConnectionState, SerialMetrics, TelemetryPacket } from '../types';
import {
  DEFAULT_MAX_LINE_LENGTH,
  FirmwareControlMessage,
  parseFirmwareControlLine,
  parseTelemetryLine,
  SerialLineBuffer,
} from './telemetryParser';

// Minimal Web Serial API type declarations for TypeScript environments without @types/w3c-web-serial
interface SerialPortInfo {
  usbVendorId?: number;
  usbProductId?: number;
}

interface SerialOptions {
  baudRate: number;
  dataBits?: number;
  stopBits?: number;
  parity?: 'none' | 'even' | 'odd';
  bufferSize?: number;
  flowControl?: 'none' | 'hardware';
}

interface WebSerialPort {
  readonly readable: ReadableStream<Uint8Array> | null;
  getInfo(): SerialPortInfo;
  open(options: SerialOptions): Promise<void>;
  close(): Promise<void>;
  addEventListener?(type: string, listener: (ev: Event) => void): void;
  removeEventListener?(type: string, listener: (ev: Event) => void): void;
}

interface WebSerialNavigator {
  requestPort(): Promise<WebSerialPort>;
  addEventListener?(type: string, listener: (ev: Event) => void): void;
  removeEventListener?(type: string, listener: (ev: Event) => void): void;
}

export interface SerialTelemetryCallbacks {
  onPacket: (packet: TelemetryPacket, rawLine: string) => void;
  onMalformedLine: (rawLine: string, reason: string) => void;
  onStatusChange: (state: SerialConnectionState, metrics: SerialMetrics, message?: string) => void;
  onControlMessage?: (control: FirmwareControlMessage, rawLine: string) => void;
}

function getWebSerial(): WebSerialNavigator | null {
  if (typeof navigator === 'undefined') return null;
  const nav = navigator as unknown as { serial?: WebSerialNavigator };
  if (nav.serial && typeof nav.serial.requestPort === 'function') {
    return nav.serial;
  }
  return null;
}

export function isWebSerialSupported(): boolean {
  return getWebSerial() !== null;
}

export interface WebSerialSupportDescriptor {
  supported: boolean;
  isMobileBrowser: boolean;
  statusSummary: string;
  guidanceMessage: string;
}

export function describeWebSerialSupport(
  userAgent: string = typeof navigator !== 'undefined' ? navigator.userAgent : '',
  supported: boolean = isWebSerialSupported()
): WebSerialSupportDescriptor {
  const isMobileBrowser = /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent);
  if (supported) {
    return {
      supported: true,
      isMobileBrowser,
      statusSummary: 'WEB SERIAL API SUPPORTED',
      guidanceMessage:
        'Browser supports Web Serial USB connections (115200 8N1 receive-only). Note: Web Serial reads from a USB receiver plugged directly into this client device.',
    };
  }
  if (isMobileBrowser) {
    return {
      supported: false,
      isMobileBrowser: true,
      statusSummary: 'MOBILE BROWSER — WEB SERIAL UNSUPPORTED',
      guidanceMessage:
        'Web Serial API is not supported on this mobile browser. Direct USB serial hardware links require desktop Chromium (Chrome/Edge) with the LoRa receiver plugged into your machine. Cloud web hosting serves the GCS application, but does not provide remote live telemetry without a separate cloud relay. Local simulation and offline map tools remain fully available.',
    };
  }
  return {
    supported: false,
    isMobileBrowser: false,
    statusSummary: 'WEB SERIAL API UNSUPPORTED',
    guidanceMessage:
      'Web Serial API is not supported in this browser. Use Chromium-based Chrome or Edge over localhost or HTTPS with your USB LoRa receiver attached. Note: Web hosting does not provide remote live telemetry without a separate cloud relay.',
  };
}

function formatPortLabel(port: WebSerialPort): string {
  try {
    const info = port.getInfo();
    if (typeof info.usbVendorId === 'number' && typeof info.usbProductId === 'number') {
      const vid = info.usbVendorId.toString(16).toUpperCase().padStart(4, '0');
      const pid = info.usbProductId.toString(16).toUpperCase().padStart(4, '0');
      const isArduino = info.usbVendorId === 0x2341 || info.usbVendorId === 0x1a86 || info.usbVendorId === 0x10c4;
      return isArduino ? `USB Serial (VID:${vid} PID:${pid})` : `USB Port (VID:${vid} PID:${pid})`;
    }
  } catch {
    // ignore getInfo errors
  }
  return 'USB Serial Port';
}

export class SerialTelemetryService {
  private port: WebSerialPort | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private state: SerialConnectionState = isWebSerialSupported() ? 'DISCONNECTED' : 'UNSUPPORTED';
  private disconnecting: boolean = false;
  private lineBuffer: SerialLineBuffer = new SerialLineBuffer(DEFAULT_MAX_LINE_LENGTH);
  private listeners: Set<SerialTelemetryCallbacks> = new Set();

  private metrics: SerialMetrics = {
    rawBytesReceived: 0,
    completeLinesReceived: 0,
    validPacketsReceived: 0,
    malformedPacketsReceived: 0,
    connectionErrors: 0,
    lastValidPacketTimeMs: null,
    lastValidPacketRxTime: null,
    lastValidPacketUtc: null,
    lastValidPacketIst: null,
    lastError: isWebSerialSupported()
      ? null
      : describeWebSerialSupport().guidanceMessage,
    portLabel: null,
  };

  private readonly handleHardwareDisconnect = (event: Event) => {
    const targetPort = (event as unknown as { target?: WebSerialPort }).target;
    if (this.port && (!targetPort || targetPort === this.port)) {
      this.metrics.connectionErrors++;
      this.metrics.lastError = 'USB serial device physically disconnected.';
      void this.cleanupPort('ERROR', 'USB serial device physically disconnected.');
    }
  };

  public subscribe(callbacks: SerialTelemetryCallbacks): () => void {
    this.listeners.add(callbacks);
    callbacks.onStatusChange(this.state, { ...this.metrics });
    return () => {
      this.listeners.delete(callbacks);
    };
  }

  public getState(): SerialConnectionState {
    return this.state;
  }

  public getMetrics(): SerialMetrics {
    return { ...this.metrics };
  }

  public resetCounters(): void {
    this.metrics = {
      ...this.metrics,
      rawBytesReceived: 0,
      completeLinesReceived: 0,
      validPacketsReceived: 0,
      malformedPacketsReceived: 0,
      connectionErrors: 0,
      lastValidPacketTimeMs: null,
      lastValidPacketRxTime: null,
      lastValidPacketUtc: null,
      lastValidPacketIst: null,
      lastError: null,
    };
    this.notifyStatus();
  }

  /**
   * Opens a serial port via a user gesture (navigator.serial.requestPort).
   * Strictly receive-only: never opens or writes to port.writable.
   */
  public async connect(baudRate: number = 115200): Promise<boolean> {
    const serial = getWebSerial();
    if (!serial) {
      this.state = 'UNSUPPORTED';
      this.metrics.lastError = describeWebSerialSupport().guidanceMessage;
      this.notifyStatus(this.metrics.lastError);
      return false;
    }

    // Prevent duplicate connection attempts
    if (this.state === 'CONNECTING' || this.state === 'CONNECTED') {
      return this.state === 'CONNECTED';
    }

    this.disconnecting = false;
    this.state = 'CONNECTING';
    this.metrics.lastError = null;
    this.notifyStatus(`Requesting USB serial port permission (@ ${baudRate} baud)...`);

    let selectedPort: WebSerialPort | null = null;
    try {
      selectedPort = await serial.requestPort();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isUserCancel =
        msg.toLowerCase().includes('no port selected') ||
        msg.toLowerCase().includes('aborted') ||
        (err instanceof DOMException && err.name === 'NotFoundError');

      this.state = 'DISCONNECTED';
      if (!isUserCancel) {
        this.metrics.connectionErrors++;
        this.metrics.lastError = `Serial port selection failed: ${msg}`;
        this.notifyStatus(this.metrics.lastError);
      } else {
        this.notifyStatus('Serial port selection cancelled by operator.');
      }
      return false;
    }

    try {
      await selectedPort.open({
        baudRate,
        dataBits: 8,
        stopBits: 1,
        parity: 'none',
        flowControl: 'none',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.metrics.connectionErrors++;
      this.metrics.lastError = `Failed to open serial port at ${baudRate} baud (close Arduino Serial Monitor if open): ${msg}`;
      this.state = 'ERROR';
      this.notifyStatus(this.metrics.lastError);
      return false;
    }

    this.port = selectedPort;
    this.metrics.portLabel = formatPortLabel(selectedPort);
    this.lineBuffer.reset();
    this.state = 'CONNECTED';
    this.metrics.lastError = null;

    if (typeof serial.addEventListener === 'function') {
      serial.addEventListener('disconnect', this.handleHardwareDisconnect);
    }

    this.notifyStatus(`Connected to ${this.metrics.portLabel} @ ${baudRate} 8N1 (receive-only).`);
    void this.readLoop();
    return true;
  }

  public async disconnect(): Promise<void> {
    if (this.state === 'DISCONNECTED' || this.state === 'UNSUPPORTED') {
      return;
    }
    this.disconnecting = true;
    await this.cleanupPort('DISCONNECTED', 'Serial port disconnected by operator.');
  }

  private async readLoop(): Promise<void> {
    if (!this.port || !this.port.readable) {
      this.metrics.connectionErrors++;
      this.metrics.lastError = 'Serial port readable stream is unavailable.';
      await this.cleanupPort('ERROR', this.metrics.lastError);
      return;
    }

    const decoder = new TextDecoder('utf-8', { fatal: false });

    try {
      this.reader = this.port.readable.getReader();

      while (!this.disconnecting && this.port) {
        const { value, done } = await this.reader.read();
        if (done) {
          break;
        }
        if (value && value.byteLength > 0) {
          this.metrics.rawBytesReceived += value.byteLength;
          const decodedChunk = decoder.decode(value, { stream: true });
          this.processDecodedChunk(decodedChunk);
        }
      }

      // Flush remaining multi-byte decoder state on stream end
      const finalChunk = decoder.decode();
      if (finalChunk.length > 0) {
        this.processDecodedChunk(finalChunk);
      }
    } catch (err) {
      if (!this.disconnecting) {
        const msg = err instanceof Error ? err.message : String(err);
        this.metrics.connectionErrors++;
        this.metrics.lastError = `Serial stream read error: ${msg}`;
        await this.cleanupPort('ERROR', this.metrics.lastError);
        return;
      }
    }

    if (!this.disconnecting && this.state === 'CONNECTED') {
      await this.cleanupPort('DISCONNECTED', 'Serial stream closed.');
    }
  }

  private processDecodedChunk(chunk: string): void {
    const { lines, overflowDiscardedCount } = this.lineBuffer.pushChunk(chunk);

    if (overflowDiscardedCount > 0) {
      this.metrics.completeLinesReceived += overflowDiscardedCount;
      this.metrics.malformedPacketsReceived += overflowDiscardedCount;
      for (let i = 0; i < overflowDiscardedCount; i++) {
        this.notifyMalformed(
          '[OVERFLOW_FRAME_DISCARDED]',
          `Line exceeded max length of ${DEFAULT_MAX_LINE_LENGTH} bytes`
        );
      }
    }

    for (const rawLine of lines) {
      this.metrics.completeLinesReceived++;
      const parsed = parseTelemetryLine(rawLine, Date.now());
      if (parsed.ok) {
        this.metrics.validPacketsReceived++;
        this.metrics.lastValidPacketTimeMs = parsed.packet.receivedAtMs ?? Date.now();
        this.metrics.lastValidPacketRxTime = parsed.packet.receivedAtTimeStr ?? null;
        this.metrics.lastValidPacketUtc = parsed.packet.timestampUtc;
        this.metrics.lastValidPacketIst = parsed.packet.gnssTimeIst ?? null;
        this.notifyPacket(parsed.packet, parsed.rawLine);
      } else {
        const controlMsg = parseFirmwareControlLine(rawLine);
        if (controlMsg) {
          this.notifyControlMessage(controlMsg, controlMsg.rawLine);
        } else {
          this.metrics.malformedPacketsReceived++;
          this.notifyMalformed(parsed.rawLine || rawLine, parsed.error);
        }
      }
    }

    if (lines.length > 0 || overflowDiscardedCount > 0) {
      this.notifyStatus();
    }
  }

  private async cleanupPort(nextState: SerialConnectionState, statusMessage?: string): Promise<void> {
    const serial = getWebSerial();
    if (serial && typeof serial.removeEventListener === 'function') {
      try {
        serial.removeEventListener('disconnect', this.handleHardwareDisconnect);
      } catch {
        // ignore
      }
    }

    if (this.reader) {
      const currentReader = this.reader;
      this.reader = null;
      try {
        await currentReader.cancel();
      } catch {
        // ignore cancel error during teardown
      }
      try {
        currentReader.releaseLock();
      } catch {
        // ignore releaseLock error
      }
    }

    if (this.port) {
      const currentPort = this.port;
      this.port = null;
      try {
        await currentPort.close();
      } catch {
        // ignore close error if port was already unplugged
      }
    }

    this.lineBuffer.reset();
    this.state = nextState;
    this.disconnecting = false;
    this.notifyStatus(statusMessage);
  }

  private notifyPacket(packet: TelemetryPacket, rawLine: string): void {
    this.listeners.forEach((l) => l.onPacket(packet, rawLine));
  }

  private notifyControlMessage(control: FirmwareControlMessage, rawLine: string): void {
    this.listeners.forEach((l) => {
      if (l.onControlMessage) {
        l.onControlMessage(control, rawLine);
      }
    });
  }

  private notifyMalformed(rawLine: string, reason: string): void {
    this.listeners.forEach((l) => l.onMalformedLine(rawLine, reason));
  }

  private notifyStatus(message?: string): void {
    const snapshot = { ...this.metrics };
    this.listeners.forEach((l) => l.onStatusChange(this.state, snapshot, message));
  }
}

export const globalSerialTelemetry = new SerialTelemetryService();
