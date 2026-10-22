import { createServer } from './server.js';

const port = Number(process.env.PORT ?? 3101);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
}

const server = createServer();
server.on('error', (error) => {
    console.error('Agent server failed:', error.message);
    process.exit(1);
});
server.listen(port, '0.0.0.0', () => {
    console.log(`Agent health service listening on port ${port}`);
});

function shutdown() {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5_000).unref();
}

process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
