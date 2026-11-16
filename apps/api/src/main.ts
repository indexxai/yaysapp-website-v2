import { existsSync } from 'node:fs';
import path from 'node:path';
import { createApp } from './app';

// Settings from apps/api/.env when it's there (local development). Variables already set, as on a server, win.
const envFile = path.resolve(__dirname, '../.env');
if (existsSync(envFile)) (process as unknown as { loadEnvFile: (p: string) => void }).loadEnvFile(envFile);

createApp()
  .then(async ({ app, config, log, shutdown }) => {
    for (const sig of ['SIGTERM', 'SIGINT'] as const) process.once(sig, () => { log.info({ sig }, 'shutting down'); void shutdown().then(() => process.exit(0)); });
    await app.listen(config.PORT, '0.0.0.0');
    log.info({ port: config.PORT, env: config.NODE_ENV }, 'YaysApp API listening');
  })
  .catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
