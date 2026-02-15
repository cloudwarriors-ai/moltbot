import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync } from 'node:fs';

const BIGHEAD = process.env.BIGHEAD_API_URL || 'http://bighead:8000';
const ZW2 = process.env.ZW2_URL;
const db = new DatabaseSync('/root/.openclaw/data/zw2-extractions.db');

// =====================================================================
// REQUIRED FIELDS — every field the ZW2 API needs for a complete order.
// Used to grade transcript completeness BEFORE any followups.
// =====================================================================
const REQUIRED_FIELDS = {
  customer_info: [
    'order_name', 'order_type', 'company_name', 'company_address',
    'company_website', 'decision_maker_name', 'decision_maker_title',
    'decision_maker_email', 'decision_maker_phone',
    'billing_same_as_decision_maker', 'billing_contact_name',
    'billing_contact_email', 'billing_contact_phone'
  ],
  zp_license: ['zoom_phone_licenses', 'common_area_licenses'],
  zp_location: ['sites', 'foreign_port_request', 'international_deployment'],
  zp_features: ['auto_receptionists_with_ivr', 'call_queues'],
  zp_hardware: ['physical_phones_in_use', 'reprovisioning_needed', 'handset_reprovisioning_count'],
  zcc: [
    'zcc_intent', 'zcc_instance', 'zcc_agents_supervisors',
    'voice_channel_included', 'voice_flows', 'voice_queues',
    'webchat_channel_needed'
  ],
  wfo: ['workforce_management_included', 'quality_management_included', 'ai_expert_assist_included'],
  additions: ['sso_needed', 'marketplace_apps_needed'],
  wrapup: ['go_live_events']
};

// =====================================================================
// TEST ANSWERS — sourced from the reference SOW PDF.
// These are the correct values for fields the transcript doesn't cover.
// In production, Rebecca would ask the customer live.
// =====================================================================
const TEST_ANSWERS = {
  customer_info: {
    order_name: 'Empire Auto Partners (ZP + ZCC)',
    company_address: '15 Jackson Rd., Totowa, New Jersey',
    company_website: 'https://www.empireautoparts.com',
    decision_maker_phone: '9737724206',
    billing_same_as_decision_maker: true,
    billing_contact_name: 'Charles Hollien',
    billing_contact_email: 'chollien@empireautoparts.com',
    billing_contact_phone: '9737724206',
  },
  zp_license: {
    common_area_licenses: 0,
  },
  zp_hardware: {
    physical_phones_in_use: true,
    reprovisioning_needed: false,
    handset_reprovisioning_count: 0,
  },
  wrapup: {
    go_live_events: [
      { date: '2026-04-06', type: 'zoom_phone' },
      { date: '2026-05-04', type: 'zoom_contact_center' },
    ],
  },
};

const report = [];
const rpt = (line) => { report.push(line); console.log(line); };

// =====================================================================
// STEP 1: Fresh extraction from transcript
// =====================================================================
rpt('╔══════════════════════════════════════════════════════════════╗');
rpt('║  EMPIRE AUTO PARTNERS — E2E TRANSCRIPT-TO-SOW TEST         ║');
rpt('╚══════════════════════════════════════════════════════════════╝\n');

rpt('=== STEP 1: INITIAL EXTRACTION ===');
const transcript = readFileSync(
  '/root/.openclaw/workspace/memory/transcript-simulation/Empire Auto Partners (ZP + ZCC)/Simulated Presales Call - Empire Auto Partners.txt',
  'utf-8'
);
rpt(`Transcript length: ${transcript.length} chars`);

const extRes = await fetch(`${BIGHEAD}/api/analyze/transcript`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ text: transcript }),
});
const extData = await extRes.json();
const CONV = extData.conversation_id;
let ed = extData.extracted_data;

rpt(`Conversation: ${CONV}`);
rpt(`Rebecca found: ${(ed.missing_fields || []).length} fields she flagged as missing\n`);

// =====================================================================
// STEP 2: TRANSCRIPT QUALITY REPORT
// Grade every required field: was it in the transcript (non-null)?
// =====================================================================
rpt('=== STEP 2: TRANSCRIPT QUALITY REPORT ===');
rpt('Grading transcript completeness against all required ZW2 fields...\n');

const transcriptPresent = [];
const transcriptMissing = [];

for (const [section, fields] of Object.entries(REQUIRED_FIELDS)) {
  for (const field of fields) {
    const sectionData = ed[section] || {};
    const value = sectionData[field];
    const isPresent = value !== null && value !== undefined;

    if (isPresent) {
      transcriptPresent.push({ section, field, value });
    } else {
      const hasAnswer = TEST_ANSWERS[section]?.[field] !== undefined;
      transcriptMissing.push({ section, field, hasAnswer });
    }
  }
}

// Special check: go_live_events dates
const goLive = ed.wrapup?.go_live_events;
if (Array.isArray(goLive)) {
  const hasDates = goLive.every(e => e.date !== null);
  if (!hasDates && !transcriptMissing.some(m => m.field === 'go_live_events')) {
    transcriptMissing.push({ section: 'wrapup', field: 'go_live_events (dates missing)', hasAnswer: true });
    const idx = transcriptPresent.findIndex(p => p.field === 'go_live_events');
    if (idx >= 0) transcriptPresent.splice(idx, 1);
  }
}

const total = transcriptPresent.length + transcriptMissing.length;
const pct = ((transcriptPresent.length / total) * 100).toFixed(1);

rpt(`┌─────────────────────────────────────────────────────────────┐`);
rpt(`│  TRANSCRIPT COMPLETENESS: ${transcriptPresent.length}/${total} fields (${pct}%)${pct < 70 ? '  ⚠️  DEFICIENT' : ''}          │`);
rpt(`└─────────────────────────────────────────────────────────────┘`);

if (transcriptMissing.length > 0) {
  rpt(`\n⚠️  TRANSCRIPT IS MISSING ${transcriptMissing.length} REQUIRED FIELDS:`);
  rpt('These fields were NEVER discussed in the presales call.\n');
  rpt('  Section              │ Field                          │ Source');
  rpt('  ─────────────────────┼────────────────────────────────┼──────────────');
  for (const m of transcriptMissing) {
    const sec = m.section.padEnd(20);
    const fld = m.field.padEnd(30);
    const src = m.hasAnswer ? 'REF SOW' : 'UNKNOWN';
    rpt(`  ${sec} │ ${fld} │ ${src}`);
  }
  rpt('');
  rpt('In production, Rebecca would ask the customer for these on the call.');
  rpt('For this test, we supply answers from the reference SOW.\n');
}

rpt(`Fields successfully extracted from transcript:`);
for (const p of transcriptPresent) {
  const val = typeof p.value === 'object' ? JSON.stringify(p.value) : String(p.value);
  const display = val.length > 50 ? val.slice(0, 47) + '...' : val;
  rpt(`  ✓ ${p.section}.${p.field} = ${display}`);
}
rpt('');

// =====================================================================
// STEP 3: Save initial extraction to DB
// =====================================================================
rpt('=== STEP 3: SAVE INITIAL EXTRACTION ===');
const existing = db.prepare('SELECT id FROM extractions WHERE conversation_id = ?').get(CONV);
if (!existing) {
  db.prepare('INSERT INTO extractions (conversation_id, customer_name, order_type, extracted_data, missing_fields, confidence_notes, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(CONV, ed.customer_info?.company_name || null, ed.customer_info?.order_type || null,
      JSON.stringify(ed), JSON.stringify(ed.missing_fields || []),
      JSON.stringify(extData.confidence_notes || []), new Date().toISOString());
}
rpt(`Saved. conv: ${CONV}`);

// =====================================================================
// STEP 4: Technical clarifications (AR/CQ split, types)
// =====================================================================
rpt('\n=== STEP 4: TECHNICAL CLARIFICATIONS ===');
const f1 = await fetch(`${BIGHEAD}/api/analyze/followup`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    conversation_id: CONV,
    message: 'Clarify: 1) The 19 ARs and call queues — the SOW shows 19 total combined. You returned 19 for each. What is the correct split? If unclear, use auto_receptionists_with_ivr=1 and call_queues=18 (total 19). 2) common_area_licenses — if not mentioned in transcript, use 0. 3) foreign_port_request needs to be an integer (0), not bool. Return corrected fields as JSON.'
  })
});
const f1d = await f1.json();
const f1fixes = Object.keys(f1d.extracted_data).filter(k => k !== 'missing_fields');
rpt(`Rebecca corrected: ${f1fixes.join(', ')}`);

// Merge
for (const [section, fields] of Object.entries(f1d.extracted_data)) {
  if (section !== 'missing_fields' && ed[section] && typeof fields === 'object' && !Array.isArray(fields)) {
    Object.assign(ed[section], fields);
  }
}

db.prepare('UPDATE extractions SET extracted_data = ?, missing_fields = ?, followup_count = followup_count + 1 WHERE conversation_id = ?')
  .run(JSON.stringify(ed), JSON.stringify(f1d.extracted_data.missing_fields || ed.missing_fields || []), CONV);

// =====================================================================
// STEP 5: Supply customer responses for transcript gaps
// =====================================================================
rpt('\n=== STEP 5: CUSTOMER RESPONSES (from reference SOW) ===');

const missingFields = f1d.extracted_data.missing_fields || ed.missing_fields || [];
const answerLines = [];
const answeredFields = new Set();

// First: answer Rebecca's explicit questions
for (const mf of missingFields) {
  const answer = TEST_ANSWERS[mf.section]?.[mf.field];
  if (answer !== undefined) {
    const val = typeof answer === 'object' ? JSON.stringify(answer) : String(answer);
    answerLines.push(`- "${mf.question}" → ${val}`);
    answeredFields.add(`${mf.section}.${mf.field}`);
  }
}

// Second: supply any other fields we know are null
for (const [section, fields] of Object.entries(TEST_ANSWERS)) {
  for (const [field, value] of Object.entries(fields)) {
    const key = `${section}.${field}`;
    if (answeredFields.has(key)) continue;
    const edSection = ed[section] || {};
    if (edSection[field] === null || edSection[field] === undefined) {
      const val = typeof value === 'object' ? JSON.stringify(value) : String(value);
      answerLines.push(`- ${field}: ${val}`);
      answeredFields.add(key);
    }
  }
}

rpt(`Supplying ${answerLines.length} customer answers to Rebecca`);

const customerMsg = `The customer (Charles Hollien) provided these answers to your questions:\n\n${answerLines.join('\n')}\n\nPlease incorporate these into the extracted data and return the updated JSON with all fields filled in.`;

const f2 = await fetch(`${BIGHEAD}/api/analyze/followup`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ conversation_id: CONV, message: customerMsg })
});
const f2d = await f2.json();
const f2mf = f2d.extracted_data.missing_fields || [];
rpt(`After customer answers: ${f2mf.length} still missing`);

// Merge
for (const [section, fields] of Object.entries(f2d.extracted_data)) {
  if (section !== 'missing_fields' && section !== 'confidence_notes' && typeof fields === 'object' && !Array.isArray(fields)) {
    if (!ed[section]) ed[section] = {};
    Object.assign(ed[section], fields);
  }
}
ed.missing_fields = f2mf;

db.prepare('UPDATE extractions SET extracted_data = ?, missing_fields = ?, followup_count = followup_count + 1 WHERE conversation_id = ?')
  .run(JSON.stringify(ed), JSON.stringify(f2mf), CONV);

// Save final extract to file for inspection
writeFileSync('/tmp/empire-final-extract.json', JSON.stringify({ extracted_data: ed, conversation_id: CONV }, null, 2));

// =====================================================================
// STEP 6: Submit to ZW2
// =====================================================================
rpt('\n=== STEP 6: SUBMIT TO ZW2 ===');
const loginRes = await fetch(`${ZW2}/api/v1/auth/login/`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: process.env.ZW2_USERNAME, password: process.env.ZW2_PASSWORD, terms_accepted: true })
});
const tok = await loginRes.json();
const h = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tok.access_token}` };

const cr = await fetch(`${ZW2}/api/v1/orders/`, { method: 'POST', headers: h, body: '{}' });
const order = await cr.json();
rpt(`Order created: #${order.id}`);
db.prepare('UPDATE extractions SET order_id = ? WHERE conversation_id = ?').run(order.id, CONV);

const ci = ed.customer_info;
const sections = [
  ['customer-info', { order_name: ci.order_name, order_type: ci.order_type, company_name: ci.company_name, company_address: ci.company_address, company_website: ci.company_website, decision_maker_name: ci.decision_maker_name, decision_maker_title: ci.decision_maker_title, decision_maker_email: ci.decision_maker_email, decision_maker_phone: ci.decision_maker_phone, billing_same_as_decision_maker: ci.billing_same_as_decision_maker, billing_contact_name: ci.billing_contact_name, billing_contact_email: ci.billing_contact_email, billing_contact_phone: ci.billing_contact_phone }],
  ['zp-license', ed.zp_license],
  ['zp-location', { ...ed.zp_location, countries_deployed: ed.zp_location?.international_deployment ? ed.zp_location.countries_deployed : [], foreign_port_request: typeof ed.zp_location?.foreign_port_request === 'boolean' ? 0 : (ed.zp_location?.foreign_port_request || 0) }],
  ['zp-features', { auto_receptionists_with_ivr: ed.zp_features?.auto_receptionists_with_ivr, call_queues: ed.zp_features?.call_queues, ata_devices_needed: ed.zp_features?.ata_devices_needed || false, paging_zone_needed: ed.zp_features?.paging_zone_needed || false, paging_integration_needed: ed.zp_features?.paging_integration_needed || false }],
  ['zp-hardware', ed.zp_hardware],
  ['zp-sbc-pbx', { byoc: ed.zp_sbc_pbx?.byoc || false, sbcs_needed: ed.zp_sbc_pbx?.sbcs_needed || false, pbx_needed: ed.zp_sbc_pbx?.pbx_needed || false }],
  ['zcc', ed.zcc],
  ['zcc-workplace-optimization', ed.wfo],
  ['additions', { sso_needed: ed.additions?.sso_needed, sso_type: ed.additions?.sso_type, marketplace_apps_needed: ed.additions?.marketplace_apps_needed, marketplace_apps: ed.additions?.marketplace_apps, cti_integration_needed: ed.additions?.cti_integration_needed || false }],
  ['wrapup-questions', { go_live_events: ed.wrapup?.go_live_events, on_site_support_needed: ed.wrapup?.on_site_support_needed || false }]
];

let okCount = 0;
const sectionResults = [];
for (const [path, body] of sections) {
  const r = await fetch(`${ZW2}/api/v1/orders/${order.id}/${path}/`, { method: 'POST', headers: h, body: JSON.stringify(body) });
  const ok = r.status >= 200 && r.status < 300;
  if (ok) {
    okCount++;
    sectionResults.push({ path, status: 'OK', attempt: 1 });
  } else {
    const err = await r.text();
    rpt(`  ${path}: ${r.status} FAIL — ${err}`);
    // Route error back to Rebecca
    const fix = await fetch(`${BIGHEAD}/api/analyze/followup`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversation_id: CONV, message: `The ZW2 API rejected section "${path}" with error: ${err}. Please provide corrected values as JSON.` })
    });
    const fixd = await fix.json();
    const mergedBody = { ...body };
    for (const vals of Object.values(fixd.extracted_data)) {
      if (typeof vals === 'object' && vals !== null && !Array.isArray(vals)) Object.assign(mergedBody, vals);
    }
    const r2 = await fetch(`${ZW2}/api/v1/orders/${order.id}/${path}/`, { method: 'POST', headers: h, body: JSON.stringify(mergedBody) });
    if (r2.status >= 200 && r2.status < 300) {
      okCount++;
      sectionResults.push({ path, status: 'RETRY OK', attempt: 2 });
      rpt(`  ${path}: RETRY OK`);
    } else {
      sectionResults.push({ path, status: `FAIL ${r2.status}`, attempt: 2 });
      rpt(`  ${path}: RETRY FAIL ${r2.status} ${await r2.text()}`);
    }
  }
}
rpt(`Sections: ${okCount}/10`);

// Generate SOW
const sow = await fetch(`${ZW2}/api/v1/orders/${order.id}/generate-sow/`, { method: 'POST', headers: h, body: '{}' });
const sowOk = sow.status >= 200 && sow.status < 300;
rpt(`SOW: ${sowOk ? 'OK' : `FAIL ${await sow.text()}`}`);

// =====================================================================
// STEP 7: Complete session
// =====================================================================
rpt('\n=== STEP 7: COMPLETE SESSION ===');
db.prepare("UPDATE extractions SET status = 'completed', completed_at = ? WHERE conversation_id = ?")
  .run(new Date().toISOString(), CONV);

const session = db.prepare('SELECT id, conversation_id, order_id, customer_name, order_type, status, followup_count, started_at, completed_at FROM extractions WHERE conversation_id = ?').get(CONV);

// =====================================================================
// FINAL REPORT
// =====================================================================
rpt('\n╔══════════════════════════════════════════════════════════════╗');
rpt('║                    FINAL TEST REPORT                        ║');
rpt('╚══════════════════════════════════════════════════════════════╝\n');

rpt('CUSTOMER: Empire Auto Parts');
rpt(`ORDER:    #${order.id}`);
rpt(`CONV:     ${CONV}`);
rpt(`FOLLOWUPS: ${session.followup_count}`);
rpt('');

// Transcript quality summary
rpt('┌──────────────────────────────────────────────────────────────┐');
rpt(`│  TRANSCRIPT QUALITY: ${pct}% complete (${transcriptPresent.length}/${total} fields)${' '.repeat(Math.max(0, 17 - pct.length))}│`);
if (transcriptMissing.length > 0) {
  rpt(`│  STATUS: DEFICIENT — ${transcriptMissing.length} fields missing from transcript       │`);
} else {
  rpt(`│  STATUS: COMPLETE — all required fields found in transcript  │`);
}
rpt('└──────────────────────────────────────────────────────────────┘');

if (transcriptMissing.length > 0) {
  rpt('\nFields NOT in transcript (supplied from reference SOW):');
  for (const m of transcriptMissing) {
    const answer = TEST_ANSWERS[m.section]?.[m.field];
    const val = answer !== undefined
      ? (typeof answer === 'object' ? JSON.stringify(answer) : String(answer))
      : 'N/A';
    rpt(`  ✗ ${m.section}.${m.field} → ${val}`);
  }
}

rpt('\nAPI Submission Results:');
for (const sr of sectionResults) {
  const icon = sr.status.includes('OK') ? '✓' : '✗';
  const retry = sr.attempt > 1 ? ` (attempt ${sr.attempt})` : '';
  rpt(`  ${icon} ${sr.path}: ${sr.status}${retry}`);
}
rpt(`\nSections: ${okCount}/10 | SOW: ${sowOk ? 'Generated' : 'FAILED'}`);

rpt(`\n${'═'.repeat(62)}`);
rpt(`RESULT: ${okCount === 10 && sowOk ? 'PASS' : 'FAIL'} — Order #${order.id}`);
rpt(`${'═'.repeat(62)}`);

// Write report to file
writeFileSync('/tmp/empire-e2e-report.txt', report.join('\n'));
rpt('\nReport saved to /tmp/empire-e2e-report.txt');
