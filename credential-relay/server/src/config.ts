import { SERVER_PORT } from '@credential-relay/shared';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

interface Config {
  port: number;
  vaultMasterKey: string;
  adminPassword: string;
  jwtSecret: string;
  dbPath: string;
}

let _config: Config | null = null;

export function getConfig(): Config {
  if (!_config) {
    _config = {
      port: parseInt(process.env.PORT || String(SERVER_PORT), 10),
      vaultMasterKey: requireEnv('VAULT_MASTER_KEY'),
      adminPassword: requireEnv('ADMIN_PASSWORD'),
      jwtSecret: requireEnv('JWT_SECRET'),
      dbPath: process.env.DB_PATH || './data/credential-relay.db',
    };
  }
  return _config;
}

// For backwards compat — lazy proxy
export const config: Config = new Proxy({} as Config, {
  get(_target, prop: string) {
    return getConfig()[prop as keyof Config];
  },
});
