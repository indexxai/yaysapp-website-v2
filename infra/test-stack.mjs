// Starts everything the web and mobile end-to-end tests need: MongoDB replica set, Redis and the built API.
// Stays in the foreground; Playwright stops it when the run ends.
import { spawn, execSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const apiDir = path.resolve(import.meta.dirname, '../apps/api');
const { MongoClient } = require(require.resolve('mongodb', { paths: [apiDir] }));

const which = (b) => { try { return execSync(`command -v ${b}`).toString().trim(); } catch { return ''; } };
const mongod = process.env.MONGOD_BIN || which('mongod') || '/home/claude/tools/mongo/bin/mongod';
const redisBin = process.env.REDIS_BIN || which('redis-server');
const MP = Number(process.env.STACK_MONGO_PORT || 27120), RP = Number(process.env.STACK_REDIS_PORT || 6420), AP = Number(process.env.STACK_API_PORT || 4100);
const DBNAME = process.env.STACK_DB || 'web_e2e';
// Earlier runs that were killed outright leave their data behind; clear anything older than an hour.
for (const d of readdirSync(tmpdir())) {
  if (!d.startsWith('yays-web-e2e-')) continue;
  const p = path.join(tmpdir(), d);
  try { if (Date.now() - statSync(p).mtimeMs > 3_600_000) rmSync(p, { recursive: true, force: true }); } catch {}
}
const dir = mkdtempSync(path.join(tmpdir(), 'yays-web-e2e-'));
const kids = [];
const run = (cmd, args, opts = {}) => { const c = spawn(cmd, args, { stdio: ['ignore', 'inherit', 'inherit'], ...opts }); kids.push(c); return c; };
const stop = () => { for (const k of kids) { try { k.kill('SIGTERM'); } catch {} } rmSync(dir, { recursive: true, force: true }); process.exit(0); };
process.on('SIGTERM', stop); process.on('SIGINT', stop); process.on('SIGHUP', stop);
process.on('exit', () => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

run(mongod, ['--replSet', 'rs0', '--bind_ip', '127.0.0.1', '--port', String(MP), '--dbpath', path.join(dir), '--quiet', '--setParameter', 'diagnosticDataCollectionEnabled=false'], { stdio: 'ignore' });
run(redisBin, ['--port', String(RP), '--save', '', '--appendonly', 'no'], { stdio: 'ignore' });
let client;
for (let i = 0; i < 80 && !client; i++) { try { client = await new MongoClient(`mongodb://127.0.0.1:${MP}/?directConnection=true`, { serverSelectionTimeoutMS: 500 }).connect(); } catch { await new Promise((r) => setTimeout(r, 250)); } }
await client.db('admin').command({ replSetInitiate: { _id: 'rs0', members: [{ _id: 0, host: `127.0.0.1:${MP}` }] } }).catch(() => {});
for (let i = 0; i < 80; i++) { const s = await client.db('admin').command({ replSetGetStatus: 1 }).catch(() => null); if (s?.members?.some((m) => m.stateStr === 'PRIMARY')) break; await new Promise((r) => setTimeout(r, 250)); }
await client.close();

// LiveKit for calls (voice and video go through it). Optional: without it, calls say they aren't available.
const livekit = process.env.LIVEKIT_BIN || which('livekit-server') || '/home/claude/tools/livekit/livekit-server';
const LKP = Number(process.env.STACK_LIVEKIT_PORT || 7890);
const LK_KEY = 'webe2ekey', LK_SECRET = 'web-e2e-livekit-secret-that-is-long-123456';
const lkEnv = {};
if (existsSync(livekit)) {
  const cfg = path.join(dir, 'livekit.yaml');
  writeFileSync(cfg, [
    `port: ${LKP}`, 'bind_addresses: ["127.0.0.1"]',
    'rtc:', `  tcp_port: ${LKP + 1}`, `  port_range_start: ${LKP + 100}`, `  port_range_end: ${LKP + 200}`, '  use_external_ip: false',
    'keys:', `  ${LK_KEY}: ${LK_SECRET}`,
    'webhook:', `  api_key: ${LK_KEY}`, '  urls:', `    - http://127.0.0.1:${AP}/v1/livekit/webhook`,
    'logging:', '  level: warn',
  ].join('\n'));
  run(livekit, ['--config', cfg, '--node-ip', '127.0.0.1'], { stdio: 'ignore' });
  Object.assign(lkEnv, { LIVEKIT_URL: `ws://127.0.0.1:${LKP}`, LIVEKIT_API_KEY: LK_KEY, LIVEKIT_API_SECRET: LK_SECRET, CALL_RING_SECONDS: process.env.STACK_RING_SECONDS || '8' });
}

run('node', [path.join(apiDir, 'dist/main.js')], { env: {
  ...lkEnv,
  ...process.env, NODE_ENV: 'test', PORT: String(AP), PUBLIC_URL: `http://127.0.0.1:${AP}`, CORS_ORIGINS: process.env.STACK_CORS || 'http://127.0.0.1:3100,http://localhost:3100',
  MONGO_URI: `mongodb://127.0.0.1:${MP}/?replicaSet=rs0`, MONGO_DB: DBNAME, REDIS_URL: `redis://127.0.0.1:${RP}`,
  JWT_SECRET: 'web-e2e-secret-that-is-long-enough-123456', WEB_URL: 'http://127.0.0.1:3100', TEST_OUTBOX: '1', OTP_RESEND_SECONDS: '5', OTP_IP_PER_HOUR: process.env.STACK_OTP_IP_PER_HOUR || '1000', LOG_LEVEL: 'warn',
  LOCAL_STORAGE_DIR: path.join(dir, 'storage'), ACCESS_TTL_SECONDS: '60',
} });
