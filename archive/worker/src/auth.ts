/**
 * CAN-7USAT Telemetry Sync Authentication & Authorization
 * Strict Fail-Closed Security Policy
 */

import { SyncRole, TelemetryWorkerEnv } from './types';

export const DEFAULT_PRODUCTION_ORIGIN =
  'https://can7usat-ground-control-station.pages.dev';

/**
 * Constant-time string equality check to prevent timing side-channel attacks.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }
  const enc = new TextEncoder();
  const aBuf = enc.encode(a);
  const bBuf = enc.encode(b);
  if (aBuf.byteLength !== bBuf.byteLength) {
    return false;
  }
  let c = 0;
  for (let i = 0; i < aBuf.byteLength; i++) {
    c |= aBuf[i] ^ bBuf[i];
  }
  return c === 0;
}

/**
 * Validates a client's requested role against server-configured secret keys.
 * Client-supplied role labels alone NEVER confer privileges.
 *
 * Security Requirements:
 * 1. Publisher authentication is mandatory, requiring a non-empty PUBLISHER_SECRET_KEY on server.
 * 2. Viewer authentication is mandatory, requiring a non-empty VIEWER_SECRET_KEY on server.
 * 3. Publisher and Viewer credentials are completely independent. A publisher token cannot
 *    authenticate a viewer, and a viewer passcode cannot authenticate a publisher.
 * 4. Missing or empty server keys fail-closed immediately.
 */
export function authenticateRole(
  role: SyncRole,
  token: string | undefined,
  env: TelemetryWorkerEnv
): { authorized: boolean; reason?: string } {
  const cleanToken = (token ?? '').trim();

  if (role === 'publisher') {
    const requiredPublisherSecret = (env.PUBLISHER_SECRET_KEY ?? '').trim();
    if (!requiredPublisherSecret) {
      return {
        authorized: false,
        reason:
          'Publisher authorization secret is not configured on the relay server.',
      };
    }
    if (!cleanToken) {
      return {
        authorized: false,
        reason: 'Publisher token is required for ground-station publishing.',
      };
    }
    if (!timingSafeEqual(cleanToken, requiredPublisherSecret)) {
      return {
        authorized: false,
        reason: 'Invalid publisher authorization token.',
      };
    }
    return { authorized: true };
  }

  if (role === 'viewer') {
    const requiredViewerSecret = (env.VIEWER_SECRET_KEY ?? '').trim();
    if (!requiredViewerSecret) {
      // Viewer auth is strictly mandatory and fail-closed: if VIEWER_SECRET_KEY is not configured, viewer sessions are disabled
      return {
        authorized: false,
        reason:
          'Viewer authorization secret is not configured on the relay server.',
      };
    }
    if (!cleanToken) {
      return {
        authorized: false,
        reason: 'Viewer passcode is required for spectator viewing.',
      };
    }
    if (!timingSafeEqual(cleanToken, requiredViewerSecret)) {
      return {
        authorized: false,
        reason: 'Invalid viewer authorization passcode.',
      };
    }
    return { authorized: true };
  }

  return { authorized: false, reason: `Unknown role: ${role}` };
}

/**
 * Evaluates the request Origin against strictly configured allowed origins.
 *
 * Rules:
 * - Production origin https://can7usat-ground-control-station.pages.dev is always enforced.
 * - Wildcard '*' or arbitrary localhost ports are strictly forbidden.
 * - Localhost origins (e.g. http://localhost:5173) are permitted ONLY when explicitly
 *   included in ALLOWED_ORIGINS.
 * - Exact case-insensitive match after stripping trailing slashes.
 */
export function validateOrigin(
  originHeader: string | null,
  allowedOriginsStr?: string
): boolean {
  if (!originHeader) {
    // Non-browser clients (e.g. CLI test scripts/native tools) might omit Origin,
    // which is permitted if they present valid cryptographic tokens.
    return true;
  }

  const rawConfig = (allowedOriginsStr ?? '').trim();
  const allowedList = new Set<string>();

  // Always permit the production Pages origin
  allowedList.add(DEFAULT_PRODUCTION_ORIGIN.toLowerCase());

  if (rawConfig) {
    for (const item of rawConfig.split(',')) {
      const clean = item.trim().toLowerCase().replace(/\/+$/, '');
      // Strictly ignore wildcards '*' or empty entries
      if (clean && clean !== '*') {
        allowedList.add(clean);
      }
    }
  }

  const normalizedOrigin = originHeader.trim().toLowerCase().replace(/\/+$/, '');
  return allowedList.has(normalizedOrigin);
}
