import { readFileSync } from 'node:fs';

// Load Zoom creds from openclaw config
const config = JSON.parse(readFileSync('/root/.openclaw/openclaw.json', 'utf-8'));
const zoom = config.zoom || config.channels?.zoom || {};

const accountId = zoom.accountId;
const clientId = zoom.clientId;
const clientSecret = zoom.clientSecret;

if (!clientId || !clientSecret) {
  console.error('Missing Zoom credentials in openclaw.json');
  process.exit(1);
}

// Get S2S token
const basic = Buffer.from(clientId + ':' + clientSecret).toString('base64');
const tokenRes = await fetch('https://zoom.us/oauth/token?grant_type=client_credentials', {
  method: 'POST',
  headers: { 'Authorization': 'Basic ' + basic }
});
const tok = await tokenRes.json();
if (!tok.access_token) {
  console.error('Token error:', JSON.stringify(tok));
  process.exit(1);
}
console.log('Got access token');

// Show chat/report scopes
const scopes = tok.scope?.split(' ').filter(s => s.includes('report') || s.includes('chat'));
console.log('Relevant scopes:', scopes);

// Target channel
const channelJid = process.argv[2] || 'a0063359a37241eab617cab1ee6c9998@conference.xmpp.zoom.us';
const channelId = channelJid.split('@')[0];
console.log(`Target channel: ${channelId}`);

// Date range — last 30 days (report API max per request)
const to = new Date().toISOString().slice(0, 10);
const from = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
console.log(`Date range: ${from} → ${to}`);

// Step 1: List chat sessions via report API
console.log('\n=== Step 1: List chat sessions ===');
const sessRes = await fetch(`https://api.zoom.us/v2/report/chat/sessions?from=${from}&to=${to}&page_size=50`, {
  headers: { 'Authorization': 'Bearer ' + tok.access_token }
});
console.log('Status:', sessRes.status);

if (sessRes.status !== 200) {
  const errBody = await sessRes.json();
  console.error('Error:', JSON.stringify(errBody, null, 2));
  process.exit(1);
}

const sessBody = await sessRes.json();
const sessions = sessBody.sessions || [];
console.log(`Sessions found: ${sessions.length}`);

// Find our target channel
const target = sessions.find(s =>
  s.session_id === channelId ||
  s.name?.toLowerCase().includes('zoomwarriors') ||
  s.name?.toLowerCase().includes('support')
);

if (target) {
  console.log(`\nFound target: ${target.name} (${target.session_id})`);

  // Step 2: Get messages from this session
  console.log('\n=== Step 2: Fetch messages ===');
  const msgRes = await fetch(`https://api.zoom.us/v2/report/chat/sessions/${target.session_id}?from=${from}&to=${to}&page_size=50`, {
    headers: { 'Authorization': 'Bearer ' + tok.access_token }
  });
  console.log('Status:', msgRes.status);
  const msgBody = await msgRes.json();

  const msgs = msgBody.messages || [];
  console.log(`Messages returned: ${msgs.length}`);
  console.log(`Next page token: ${msgBody.next_page_token || 'none'}`);

  if (msgs.length > 0) {
    console.log('\nFirst 5 messages:');
    for (const m of msgs.slice(0, 5)) {
      const text = (m.message || '').slice(0, 100);
      console.log(`  [${m.date_time}] ${m.sender}: ${text}`);
    }
  }
} else {
  console.log('\nTarget channel not found in sessions. Showing first 20:');
  for (const s of sessions.slice(0, 20)) {
    console.log(`  ${s.type || '?'} | ${s.name || 'unnamed'} | ${s.session_id}`);
  }
}
