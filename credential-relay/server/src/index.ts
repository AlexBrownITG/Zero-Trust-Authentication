import 'dotenv/config';
import http from 'node:http';
import { config } from './config';
import { createApp } from './app';
import { initDb, closeDb } from './db/database';
import { setupWebSocket } from './ws/ws-server';
import { expireOldRequests } from './services/request.service';
import { logger } from './logger';

// Initialize database
initDb(config.dbPath);

// Create Express app and HTTP server
const app = createApp();
const server = http.createServer(app);

// Set up WebSocket handling
setupWebSocket(server);

// Expire old requests every 30 seconds
const expiryInterval = setInterval(() => {
  const expired = expireOldRequests();
  if (expired > 0) {
    logger.info({ count: expired }, 'Expired stale credential requests');
  }
}, 30_000);

// Start server
server.listen(config.port, () => {
  logger.info({ port: config.port }, `Server listening on http://localhost:${config.port}`);
  logger.info(`Admin dashboard: http://localhost:${config.port}/dashboard`);
});

// Graceful shutdown
function shutdown(): void {
  logger.info('Shutting down...');
  clearInterval(expiryInterval);
  server.close(() => {
    closeDb();
    logger.info('Server stopped');
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
