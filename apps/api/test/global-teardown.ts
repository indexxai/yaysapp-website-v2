import { readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
export default async function () {
  const env = JSON.parse(readFileSync(path.join(tmpdir(), 'yays-e2e-env.json'), 'utf8')) as { pids: number[]; dir: string };
  for (const pid of env.pids) { try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ } }
  await new Promise((r) => setTimeout(r, 500));
  rmSync(env.dir, { recursive: true, force: true });
}
