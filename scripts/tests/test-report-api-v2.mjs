// Test the newer Team Chat report API endpoints using granular scopes

const { ZOOM_REPORT_CLIENT_ID, ZOOM_REPORT_CLIENT_SECRET, ZOOM_REPORT_ACCOUNT_ID } = process.env;

if (!ZOOM_REPORT_CLIENT_ID || !ZOOM_REPORT_CLIENT_SECRET) {
  console.error('Missing ZOOM_REPORT_CLIENT_ID or ZOOM_REPORT_CLIENT_SECRET');
  process.exit(1);
}

// Get token
const basic = Buffer.from(ZOOM_REPORT_CLIENT_ID + ':' + ZOOM_REPORT_CLIENT_SECRET).toString('base64');
const tokenRes = await fetch(
  `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${ZOOM_REPORT_ACCOUNT_ID}`,
  { method: 'POST', headers: { 'Authorization': 'Basic ' + basic } }
);
const tok = await tokenRes.json();
if (!tok.access_token) { console.error('Token error:', JSON.stringify(tok)); process.exit(1); }

const scopes = tok.scope?.split(' ').filter(s => s.includes('report') || s.includes('chat') || s.includes('team'));
console.log('Scopes:', scopes);

const h = { 'Authorization': 'Bearer ' + tok.access_token };
const to = new Date().toISOString().slice(0, 10);
const from = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

// Try multiple endpoint variations
const endpoints = [
  // Newer team_chat path
  `/v2/team_chat/report/sessions?from=${from}&to=${to}&page_size=10`,
  // With user email
  `/v2/team_chat/users/cw-dev@cloudwarriors.ai/sessions?from=${from}&to=${to}&page_size=10`,
  // Chat messages for a user in a channel
  `/v2/chat/users/cw-dev@cloudwarriors.ai/messages?to_channel=a0063359a37241eab617cab1ee6c9998&from=${from}&to=${to}&page_size=10`,
  // Newer team_chat messages
  `/v2/team_chat/users/cw-dev@cloudwarriors.ai/messages?to_channel=a0063359a37241eab617cab1ee6c9998&from=${from}&to=${to}&page_size=10`,
  // Report chat sessions (legacy, likely fails)
  `/v2/report/chat/sessions?from=${from}&to=${to}&page_size=10`,
];

for (const ep of endpoints) {
  console.log(`\n--- GET ${ep.slice(0, 80)}...`);
  const res = await fetch(`https://api.zoom.us${ep}`, { headers: h });
  console.log(`Status: ${res.status}`);
  const body = await res.text();
  console.log(body.slice(0, 300));
}
