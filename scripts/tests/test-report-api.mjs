// Test the Zoom Report API using the S2S admin app credentials

const { ZOOM_REPORT_CLIENT_ID, ZOOM_REPORT_CLIENT_SECRET, ZOOM_REPORT_ACCOUNT_ID } = process.env;

if (!ZOOM_REPORT_CLIENT_ID || !ZOOM_REPORT_CLIENT_SECRET) {
  console.error('Missing ZOOM_REPORT_CLIENT_ID or ZOOM_REPORT_CLIENT_SECRET');
  process.exit(1);
}

console.log('Report app client ID:', ZOOM_REPORT_CLIENT_ID.slice(0, 10) + '...');
console.log('Account ID:', ZOOM_REPORT_ACCOUNT_ID);

// Get token via account_credentials grant
const basic = Buffer.from(ZOOM_REPORT_CLIENT_ID + ':' + ZOOM_REPORT_CLIENT_SECRET).toString('base64');
const tokenRes = await fetch(
  `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${ZOOM_REPORT_ACCOUNT_ID}`,
  { method: 'POST', headers: { 'Authorization': 'Basic ' + basic } }
);
const tok = await tokenRes.json();

if (!tok.access_token) {
  console.error('Token error:', JSON.stringify(tok, null, 2));
  process.exit(1);
}

const scopes = tok.scope?.split(' ').filter(s => s.includes('report') || s.includes('chat'));
console.log('Got token. Relevant scopes:', scopes);

// List chat sessions
const to = new Date().toISOString().slice(0, 10);
const from = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
console.log(`\nFetching sessions: ${from} → ${to}`);

const res = await fetch(
  `https://api.zoom.us/v2/report/chat/sessions?from=${from}&to=${to}&page_size=50`,
  { headers: { 'Authorization': 'Bearer ' + tok.access_token } }
);
console.log('Status:', res.status);

const body = await res.json();
if (res.status !== 200) {
  console.error('Error:', JSON.stringify(body, null, 2));
  process.exit(1);
}

const sessions = body.sessions || [];
console.log(`Sessions found: ${sessions.length}`);

for (const s of sessions.slice(0, 20)) {
  console.log(`  ${(s.type || '?').padEnd(10)} | ${(s.name || 'unnamed').padEnd(35)} | ${s.session_id}`);
}

// Try to find ZoomWarriors Support Channel
const target = sessions.find(s =>
  s.name?.toLowerCase().includes('zoomwarriors') ||
  s.name?.toLowerCase().includes('support')
);

if (target) {
  console.log(`\n=== Found target: ${target.name} ===`);
  console.log(`Session ID: ${target.session_id}`);

  const msgRes = await fetch(
    `https://api.zoom.us/v2/report/chat/sessions/${target.session_id}?from=${from}&to=${to}&page_size=20`,
    { headers: { 'Authorization': 'Bearer ' + tok.access_token } }
  );
  console.log('Messages status:', msgRes.status);
  const msgBody = await msgRes.json();

  const msgs = msgBody.messages || [];
  console.log(`Messages: ${msgs.length}`);

  for (const m of msgs.slice(0, 10)) {
    const text = (m.message || '').slice(0, 80);
    console.log(`  [${m.date_time}] ${m.sender || 'unknown'}: ${text}`);
  }
}
