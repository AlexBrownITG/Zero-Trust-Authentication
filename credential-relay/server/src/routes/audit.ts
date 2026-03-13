import { Router, Request, Response } from 'express';
import { queryAuditLog } from '../services/audit.service';

const router = Router();

router.get('/', (req: Request, res: Response) => {
  try {
    const deviceId = req.query.deviceId as string | undefined;
    const eventType = req.query.eventType as string | undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;

    const entries = queryAuditLog({ deviceId, eventType, limit });
    res.json(entries);
  } catch (err) {
    res.status(500).json({
      error: 'Failed to query audit log',
      code: 'AUDIT_QUERY_FAILED',
      details: (err as Error).message,
    });
  }
});

export default router;
