import { Router, Request, Response } from 'express';
import { decrypt } from '@credential-relay/shared';
import { validate } from '../middleware/validation';
import { createRequestSchema, resolveRequestSchema } from './schemas';
import { createRequest, listRequests, resolveRequest, getRequestById, updateRequestStatus } from '../services/request.service';
import { getDeviceById } from '../services/device.service';
import { getCredentialById } from '../services/credential.service';
import { broadcastToAdmins, sendToAgent } from '../ws/ws-server';
import { config } from '../config';
import { writeAuditLog } from '../services/audit.service';

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
      type: 'new_request',
      payload: {
        ...request,
        deviceAlias: device.deviceAlias,
        accountEmail: credential.accountEmail,
        targetDomain: credential.targetDomain,
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

// Get a single request by ID (for extension polling)
router.get('/:id', (req: Request, res: Response) => {
  try {
    const request = getRequestById(req.params.id);
    if (!request) {
      res.status(404).json({ error: 'Request not found', code: 'REQUEST_NOT_FOUND' });
      return;
    }
    res.json(request);
  } catch (err) {
    res.status(500).json({
      error: 'Failed to get request',
      code: 'REQUEST_GET_FAILED',
      details: (err as Error).message,
    });
  }
});

// One-time credential fetch — decrypts and returns the credential for an approved/relayed request.
// After fetching, marks the request as "completed" so it can't be fetched again.
router.get('/:id/credential', (req: Request, res: Response) => {
  try {
    const request = getRequestById(req.params.id);
    if (!request) {
      res.status(404).json({ error: 'Request not found', code: 'REQUEST_NOT_FOUND' });
      return;
    }

    // Only allow fetch for approved or relayed requests
    if (request.status !== 'approved' && request.status !== 'relayed') {
      res.status(409).json({
        error: `Credential not available (request status: ${request.status})`,
        code: 'CREDENTIAL_NOT_READY',
      });
      return;
    }

    const credential = getCredentialById(request.credentialId);
    if (!credential) {
      res.status(404).json({ error: 'Credential not found', code: 'CREDENTIAL_NOT_FOUND' });
      return;
    }

    // Decrypt password server-side
    const password = decrypt(
      {
        ciphertext: credential.encryptedPassword,
        iv: credential.iv,
        authTag: credential.authTag,
      },
      config.vaultMasterKey,
    );

    // Mark request as completed (one-time use)
    updateRequestStatus(request.id, 'completed');

    writeAuditLog({
      eventType: 'injection_confirmed',
      requestId: request.id,
      deviceId: request.deviceId,
      metadata: { method: 'direct_fetch' },
    });

    res.json({
      accountEmail: credential.accountEmail,
      password,
      targetDomain: credential.targetDomain,
    });
  } catch (err) {
    res.status(500).json({
      error: 'Failed to fetch credential',
      code: 'CREDENTIAL_FETCH_FAILED',
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
      type: 'request_resolved',
      payload: request,
      timestamp: new Date().toISOString(),
    });

    // If approved, send credential payload to agent
    if (action === 'approve') {
      const credential = getCredentialById(request.credentialId);
      if (credential) {
        sendToAgent(request.deviceId, {
          type: 'credential_payload',
          payload: {
            requestId: request.id,
            credentialId: credential.id,
            accountEmail: credential.accountEmail,
            targetDomain: credential.targetDomain,
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
