// Stand-in for Discord's OAuth2 endpoints, to test "Log in with Discord" locally.
//   node test/mock-discord.mjs   (127.0.0.1:40018)  then start NodeBB with CR_DISCORD_BASE=http://127.0.0.1:40018
// MOCK_DISCORD_ID / MOCK_DISCORD_EMAIL choose who "logs in".
import http from 'node:http';
const port = Number(process.env.MOCK_DISCORD_PORT || 40018);
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/oauth2/authorize') {
    // Pretend the person clicked "Authorize": straight back to the forum with a code.
    const back = new URL(url.searchParams.get('redirect_uri'));
    back.searchParams.set('code', 'mock-code');
    back.searchParams.set('state', url.searchParams.get('state') || '');
    res.writeHead(302, { location: back.toString() });
    return res.end();
  }
  res.writeHead(200, { 'content-type': 'application/json' });
  if (url.pathname === '/api/oauth2/token') return res.end(JSON.stringify({ access_token: 'mock-access', token_type: 'Bearer', expires_in: 3600 }));
  if (url.pathname === '/api/users/@me') {
    return res.end(JSON.stringify({
      id: process.env.MOCK_DISCORD_ID || '424242424242',
      username: 'real_discord_name', global_name: 'Real Name',
      email: process.env.MOCK_DISCORD_EMAIL || 'discord-user@example.com', verified: true,
    }));
  }
  res.end('{}');
}).listen(port, '127.0.0.1', () => console.log(`mock Discord on http://127.0.0.1:${port}`));
