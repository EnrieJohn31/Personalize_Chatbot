import { loadConfig } from './config.js';
import { createServer } from './server.js';

const port = Number(process.env.PORT ?? 3101);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
}

const config = loadConfig();
const server = createServer(config);
server.on('error', (error) => {
    console.error('Agent server failed:', error.message);
    process.exit(1);
});
server.listen(port, '0.0.0.0', () => {
    const requestAuth = config.requestSigningKey === null ? 'not configured; run endpoints closed' : 'configured';
    console.log(`Agent service listening on port ${port} (request signing ${requestAuth})`);
});

function shutdown() {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5_000).unref();
}

process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
