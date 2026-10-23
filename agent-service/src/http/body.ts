import type { IncomingMessage } from 'node:http';

/** Resolves the complete body, or null as soon as it is known to exceed `limit` bytes. */
export function readBoundedBody(request: IncomingMessage, limit: number): Promise<Buffer | null> {
    return new Promise((resolve, reject) => {
        const declared = Number(request.headers['content-length']);
        if (Number.isFinite(declared) && declared > limit) {
            resolve(null);
            return;
        }

        const chunks: Buffer[] = [];
        let size = 0;
        let exceeded = false;
        request.on('data', (chunk: Buffer) => {
            if (exceeded) {
                return;
            }
            size += chunk.length;
            if (size > limit) {
                // Keep draining without buffering; the error response closes the connection.
                exceeded = true;
                chunks.length = 0;
                resolve(null);
                return;
            }
            chunks.push(chunk);
        });
        request.on('end', () => {
            if (!exceeded) {
                resolve(Buffer.concat(chunks));
            }
        });
        request.on('error', reject);
    });
}
