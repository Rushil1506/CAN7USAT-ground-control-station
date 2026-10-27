/**
 * CAN-7USAT Telemetry Synchronization Worker Entry Point
 */

import { TelemetryWorkerEnv } from './types';
import { validateOrigin, DEFAULT_PRODUCTION_ORIGIN } from './auth';
import { TelemetryRelayDO } from './telemetryDurableObject';

export { TelemetryRelayDO };

export default {
  async fetch(request: Request, env: TelemetryWorkerEnv): Promise<Response> {
    const url = new URL(request.url);
    const reqOrigin = request.headers.get('Origin');
    const originAllowed = validateOrigin(reqOrigin, env.ALLOWED_ORIGINS);

    // Handle CORS Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: originAllowed ? 204 : 403,
        headers: {
          'Access-Control-Allow-Origin':
            originAllowed && reqOrigin ? reqOrigin : 'null',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers':
            'Content-Type, Authorization, X-Mission-Id, Upgrade',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    // Health & Status check endpoint
    if (
      url.pathname === '/' ||
      url.pathname === '/health' ||
      url.pathname === '/api/v1/health'
    ) {
      return new Response(
        JSON.stringify({
          status: 'HEALTHY',
          service: 'CAN-7USAT Real-Time Telemetry Synchronization Relay',
          team: '2026-IN-SPACe-CAN-7USAT-017 (Team Parikshit)',
          version: '1.0.0',
          timestamp: new Date().toISOString(),
          websocketEndpoint: '/api/v1/telemetry/ws',
          authPolicy: {
            publisherAuthMandatory: true,
            viewerAuthMandatory: true,
            productionOrigin: DEFAULT_PRODUCTION_ORIGIN,
          },
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin':
              originAllowed && reqOrigin ? reqOrigin : DEFAULT_PRODUCTION_ORIGIN,
          },
        }
      );
    }

    // WebSocket Telemetry Relay Endpoint
    if (url.pathname === '/api/v1/telemetry/ws') {
      // Validate Origin header
      if (!originAllowed) {
        return new Response('Forbidden: Origin not authorized by relay policy', {
          status: 403,
        });
      }

      // Check Upgrade header
      const upgradeHeader = request.headers.get('Upgrade');
      if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
        return new Response('Expected WebSocket Upgrade request', {
          status: 426,
        });
      }

      // Extract missionId (isolated Durable Object instance per mission session)
      const missionId =
        url.searchParams.get('missionId') ||
        request.headers.get('X-Mission-Id') ||
        env.DEFAULT_MISSION_ID ||
        'CAN-7USAT-017';

      // Obtain or create the Durable Object for this mission ID
      const doId = env.TELEMETRY_RELAY_DO.idFromName(missionId);
      const doStub = env.TELEMETRY_RELAY_DO.get(doId);

      // Delegate the WebSocket connection to the Durable Object
      return doStub.fetch(request);
    }

    return new Response('Not Found', { status: 404 });
  },
};
