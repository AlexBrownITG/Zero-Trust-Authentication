import { Router, Request, Response } from 'express';
import { validate } from '../middleware/validation';
import { createCredentialSchema, updateCredentialSchema } from './schemas';
import { createCredential, updateCredential, listCredentials } from '../services/credential.service';

const router = Router();

router.post('/', validate(createCredentialSchema), (req: Request, res: Response) => {
  try {
    const credential = createCredential(req.body);
    res.status(201).json(credential);
  } catch (err) {
    res.status(500).json({
      error: 'Failed to create credential',
      code: 'CREDENTIAL_CREATE_FAILED',
      details: (err as Error).message,
    });
  }
});

router.put('/:id', validate(updateCredentialSchema), (req: Request, res: Response) => {
  try {
    const credential = updateCredential(req.params.id, req.body);
    if (!credential) {
      res.status(404).json({ error: 'Credential not found', code: 'CREDENTIAL_NOT_FOUND' });
      return;
    }
    res.json(credential);
  } catch (err) {
    res.status(500).json({
      error: 'Failed to update credential',
      code: 'CREDENTIAL_UPDATE_FAILED',
      details: (err as Error).message,
    });
  }
});

router.get('/', (_req: Request, res: Response) => {
  try {
    const credentials = listCredentials();
    res.json(credentials);
  } catch (err) {
    res.status(500).json({
      error: 'Failed to list credentials',
      code: 'CREDENTIAL_LIST_FAILED',
      details: (err as Error).message,
    });
  }
});

export default router;
