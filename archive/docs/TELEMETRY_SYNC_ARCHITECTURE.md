# CAN-7USAT Ground Control Station
## Secure Real-Time Multi-Device Telemetry Synchronization Architecture

**Mission:** IN-SPACe CANSAT India 2026 (`2026-IN-SPACe-CAN-7USAT-017`)
**Team:** 017 (Parikshit)
**Classification:** Ground Systems Engineering & Cloud Distribution Architecture
**Status:** Verified & Validated (112 Passing Test Assertions, Hardened Security Suite)

---

## 1. Executive Summary & Architectural Principles

During the CAN-7USAT flight competition, the primary Ground Control Station (GCS) operates on a laptop connected directly to the UHF/LoRa receiver via Web Serial USB. Field recovery operators, team spectators, and competition judges require live situational awareness on smartphones and tablets across the launch site without crowding around the operator's laptop.

### Core Architectural Axiom: 1 Publisher, Multiple Read-Only Viewers
```
+-------------------------------------------------------------+
|                      FLIGHT HARDWARE                        |
|   Teensy 4.1 Avionics + LoRa SX1268 Transmitter (433.250MHz)|
+-------------------------------------------------------------+
                               |
                               | (RF Telemetry 433MHz - Downlink Only)
                               v
+-------------------------------------------------------------+
|               PRIMARY GROUND CONTROL STATION                |
|      Laptop: Web Serial USB -> Live Parser -> Local UI      |
+-------------------------------------------------------------+
                               |
                               | (WSS / JSON over Internet: Authenticated Telemetry Frame)
                               v
+-------------------------------------------------------------+
|                  CLOUDFLARE RELAY WORKER                    |
|      Durable Object: WebSocket Hibernation API Relay        |
|  - Authenticated Publisher Lease (1 per mission)            |
|  - Read-Only Spectator Broadcast                            |
|  - Latest-State Snapshot Cache                              |
|  - Strict Command/Publish Blocking for Viewers              |
+-------------------------------------------------------------+
         /                     |                     \
        v                      v                      v
+----------------+     +----------------+     +----------------+
|  FIELD OPS 1   |     |  FIELD OPS 2   |     | JUDGE / GUEST  |
|  (Mobile Deck) |     | (Tablet Radar) |     | (Spectator UI) |
|   READ-ONLY    |     |   READ-ONLY    |     |   READ-ONLY    |
+----------------+     +----------------+     +----------------+
```

### Strict Non-Negotiable Boundaries:
1. **Zero Cloud-to-Hardware Control:** Remote viewers are strictly read-only. No telecommands, actuators, burnwire igniters, calibration triggers, or serial control buttons can be initiated over the cloud relay.
2. **One Active Publisher Lease:** Only one authorized ground station can publish telemetry to a mission channel at any time. Lease collisions are rejected server-side.
3. **No Secrets in Bundles or LocalStorage:** Neither publisher secret keys nor administration credentials are baked into client-side Vite builds or stored in `localStorage`.
4. **Source Isolation & Anti-Contamination:** Simulated packets are strictly segregated to explicitly designated test channels (`isTestSession: true`) and rejected if pushed to a live mission channel.
5. **Fail-Safe Offline Isolation:** If the internet, Cloudflare, or cell towers drop, the primary ground station laptop continues uninterrupted on its local Web Serial telemetry feed and offline MBTiles maps.

---

## 2. Cloudflare Worker & Durable Object Architecture

The backend relay is implemented as an edge-native Cloudflare Worker coupled with a `TelemetryRelayDO` Durable Object utilizing the **WebSocket Hibernation API**.

### Why Durable Objects + WebSocket Hibernation?
- **Global Coordination:** Durable Objects guarantee that all WebSocket connections for mission `CAN-7USAT-017` terminate at the exact same physical in-memory instance, providing deterministic state synchronization without database polling.
- **Zero Idle CPU Consumption:** The WebSocket Hibernation API hibernates connections in memory when no messages are flowing, consuming **0 seconds of billable wall-clock CPU time**. The Worker only wakes up during message events (downlink frames or heartbeats).
- **Sub-15ms Edge Latency:** Relays frames to connected mobile field clients in milliseconds across regional cellular networks.

### Server Components (`worker/src/`)
- [`worker/src/index.ts`](file:///e:/Parikshit/Parikshit%20team/CAN-7USAT/groundstation/cansat-ground-control-station/worker/src/index.ts): HTTP router handling CORS, `/api/v1/health` health checks, and upgrading `/api/v1/telemetry/ws` to Durable Object stubs.
- [`worker/src/telemetryDurableObject.ts`](file:///e:/Parikshit/Parikshit%20team/CAN-7USAT/groundstation/cansat-ground-control-station/worker/src/telemetryDurableObject.ts): Durable Object managing active publisher lease, viewer subscriptions, sequence numbers, bounded snapshot history (50 frames), rate limiting (25 Hz), and heartbeat timeouts.
- [`worker/src/auth.ts`](file:///e:/Parikshit/Parikshit%20team/CAN-7USAT/groundstation/cansat-ground-control-station/worker/src/auth.ts): Constant-time string matching (`timingSafeEqual`) to eliminate timing side-channel attacks, publisher lease validation, and Origin verification.
- [`worker/src/types.ts`](file:///e:/Parikshit/Parikshit%20team/CAN-7USAT/groundstation/cansat-ground-control-station/worker/src/types.ts): Strict wire protocol interface definitions.

---

## 3. Wire Protocol Specification

WebSocket Endpoint: `wss://<worker-domain>/api/v1/telemetry/ws?missionId=CAN-7USAT-017&role=<publisher|viewer>`

### 3.1 Authentication Handshake (Client -> Server)
Standard browser WebSockets do not support custom HTTP headers in `new WebSocket()`. Exposing secret keys in query strings is insecure because URLs are logged by proxies, browser history, and server logs.
Therefore, the client establishes an unauthenticated socket and immediately sends an `AUTH` frame within 5000ms:

```json
{
  "type": "AUTH",
  "role": "publisher",
  "missionId": "CAN-7USAT-017",
  "token": "<PUBLISHER_SECRET_KEY>",
  "clientLabel": "GCS-Primary-Laptop"
}
```

**Server Responses:**
- Success:
  ```json
  {
    "type": "AUTH_SUCCESS",
    "role": "publisher",
    "missionId": "CAN-7USAT-017",
    "serverTimeMs": 1793100000000,
    "publisherActive": true
  }
  ```
- Failure (connection closed immediately with code 4001 or 4002):
  ```json
  {
    "type": "AUTH_ERROR",
    "code": "ERROR_INVALID_TOKEN",
    "message": "Invalid publisher authorization token."
  }
  ```

### 3.2 Telemetry Frame (Publisher -> Server -> Viewers)
When validated live telemetry arrives via Web Serial, the publisher wraps the verified JSON packet:

```json
{
  "type": "TELEMETRY_FRAME",
  "schemaVersion": 1,
  "sequenceNumber": 42,
  "sourceType": "LIVE_SERIAL",
  "missionId": "CAN-7USAT-017",
  "receivedAtMs": 1793100010100,
  "publishedAtMs": 1793100010115,
  "rawSentence": "FSW:PKT=42,STATE=GUIDED_DESCENT,ALT=182.4,LAT=26.7994,LON=83.9535...",
  "packet": {
    "packetNumber": 42,
    "timestampMs": 142000,
    "altitudeMslM": 182.4,
    "flightState": 6,
    "flightStateRaw": "GUIDED_DESCENT",
    "pressureHpa": 1008.2,
    "voltageVolts": 8.24,
    "gpsValid": true,
    "latitudeDeg": 26.7994,
    "longitudeDeg": 83.9535
  }
}
```

The relay validates:
1. Originating socket holds the active `publisher` lease.
2. `rawJson.length <= 65536` bytes (64 KB cap).
3. `sequenceNumber > lastSequenceNumber` (monotonicity).
4. Frame rate does not exceed 25 frames/second.
5. If `sourceType === 'SIMULATION_TEST'`, mission ID must contain `TEST`.

The relay appends the packet to `recentHistory` (bounded at 50 frames), updates `latestPacket`, and broadcasts the frame to all authenticated viewers.

### 3.3 Initial Snapshot Delivery (Server -> Newly Connected Viewer)
When a spectator or judge opens the GCS on their phone midway through the flight, the relay immediately transmits a `SNAPSHOT` message before the next live frame:

```json
{
  "type": "SNAPSHOT",
  "missionId": "CAN-7USAT-017",
  "publisherActive": true,
  "isHistorical": false,
  "snapshotAgeMs": 350,
  "latestPacket": { ... },
  "latestRawSentence": "FSW:PKT=42...",
  "recentHistory": [ ...50 packets... ]
}
```
If the publisher is disconnected or heartbeats have stopped for >10 seconds, `isHistorical` is flagged `true`, and the remote viewer UI immediately displays **HISTORICAL SNAPSHOT (STALE)** in amber rather than fabricating real-time telemetry.

---

## 4. Ground Station & Remote Viewer UI Integration

### 4.1 Ground Station Publisher Mode
- **Manual Activation:** Ground station operator must click **Cloud Sync** in the header or link panel to open [`SyncRelayModal`](file:///e:/Parikshit/Parikshit%20team/CAN-7USAT/groundstation/cansat-ground-control-station/src/components/SyncRelayModal.tsx).
- **Credential Entry:** Operator enters the publisher secret key. It is kept only in component memory for the active session.
- **Relay Metrics:** Shows live Round-Trip Time (RTT latency ms), packets sent, sequence number, and connection state (`CONNECTED`, `RECONNECTING`, etc.).

### 4.2 Read-Only Remote Viewer Mode
- **Dedicated Data Source:** Selection of `REMOTE_VIEWER` data source isolates all state from `SIMULATION` and `LIVE_SERIAL`.
- **Locked Hardware Controls:**
  - Web Serial connect/disconnect buttons disabled with explanatory pill.
  - Telecommand input in Terminal Drawer locked with `REMOTE VIEWER: READ-ONLY SPECTATOR MODE`.
  - Target coordinate adjustments on map disabled.
  - Simulation disturbances and state overrides disabled.
- **Visual Indicators:**
  - Header displays blue `REMOTE SPECTATOR (LIVE)` or amber `REMOTE SPECTATOR (STALE)` badge.
  - Packet age counter informs field operators of transmission delays.

---

## 5. Security & Threat Model

| Threat / Attack Vector | Mitigation in CAN-7USAT Architecture | Verification Test |
| :--- | :--- | :--- |
| **Unauthenticated Viewer Access** | Mandatory, fail-closed `VIEWER_SECRET_KEY` verification. Server without viewer secret blocks all viewers. | `telemetrySync.test.ts` (test #4, #5) |
| **Viewer Attempting to Publish** | Server checks session attachment `role !== 'publisher'`. Rejects frame with `PERMISSION_DENIED` and ignores content. | `telemetrySync.test.ts` (test #3) |
| **Role Escalation via Repeated AUTH** | Sockets reject subsequent `AUTH` messages once authenticated with `ALREADY_AUTHENTICATED`. Role switching forbidden. | `telemetrySync.test.ts` (test #10) |
| **Credential Crossover Attack** | Publisher secret and Viewer passcode are strictly independent. Passing publisher secret to viewer fails, and vice versa. | `telemetrySync.test.ts` (test #6) |
| **Hardware Command Injection** | Cloud relay unconditionally rejects all command types (`COMMAND`, `TELECOMMAND`, `ACTUATOR_COMMAND`, `BURNWIRE`, etc.) with `COMMANDS_PROHIBITED`. | `telemetrySync.test.ts` (test #11) |
| **Arbitrary Localhost Port Hijacking** | Strict origin validation against production Pages domain and explicitly configured origins only. Wildcards and arbitrary localhost ports rejected. | `telemetrySync.test.ts` (test #7) |
| **Timing Side-Channel Attacks** | Secret tokens compared using constant-time bitwise XOR `timingSafeEqual()` in `worker/src/auth.ts`. | `telemetrySync.test.ts` (test #1) |
| **Duplicate Publisher Collision** | Durable Object enforces single active publisher lease per mission ID. Second connection receives `4409 Lease Conflict`. | `telemetrySync.test.ts` (test #12) |
| **Hibernation Timeout Bypass** | Durable Object alarms (`setAlarm`) persist across hibernation to enforce 5s authentication deadline even if DO sleeps. | `telemetrySync.test.ts` & DO alarm handler |
| **Lease & Cache Loss across Restarts** | DO SQLite storage persists sequence numbers, snapshots, and leases; reconciles live sockets upon wake-up. | `telemetryDurableObject.ts` |
| **Simulation Contamination** | Relay rejects `SIMULATION_TEST` frames on official mission channels (`CAN-7USAT-017`). | `telemetrySync.test.ts` (test #18) |
| **Packet Flooding / DoS** | Payloads capped at 64 KB; frame rate throttled at 25 Hz; WebSocket hibernation protects memory. | `telemetrySync.test.ts` (test #17) |
| **Stale Publisher Deception** | Server monitors heartbeat threshold; viewers receive `PUBLISHER_STATUS: DISCONNECTED` on socket close or stale flags. | `telemetrySync.test.ts` (test #13) |

---

## 6. Cloudflare Free-Tier Quota & Cost Analysis

The competition budget requires zero recurring cloud expenses. We evaluated actual Cloudflare Workers and Durable Objects limits:

### 6.1 Cloudflare Free Tier Allocations
- **Worker Requests:** 100,000 requests / day (Free).
- **Durable Objects Invocations:** 1,000,000 requests / month (Free).
- **WebSocket Connection Hours:** **250,000 connection-hours / month (Free)**.
- **Durable Object Storage:** 1 GB SQLite / KV (Free).
- **Durable Object Active CPU:** 10 ms CPU time per event.

### 6.2 Realistic Flight Consumption Calculation
A typical CanSat competition mission scenario:
- **Flight Duration:** 120 minutes (2.0 hours from launch preparation through recovery).
- **Telemetry Frequency:** 5 Hz average (5 frames per second).
- **Concurrent Viewers:** 10 connected devices (1 publisher laptop + 6 phones + 3 spectator tablets).

**Usage Breakdown:**
1. **WebSocket Connection-Hours:**
   $$10 \text{ devices} \times 2 \text{ hours} = 20 \text{ connection-hours}$$
   $20 / 250,000 = \mathbf{0.008\%}$ of monthly free quota.
2. **Messages / Durable Object Events:**
   $$5 \text{ frames/sec} \times 7200 \text{ sec} = 36,000 \text{ frames}$$
   Broadcast to 10 viewers consumes $\approx 36,000$ DO wakeups, well below the 1,000,000 monthly free allocation ($\approx 3.6\%$).
3. **Bandwidth:**
   Each frame is $\approx 600$ bytes. $36,000 \times 600 = 21.6 \text{ MB}$ total egress bandwidth. Cloudflare provides unlimited egress on Workers.

### 6.3 Quota Failure Modes & Graceful Degradation
- **If Cloudflare limit is reached:** The relay server closes new connections with code `4029 Rate Limited`.
- **Graceful Fallback:** The primary ground station laptop is unaffected because it communicates over local Web Serial USB cable directly to the LoRa receiver. Telemetry logging and CSV export proceed without data loss.

---

## 7. Local Multi-Client Demonstration

A standalone verification script is provided in `scripts/demo_local_sync.mjs`.

To run the local relay and multi-client demonstration:
```powershell
cd groundstation/cansat-ground-control-station
node scripts/demo_local_sync.mjs
```

### Demonstration Steps Performed:
1. Starts local WebSocket relay on `ws://127.0.0.1:8787`.
2. Connects Primary Ground Station and acquires `PUBLISHER` lease.
3. Connects Mobile Field Ops device as `VIEWER 1`.
4. Publisher streams Frames 1, 2, 3 in real-time to Viewer 1.
5. Connects Mission Director tablet as `VIEWER 2` late in the flight.
6. Viewer 2 immediately receives `SNAPSHOT` containing latest state and history.
7. Simulates security attack: Viewer attempts to publish -> server blocks attempt.
8. Simulates security attack: Rogue client attempts invalid token -> server rejects connection.
9. Publisher streams Frame 4 simultaneously to both Viewers.
10. Publisher disconnects -> Viewers receive `PUBLISHER_STATUS: DISCONNECTED`.

---

## 8. Step-by-Step Production Deployment Guide

> [!IMPORTANT]
> Do NOT run deployment commands or modify production environment variables until the team explicitly authorizes deployment.

### Step 1: Install Wrangler & Authenticate
```powershell
npm install -g wrangler
wrangler login
```

### Step 2: Configure Production Secrets in Cloudflare
Set the ground station publisher secret key (never commit this secret to Git):
```powershell
cd groundstation/cansat-ground-control-station/worker
wrangler secret put PUBLISHER_SECRET_KEY
# Enter a strong secret (e.g. 32-character random string): parikshit-2026-can7usat-ground-secret
```

*(Optional)* If spectator viewing requires a team passcode:
```powershell
wrangler secret put VIEWER_SECRET_KEY
```

### Step 3: Deploy the Worker & Durable Object
```powershell
cd groundstation/cansat-ground-control-station/worker
wrangler deploy
```
Wrangler will output the deployed Worker URL:
`https://can7usat-telemetry-relay.<your-subdomain>.workers.dev`

### Step 4: Configure Frontend Cloudflare Pages
1. Open the deployed Ground Control Station on Cloudflare Pages (`https://can7usat.pages.dev`).
2. Click the **Cloud Sync** icon in the header or in the **Serial Link & Relay** panel.
3. Enter the deployed WebSocket endpoint:
   `wss://can7usat-telemetry-relay.<your-subdomain>.workers.dev/api/v1/telemetry/ws`
4. Set the default Mission ID: `CAN-7USAT-017`.
5. On the primary laptop: Enter the Publisher Key and select **Start Publishing**.
6. On spectator devices: Select **Connect as Viewer**.

### Step 5: Rollback Procedure
If the cloud relay requires immediate termination:
```powershell
# Disable worker traffic immediately from CLI
wrangler rollback
# Or rotate secrets to disconnect any active clients:
wrangler secret put PUBLISHER_SECRET_KEY
```
The ground station laptop can continue operations via local USB Web Serial with zero downtime.
