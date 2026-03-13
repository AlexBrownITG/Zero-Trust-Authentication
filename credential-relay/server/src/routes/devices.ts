import { Router, Request, Response } from 'express';
import { validate } from '../middleware/validation';
import { deviceRegistrationSchema } from './schemas';
import { registerDevice, listDevices } from '../services/device.service';

const router = Router();

router.post('/register', validate(deviceRegistrationSchema), (req: Request, res: Response) => {
  try {
    const device = registerDevice(req.body);
    res.status(201).json(device);
  } catch (err) {
    res.status(500).json({
      error: 'Failed to register device',
      code: 'DEVICE_REGISTRATION_FAILED',
      details: (err as Error).message,
    });
  }
});

router.get('/', (_req: Request, res: Response) => {
  try {
    const devices = listDevices();
    res.json(devices);
  } catch (err) {
    res.status(500).json({
      error: 'Failed to list devices',
      code: 'DEVICE_LIST_FAILED',
      details: (err as Error).message,
    });
  }
});

export default router;
