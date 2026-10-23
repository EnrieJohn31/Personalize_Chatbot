import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';

// Wire format is documented in contracts/README.md; contracts/v1/examples/signature.json pins it.
export const SIGNATURE_SCHEME = 'AGENT-HMAC-SHA256-V1';
const TIMESTAMP_PATTERN = /^[0-9]{1,12}$/;
const SIGNATURE_PATTERN = /^v1=([0-9a-f]{64})$/;

export type SignatureFailure = 'missing' | 'malformed' | 'expired' | 'mismatch';

export interface SignatureHeaders {
    timestamp: string;
    signature: string;
}

export function canonicalRequest(timestamp: string, method: string, target: string, body: Buffer | string): string {
    const bodyHash = createHash('sha256').update(body).digest('hex');

    return [SIGNATURE_SCHEME, timestamp, method.toUpperCase(), target, bodyHash].join('\n');
}

export function signRequest(key: string, timestamp: string, method: string, target: string, body: Buffer | string): string {
    const digest = createHmac('sha256', key).update(canonicalRequest(timestamp, method, target, body)).digest('hex');

    return `v1=${digest}`;
}

/** Checks header presence, format and freshness before any request body is read. */
export function readSignatureHeaders(
    headers: IncomingHttpHeaders,
    nowMs: number,
    toleranceSeconds: number,
): SignatureHeaders | SignatureFailure {
    const timestamp = headers['x-agent-timestamp'];
    const signature = headers['x-agent-signature'];
    if (timestamp === undefined || signature === undefined) {
        return 'missing';
    }
    if (
        Array.isArray(timestamp)
        || Array.isArray(signature)
        || !TIMESTAMP_PATTERN.test(timestamp)
        || !SIGNATURE_PATTERN.test(signature)
    ) {
        return 'malformed';
    }
    if (Math.abs(nowMs / 1000 - Number(timestamp)) > toleranceSeconds) {
        return 'expired';
    }

    return { timestamp, signature };
}

export function signatureMatches(
    key: string,
    headers: SignatureHeaders,
    method: string,
    target: string,
    body: Buffer,
): boolean {
    const expected = Buffer.from(signRequest(key, headers.timestamp, method, target, body));
    const received = Buffer.from(headers.signature);

    return expected.length === received.length && timingSafeEqual(expected, received);
}
