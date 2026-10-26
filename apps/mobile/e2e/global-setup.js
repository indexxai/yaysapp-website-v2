const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
module.exports = async () => {
  const env = { ...process.env, STACK_MONGO_PORT: '27130', STACK_REDIS_PORT: '6430', STACK_API_PORT: '4130', STACK_DB: 'mobile_e2e' };
  const child = spawn('node', [path.resolve(__dirname, '../../../infra/test-stack.mjs')], { env, stdio: 'ignore', detached: true });
  child.unref();
  fs.writeFileSync(path.join(os.tmpdir(), 'yays-mobile-stack.pid'), String(child.pid));
  for (let i = 0; i < 240; i++) {
    try { const r = await fetch('http://127.0.0.1:4130/v1/health'); if (r.ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('test stack did not start');
};
