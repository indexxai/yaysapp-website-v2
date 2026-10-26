import { spawn, execSync } from 'child_process';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import * as net from 'net';
import * as path from 'path';
import { MongoClient } from 'mongodb';

/** Starts a throwaway MongoDB replica set and Redis on free ports for the e2e run. */
const freePort = () => new Promise<number>((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => res(p)); }); });
const which = (b: string) => { try { return execSync(`command -v ${b}`).toString().trim(); } catch { return ''; } };

export default async function () {
  const mongod = process.env.MONGOD_BIN || which('mongod') || '/home/claude/tools/mongo/bin/mongod';
  const redis = process.env.REDIS_BIN || which('redis-server');
  if (!redis) throw new Error('redis-server not found (set REDIS_BIN)');
  const dir = mkdtempSync(path.join(tmpdir(), 'yays-e2e-'));
  const [mp, rp] = [await freePort(), await freePort()];
  const m = spawn(mongod, ['--replSet', 'rs0', '--bind_ip', '127.0.0.1', '--port', String(mp), '--dbpath', dir, '--quiet', '--setParameter', 'diagnosticDataCollectionEnabled=false'], { stdio: 'ignore', detached: true });
  const r = spawn(redis, ['--port', String(rp), '--save', '', '--appendonly', 'no'], { stdio: 'ignore', detached: true });
  const uri = `mongodb://127.0.0.1:${mp}/?directConnection=true`;
  let client: MongoClient | undefined;
  for (let i = 0; i < 60 && !client; i++) { try { client = await new MongoClient(uri, { serverSelectionTimeoutMS: 1000 }).connect(); } catch { await new Promise((x) => setTimeout(x, 250)); } }
  if (!client) throw new Error('mongod did not start');
  await client.db('admin').command({ replSetInitiate: { _id: 'rs0', members: [{ _id: 0, host: `127.0.0.1:${mp}` }] } });
  for (let i = 0; i < 80; i++) {
    const s = await client.db('admin').command({ replSetGetStatus: 1 }).catch(() => null);
    if (s?.members?.some((x: { stateStr: string }) => x.stateStr === 'PRIMARY')) break;
    await new Promise((x) => setTimeout(x, 250));
  }
  await client.close();
  const env = { MONGO_URI: `mongodb://127.0.0.1:${mp}/?replicaSet=rs0`, REDIS_URL: `redis://127.0.0.1:${rp}`, pids: [m.pid, r.pid], dir };
  writeFileSync(path.join(tmpdir(), 'yays-e2e-env.json'), JSON.stringify(env));
  m.unref(); r.unref();
}
