# CAN-7USAT Ground Control Station — Cloudflare Pages Production Deployment Guide

**Mission / Team:** CAN-7USAT (Team 017 — Parikshit)  
**Competition:** 2026 IN-SPACe CANSAT India Student Competition  
**Architecture:** Static Single-Page Application (SPA) — React 19, TypeScript 5.8, Vite 6, Tailwind CSS v4, Three.js  
**Hosting Target:** Cloudflare Pages (Global Edge CDN with HTTPS)

---

## 1. Executive Summary & Architectural Reality

This repository hosts the **CAN-7USAT Ground Control Station (GCS)**, providing real-time 6-DOF telemetry monitoring, attitude visualization with the physical CanSat STL assembly and 7-cell ram-air parafoil, ENU precision landing trajectory prediction, offline mapping, and a responsive Mobile Field Operations interface.

### Deployment Scope & Web Serial Boundaries

> [!IMPORTANT]
> **Hosting on Cloudflare Pages provides a globally distributed, secure HTTPS endpoint accessible from any desktop, tablet, or smartphone.**
> 
> However, **static web hosting does not replace a radio hardware link or cloud telemetry relay**:
> - **Desktop Chromium Browsers (Google Chrome, Microsoft Edge, Opera):** Support the **Web Serial API**. When a ground-station laptop is physically connected via USB to the 433 MHz / 868 MHz / 2.4 GHz ground transceiver (FTDI / CP2102 / CH340), the web app communicates directly with the radio hardware and streams live flight telemetry into the UI.
> - **Mobile & Tablet Browsers (iOS Safari, Android Chrome/Firefox):** The Web Serial API is **not supported** by mobile operating systems due to platform security and hardware access limitations. When opened on mobile devices, the GCS displays a clear, informative status badge indicating that hardware serial is unavailable on that device.
> - **Remote Monitoring:** Hosting on Cloudflare Pages enables field operators to review mission checklists, execute trajectory simulations, inspect offline maps, generate judge reports, and review recorded flight data. To stream live wireless telemetry to remote mobile devices in real time, a dedicated telemetry gateway / WebSocket relay server is required (planned as a separate backend phase).

---

## 2. Cloudflare Pages Project Configuration

When setting up your Cloudflare Pages project, use the following exact configuration parameters:

| Configuration Parameter | Value | Notes |
| :--- | :--- | :--- |
| **Project Name** | `can7usat-ground-control-station` | Or your preferred subdomain (`*.pages.dev`) |
| **Production Branch** | `main` | Automatic deployment triggers on push |
| **Framework Preset** | `Vite` (or `None`) | Cloudflare recognizes Vite automatically |
| **Build Command** | `npm run build` | Runs `tsc --noEmit` validation via Vite build |
| **Build Output Directory** | `dist` | Contains compiled HTML, JS, CSS, and 3D STL assets |
| **Root Directory** | `/` (default) | When connecting `CAN7USAT-ground-control-station` repo |
| **Root Directory (Monorepo)** | `groundstation/cansat-ground-control-station` | Only if connecting an outer wrapper repository |
| **Node.js Version** | `20` or `22` | Configured via `.node-version` / `.nvmrc` (see below) |

### Node.js Version Requirement

Vite 6 and Tailwind CSS v4 require **Node.js >= 20.0.0**. Cloudflare Pages build environments default to older Node versions unless instructed. This repository includes:
- [`.node-version`](file:///E:/Parikshit/Parikshit%20team/CAN-7USAT/groundstation/cansat-ground-control-station/.node-version) (`20`)
- [`.nvmrc`](file:///E:/Parikshit/Parikshit%20team/CAN-7USAT/groundstation/cansat-ground-control-station/.nvmrc) (`20`)

Alternatively, you can explicitly configure this in the Cloudflare Pages dashboard:
- **Variable Name:** `NODE_VERSION`
- **Value:** `20`

---

## 3. Client-Side Routing and Security Headers

The production build automatically copies two configuration files from `public/` into `dist/`:

### 3.1. SPA Client-Side Routing (`public/_redirects`)

```txt
/*    /index.html   200
```
- **Purpose:** Cloudflare Pages natively looks for static files matching the URL path. For single-page applications, direct navigation or page refreshes on subroutes (e.g. `https://<domain>/telemetry`, `https://<domain>/landing-predictor`) would otherwise return HTTP 404.
- **Result:** Serves `/index.html` with an HTTP 200 status code for all non-file routes, allowing React's client-side state machine and tab switching to initialize smoothly.

### 3.2. Custom Security and Caching Headers (`public/_headers`)

```txt
/*
  X-Content-Type-Options: nosniff
  X-Frame-Options: SAMEORIGIN
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: serial=(self)

/index.html
  Cache-Control: public, max-age=0, must-revalidate

/assets/*
  Cache-Control: public, max-age=31536000, immutable

/models/*
  Cache-Control: public, max-age=604800, stale-while-revalidate=86400
```

- **Permissions-Policy: `serial=(self)`:** Explicitly permits the Web Serial API to operate within the first-party origin over HTTPS.
- **Immediate Deployment Invalidation:** `/index.html` has `max-age=0, must-revalidate`, ensuring clients immediately fetch new application code upon every deployment.
- **Hashed Assets Caching:** Bundled scripts and styles in `/assets/` have content hashes and are cached immutably for 1 year.
- **CAD Mesh Asset Caching:** The 8.5 MB 3D CanSat model (`/models/CANSATassembly.stl`) is cached for 7 days with `stale-while-revalidate=86400`, preventing repeated large downloads during active field operations.

---

## 4. Environment Variables and Security Audit

### 4.1. The Client-Side Security Model

> [!WARNING]
> In a static React/Vite web application, **all environment variables prefixed with `VITE_` or embedded via `vite.config.ts` are compiled directly into public client-side JavaScript bundles**.
> 
> **Never store true secrets, private encryption keys, flight termination authorization tokens, or backend service-account credentials in frontend environment variables.**

### 4.2. Supported Frontend Variables

| Variable | Required | Exposure | Description |
| :--- | :--- | :--- | :--- |
| `NODE_VERSION` | Recommended | Cloudflare Build Only | Specifies Node.js version (`20` or `22`). Not exposed in bundle. |
| `VITE_CARTO_API_KEY` | Optional | Public Client Bundle | Optional API key for CARTO Dark basemap raster tiles. |
| `GOOGLE_MAPS_PLATFORM_KEY` | Optional | Public Client Bundle | Optional key injected if using Google Maps basemap tiles. |

### 4.3. Git Security & Local File Isolation

The repository `.gitignore` has been audited and verified:
- `.env*` and `.env.local` are excluded from version control (only `.env.example` is committed).
- Firmware compilation artifacts (`.pio/`, `*.hex`, `*.elf`, `*.bin`) are excluded.
- Local scratch files, testing profiles, and raw MBTiles bulk databases are excluded.
- The Git repository at `groundstation/cansat-ground-control-station` contains **no hardcoded credentials or proprietary private keys**.

---

## 5. Pre-Deployment Verification

Before triggering production deployment, verify all local test suites and build gates:

```powershell
# 1. Verify TypeScript types and syntax
npm run lint

# 2. Run the complete automated test suite (87 tests across 19 suites)
npm test

# 3. Compile the production bundle
npm run build

# 4. Verify that Cloudflare Pages configuration files are present in dist/
Test-Path dist/_redirects  # Returns True
Test-Path dist/_headers    # Returns True
```

**Test Coverage Summary:**
- Stage A-C: ThreeAttitudeViewport attitude smoothing, manual orbit drag, predictor exponential backoff, coordinate validation, source isolation.
- Stage D-F: Official competition CSV formatting, flight equipment pre-flight checklist, processor reset discontinuity detection.
- Stage G-I: 3D STL mesh integrity, mobile field-ops framing, CAN7USAT_FSW.ino 24-field telemetry protocol parser.
- Stage J: Container-query responsive layout for the Subsystem & Sensor Readout Matrix across all screen widths (320px to 1366px+).
- Flight Software Integration: 32-field continuous-rotation spool telemetry contract and ACK/ERR control parser.

---

## 6. Step-by-Step Deployment Instructions

### Step 1: Push Commits to GitHub

From the ground station repository:
```powershell
cd "E:\Parikshit\Parikshit team\CAN-7USAT\groundstation\cansat-ground-control-station"
git status
git add .
git commit -m "build(deploy): prepare ground control station for Cloudflare Pages production deployment"
git push origin main
```

*(Note: Commit and push must be approved and executed by the team lead.)*

### Step 2: Create Application in Cloudflare Pages

1. Log in to the [Cloudflare Dashboard](https://dash.cloudflare.com/).
2. In the left navigation sidebar, navigate to **Compute (Workers & Pages)** > **Pages**.
3. Click **Create application** > **Pages** > **Connect to Git**.
4. Select your GitHub account and authorize access to repository:
   - `Rushil1506/CAN7USAT-ground-control-station`

### Step 3: Configure Build & Deployment Settings

In the **Set up builds and deployments** screen:
1. **Project name:** `can7usat-ground-control-station` (or custom name).
2. **Production branch:** `main`.
3. **Framework preset:** `Vite`.
4. **Build command:** `npm run build`.
5. **Build output directory:** `dist`.
6. **Root directory:** Leave empty / default (`/`) if connecting `CAN7USAT-ground-control-station`.
7. **Environment variables (Advanced):**
   - Add variable: `NODE_VERSION` = `20`
   - *(Optional)* Add variable: `VITE_CARTO_API_KEY` = `<your-carto-key>`

### Step 4: Deploy and Monitor

1. Click **Save and Deploy**.
2. Cloudflare Pages will clone the repository, install dependencies via `npm install`, and execute `npm run build`.
3. Build completion typically takes **45–75 seconds**.
4. Once deployed, Cloudflare provides a unique preview URL (e.g. `https://can7usat-ground-control-station.pages.dev`).

---

## 7. Post-Deployment Verification Checklist

After the Cloudflare Pages build succeeds, complete this verification checklist:

- [ ] **HTTPS Enforced:** Confirm the site loads securely with a valid TLS certificate (`https://`).
- [ ] **SPA Routing & Page Reload:** Navigate to a view, refresh the browser (F5), and confirm no HTTP 404 error occurs (`_redirects` test).
- [ ] **Security Headers:** Open DevTools > Network > `index.html` and verify headers:
  - `Permissions-Policy: serial=(self)`
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: SAMEORIGIN`
- [ ] **3D Assembly Rendering:** Open the 3D Attitude tab or Mobile 3D card. Verify that `CANSATassembly.stl` loads successfully and the 7-cell ram-air parafoil renders above the payload.
- [ ] **Desktop Web Serial Link:** Connect the USB telemetry receiver on a Chromium browser (Chrome/Edge). Verify the serial port picker modal opens and recognizes the COM port.
- [ ] **Mobile Field Ops Responsiveness:** Open the URL on a mobile device (or toggle Chrome DevTools device mode at 360x800 and 390x844). Verify:
  - Header displays telemetry badge and compact flight status.
  - Quick action tabs allow quick switching between Flight Overview, Map, 3D, and Subsystem Matrix.
  - Subsystem Readout Matrix adapts using container queries without clipping or overlapping text.
  - Serial link panel gracefully indicates `WEB SERIAL UNSUPPORTED` with an explanatory note.
- [ ] **Simulation Mode:** Toggle **Simulation Mode** to verify telemetry animation, chart streaming, and trajectory prediction function seamlessly in offline/demonstration scenarios.

---

## 8. Custom Domain Setup (Optional)

To bind the GCS to a custom domain (e.g., `gcs.parikshitcansat.org`):
1. In Cloudflare Dashboard, go to **Pages** > your project > **Custom domains**.
2. Click **Set up a custom domain**.
3. Enter your domain/subdomain and follow Cloudflare's automated DNS CNAME routing instructions. Cloudflare automatically provisions and renews SSL/TLS certificates.
