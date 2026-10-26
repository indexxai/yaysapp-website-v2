// Initiates a single-node replica set if it isn't one yet, then waits for PRIMARY.
const { MongoClient } = require(require.resolve('mongodb', { paths: [__dirname + '/../apps/api'] }));
(async () => {
  const uri = process.argv[2];
  const port = Number(new URL(uri).port);
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });
  await client.connect();
  const admin = client.db('admin');
  try {
    await admin.command({ replSetGetStatus: 1 });
  } catch (e) {
    if (e.codeName !== 'NotYetInitialized') throw e;
    await admin.command({ replSetInitiate: { _id: 'rs0', members: [{ _id: 0, host: `127.0.0.1:${port}` }] } });
  }
  for (let i = 0; i < 60; i++) {
    const s = await admin.command({ replSetGetStatus: 1 }).catch(() => null);
    if (s && s.members.some((m) => m.stateStr === 'PRIMARY')) { await client.close(); return; }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('replica set did not become PRIMARY');
})().catch((e) => { console.error(e); process.exit(1); });
