import { createServer as createHttpServer } from 'node:http';
import { Agent } from '@earendil-works/pi-agent-core';
import { createModels } from '@earendil-works/pi-ai';

// Loading both libraries proves the selected Pi packages work in this runtime.
// Provider authentication and model execution are intentionally added in Phase 3.
export function createServer() {
    if (typeof Agent !== 'function' || typeof createModels !== 'function') {
        throw new Error('The installed Pi packages do not expose the expected API.');
    }

    return createHttpServer(
        { requestTimeout: 5_000, headersTimeout: 5_000, keepAliveTimeout: 1_000 },
        (request, response) => {
            response.setHeader('Content-Type', 'application/json');
            response.setHeader('Cache-Control', 'no-store');

            if (request.method === 'GET' && request.url === '/internal/health') {
                response.writeHead(200);
                response.end(JSON.stringify({
                    status: 'ok',
                    service: 'agent',
                    providerAuth: 'not_configured',
                }));
                return;
            }

            response.writeHead(404);
            response.end(JSON.stringify({ error: 'Not found' }));
        },
    );
}
