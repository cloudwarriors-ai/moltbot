// Test CSV-based history ingest pipeline
// Usage: node /app/tests/test-csv-ingest.mjs <csv-path> [channel-name]

const csvPath = process.argv[2];
const channelName = process.argv[3] || 'ZoomWarriors Support Channel';

if (!csvPath) {
  console.error('Usage: node test-csv-ingest.mjs <csv-path> [channel-name]');
  process.exit(1);
}

console.log(`CSV: ${csvPath}`);
console.log(`Channel: ${channelName}`);

// Dynamic import of the history module (TypeScript via jiti)
const { createJiti } = await import('jiti');
const jiti = createJiti(import.meta.url, { interopDefault: true });
const { trainFromCsvFile } = jiti('/app/extensions/zoom/src/history.ts');

const log = {
  info: (msg) => console.log(`[INFO] ${msg}`),
  warn: (msg) => console.warn(`[WARN] ${msg}`),
  error: (msg) => console.error(`[ERROR] ${msg}`),
  debug: (msg) => console.log(`[DEBUG] ${msg}`),
};

await trainFromCsvFile(csvPath, channelName, log);

console.log('\nDone. Check workspace/memory/customers/*/training.md');
