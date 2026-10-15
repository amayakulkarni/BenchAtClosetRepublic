// Creates (or prints the existing) NodeBB Write API master token for the bridge.
// Run from the NodeBB folder, as the user NodeBB runs as:  node /path/to/nodebb-master-token.cjs cr-bridge
const path = require('path');
const nbb = (p) => require(path.join(process.cwd(), p));
(async () => {
  const nconf = require(path.join(process.cwd(), 'node_modules/nconf'));
  nconf.argv().env({ separator: '__' });
  nbb('src/prestart').loadConfig(path.join(process.cwd(), 'config.json'));
  const db = nbb('src/database');
  await db.init();
  const tokens = nbb('src/api/utils').tokens;
  const description = process.argv[2] || 'cr-bridge';
  const existing = (await tokens.list()).find((t) => t.description === description);
  console.log(existing ? existing.token : await tokens.generate({ uid: 0, description }));
  await db.close();
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
