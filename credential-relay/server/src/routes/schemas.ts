import { z } from 'zod';

export const deviceRegistrationSchema = z.object({
  macAddress: z.string().min(1, 'MAC address is required'),
  hostname: z.string().min(1, 'Hostname is required'),
  alias: z.string().optional(),
});

export const createCredentialSchema = z.object({
  serviceName: z.string().min(1, 'Service name is required'),
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
});

export const updateCredentialSchema = z.object({
  serviceName: z.string().min(1).optional(),
  username: z.string().min(1).optional(),
  password: z.string().min(1).optional(),
}).refine((data) => Object.keys(data).length > 0, {
  message: 'At least one field must be provided',
});

export const createRequestSchema = z.object({
  deviceId: z.string().uuid('Invalid device ID'),
  credentialId: z.string().uuid('Invalid credential ID'),
});

export const resolveRequestSchema = z.object({
  action: z.enum(['approve', 'reject']),
  resolvedBy: z.string().min(1, 'Resolver identity is required'),
});
