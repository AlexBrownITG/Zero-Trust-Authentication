import express from 'express';
import path from 'node:path';
import deviceRoutes from './routes/devices';
import credentialRoutes from './routes/credentials';
import requestRoutes from './routes/requests';
import auditRoutes from './routes/audit';
import { errorHandler } from './middleware/error-handler';

export function createApp(): express.Application {
  const app = express();

  app.use(express.json());

  // Serve admin dashboard static files
  app.use('/dashboard', express.static(path.join(__dirname, '../dashboard')));

  // API routes
  app.use('/api/devices', deviceRoutes);
  app.use('/api/credentials', credentialRoutes);
  app.use('/api/requests', requestRoutes);
  app.use('/api/audit', auditRoutes);

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Error handler
  app.use(errorHandler);

  return app;
}
