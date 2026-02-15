// Test the full history ingest pipeline against the ZoomWarriors Support Channel
// This simulates what happens when the bot is invited to a channel

const channelJid = process.argv[2] || 'a0063359a37241eab617cab1ee6c9998@conference.xmpp.zoom.us';
const channelName = process.argv[3] || 'ZoomWarriors Support Channel';

const { ZOOM_REPORT_CLIENT_ID, ZOOM_REPORT_CLIENT_SECRET, ZOOM_REPORT_ACCOUNT_ID, ZOOM_REPORT_USER } = process.env;

if (!ZOOM_REPORT_CLIENT_ID) {
  console.error('Missing ZOOM_REPORT_CLIENT_ID');
  process.exit(1);
}

console.log(`Channel: ${channelName} (${channelJid})`);
console.log(`Report user: ${ZOOM_REPORT_USER}`);

// Dynamic import of the history module (TypeScript via jiti)
const { createJiti } = await import('jiti');
const jiti = createJiti(import.meta.url, { interopDefault: true });
const { fetchAndTrainFromHistory } = jiti('/app/extensions/zoom/src/history.ts');

// Simple logger
const log = {
  info: (msg) => console.log(`[INFO] ${msg}`),
  warn: (msg) => console.warn(`[WARN] ${msg}`),
  error: (msg) => console.error(`[ERROR] ${msg}`),
  debug: (msg) => console.log(`[DEBUG] ${msg}`),
};

// Dummy creds (not used — history.ts uses report app env vars)
const creds = {
  clientId: process.env.ZOOM_CLIENT_ID,
  clientSecret: process.env.ZOOM_CLIENT_SECRET,
  accountId: process.env.ZOOM_ACCOUNT_ID,
  botJid: process.env.ZOOM_BOT_JID,
};

await fetchAndTrainFromHistory(channelJid, channelName, creds, log);

console.log('\nDone. Check workspace/memory/customers/*/training.md');
