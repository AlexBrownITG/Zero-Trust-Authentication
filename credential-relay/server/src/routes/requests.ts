import { Router, Request, Response } from 'express';
import { validate } from '../middleware/validation';
import { createRequestSchema, resolveRequestSchema } from './schemas';
import { createRequest, listRequests, resolveRequest, getRequestById } from '../services/request.service';
import { getDeviceById } from '../services/device.service';
import { getCredentialById } from '../services/credential.service';
import { broadcastToAdmins, sendToAgent } from '../ws/ws-server';

const router = Router();

router.post('/', validate(createRequestSchema), (req: Request, res: Response) => {
  try {
    // Validate device exists
    const device = getDeviceById(req.body.deviceId);
    if (!device) {
      res.status(404).json({ error: 'Device not found', code: 'DEVICE_NOT_FOUND' });
      return;
    }

    // Validate credential exists
    const credential = getCredentialById(req.body.credentialId);
    if (!credential) {
      res.status(404).json({ error: 'Credential not found', code: 'CREDENTIAL_NOT_FOUND' });
      return;
    }

    const request = createRequest(req.body);

    // Notify admin dashboard
    broadcastToAdmins({
      type: 'request.new',
      payload: {
        ...request,
        deviceHostname: device.hostname,
        deviceAlias: device.alias,
        serviceName: credential.serviceName,
        username: credential.username,
      },
      timestamp: new Date().toISOString(),
    });

    res.status(201).json(request);
  } catch (err) {
    res.status(500).json({
      error: 'Failed to create request',
      code: 'REQUEST_CREATE_FAILED',
      details: (err as Error).message,
    });
  }
});

router.get('/', (req: Request, res: Response) => {
  try {
    const status = req.query.status as string | undefined;
    const requests = listRequests(status);
    res.json(requests);
  } catch (err) {
    res.status(500).json({
      error: 'Failed to list requests',
      code: 'REQUEST_LIST_FAILED',
      details: (err as Error).message,
    });
  }
});

router.patch('/:id', validate(resolveRequestSchema), (req: Request, res: Response) => {
  try {
    const { action, resolvedBy } = req.body;
    const request = resolveRequest(req.params.id, action, resolvedBy);
    if (!request) {
      res.status(404).json({ error: 'Request not found', code: 'REQUEST_NOT_FOUND' });
      return;
    }

    // Broadcast status update to admin dashboard
    broadcastToAdmins({
      type: action === 'approve' ? 'request.approved' : 'request.rejected',
      payload: request,
      timestamp: new Date().toISOString(),
    });

    // If approved, send credential payload to agent
    if (action === 'approve') {
      const credential = getCredentialById(request.credentialId);
      if (credential) {
        sendToAgent(request.deviceId, {
          type: 'credential.payload',
          payload: {
            requestId: request.id,
            credentialId: credential.id,
            serviceName: credential.serviceName,
            username: credential.username,
            encryptedPassword: credential.encryptedPassword,
            iv: credential.iv,
            authTag: credential.authTag,
          },
          timestamp: new Date().toISOString(),
        });
      }
    }

    res.json(request);
  } catch (err) {
    const message = (err as Error).message;
    if (message.includes('not pending') || message.includes('expired')) {
      res.status(409).json({
        error: message,
        code: 'REQUEST_CONFLICT',
      });
      return;
    }
    res.status(500).json({
      error: 'Failed to resolve request',
      code: 'REQUEST_RESOLVE_FAILED',
      details: message,
    });
  }
});

export default router;
