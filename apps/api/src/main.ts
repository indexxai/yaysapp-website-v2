import { createApp } from './app';

createApp()
  .then(async ({ app, config, log, shutdown }) => {
    for (const sig of ['SIGTERM', 'SIGINT'] as const) process.once(sig, () => { log.info({ sig }, 'shutting down'); void shutdown().then(() => process.exit(0)); });
    await app.listen(config.PORT, '0.0.0.0');
    log.info({ port: config.PORT, env: config.NODE_ENV }, 'YaysApp API listening');
  })
  .catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
