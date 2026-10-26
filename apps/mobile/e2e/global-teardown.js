const fs = require('fs'); const os = require('os'); const path = require('path');
module.exports = async () => {
  const pid = Number(fs.readFileSync(path.join(os.tmpdir(), 'yays-mobile-stack.pid'), 'utf8'));
  try { process.kill(pid, 'SIGTERM'); } catch {}
  await new Promise((r) => setTimeout(r, 800));
};
