---
name: zw-transcript-order
description: >
  Process presales meeting transcripts into ZoomWarriors orders.
  Uses Rebecca (Bighead AI) to extract structured order data from VTT transcripts,
  validates against API field requirements, fills gaps via multi-turn conversation,
  then submits to ZW2 API and verifies against reference SOW.
  Triggers: /transcript-order [customer], "process transcript for [company]",
  "batch transcript orders", "extract order from transcript".
metadata:
  openclaw:
    emoji: "📝"
---

# Transcript-to-Order Pipeline

Extract order data from presales meeting transcripts using Rebecca, validate, submit to ZW2, and verify against reference SOW.

## References

- `references/api-fields.md` — field definitions, types, choices, and validation rules per section (symlinked from zw-new-order)
- `references/field-mapping-guide.md` — how transcript language maps to API field values
- `references/verification-checklist.md` — checklist for comparing extracted data against reference SOW

## Transcript Repository

Transcripts live in `https://github.com/cloudwarriors-ai/transcript-simulation`.
Each customer folder contains:
- A VTT `.txt` transcript file (the meeting recording)
- A reference SOW `.pdf` file (the expected output to verify against)

## Tools Required

| Tool | Extension | Purpose |
|------|-----------|---------|
| `bighead_analyze_transcript` | bighead | Send transcript text, get extracted order data |
| `bighead_followup` | bighead | Multi-turn: ask about missing/unclear fields |
| `zw2_create_order` | zoomwarriors-write | Create new ZW2 order |
| `zw2_submit_customer_info` | zoomwarriors-write | Submit Section 1 |
| `zw2_submit_zp_license` | zoomwarriors-write | Submit Section 2 |
| `zw2_submit_zp_location` | zoomwarriors-write | Submit Section 3 |
| `zw2_submit_zp_features` | zoomwarriors-write | Submit Section 4 |
| `zw2_submit_zp_hardware` | zoomwarriors-write | Submit Section 5 |
| `zw2_submit_zp_sbc_pbx` | zoomwarriors-write | Submit Section 6 |
| `zw2_submit_zcc` | zoomwarriors-write | Submit Section 7 |
| `zw2_submit_wfo` | zoomwarriors-write | Submit Section 8 |
| `zw2_submit_additions` | zoomwarriors-write | Submit Section 9 |
| `zw2_submit_wrapup` | zoomwarriors-write | Submit Section 10 |
| `zw2_generate_sow` | zoomwarriors-write | Generate SOW document |
| `zw2_download_sow` | zoomwarriors-write | Download SOW PDF |
| `zw2_search_orders` | zoomwarriors | Search existing orders |
| `zw2_get_order` | zoomwarriors | Get order details |
| `exec` | built-in | Clone repo, read files, run commands |

## Single Customer Flow

When the user says `/transcript-order [customer]` or "process transcript for [company]":

### Step 1: Get the Transcript

1. Check if the transcript repo is already cloned in workspace:
   - Look for `memory/transcript-simulation/` directory
   - If not present, clone: `exec git clone https://github.com/cloudwarriors-ai/transcript-simulation memory/transcript-simulation`
   - If present, pull latest: `exec git -C memory/transcript-simulation pull`
2. Find the customer folder matching the name (case-insensitive, fuzzy match)
3. Read the VTT `.txt` transcript file

### Step 2: Extract Order Data via Rebecca

1. Call `bighead_analyze_transcript` with the full transcript text
2. Receive structured JSON with extracted fields organized by section
3. Save the raw extraction to `memory/customers/{slug}/orders/{slug}-transcript-extraction.md`

### Step 3: Validate and Fill Gaps (Rebecca Follow-ups)

For each section in the extracted data, validate against `references/api-fields.md`:

1. Check all required fields are present and non-null
2. Check field types match (strings, ints, bools, arrays)
3. Check choice fields have valid values
4. Check validation rules (e.g., min 1 zoom_phone_license for ZP orders)

For sections with **ambiguous** data (e.g., "two total ARs and call queues combined"):

1. Build a specific question listing the gaps
2. Call `bighead_followup` with the conversation_id and question
3. Merge the response into the extracted data
4. Re-validate
5. Max 3 follow-up rounds per section

### Step 3.5: Handle Missing Contact Info via Rebecca

Presales transcripts rarely contain contact details (email, phone, address). Rebecca's extraction response includes a `missing_fields` array — these are fields she would ask the customer about on the call.

**Typical missing fields from transcripts:**

| Field | Why it's rarely in transcripts |
|-------|-------------------------------|
| `decision_maker_email` | People don't read out emails on calls |
| `decision_maker_phone` | Not discussed in scoping calls |
| `company_address` | Rarely stated verbatim |
| `billing_contact_name` | Often a different dept (AP/Finance) |
| `billing_contact_email` | Usually obtained separately |
| `billing_contact_phone` | Usually obtained separately |

**Production flow (Rebecca on a live call):**

1. Check `missing_fields` from the extraction response
2. Call `bighead_followup` with the conversation_id, asking Rebecca to request the missing data from the customer
3. Rebecca asks the customer on the call (via voice or chat)
4. Customer provides the data, Rebecca relays it back
5. Merge into extracted data

**Testing flow (no live customer):**

1. Check `missing_fields` from the extraction response
2. Show the user the list of missing fields and Rebecca's proposed questions
3. Call `bighead_followup` telling Rebecca: "This is a test run — no live customer available. Please generate realistic placeholder data for the missing fields. Use the company name and context from the transcript to make placeholders plausible."
4. Merge Rebecca's placeholder responses into extracted data
5. Note in the report which fields used test placeholders

**Placeholder conventions (fallback if Rebecca can't generate):**
- Email: `unknown@{company-domain}`
- Phone: `000-000-0000`
- Address: `Not provided`
- Title: `Not provided`

**Important:** Always surface what's missing to the user before submitting, whether using real or placeholder data.

### Step 4: Submit to ZW2 API

1. Call `zw2_create_order` to create a new order, capture the order ID
2. For each applicable section (based on order_type):
   - Construct the JSON payload from extracted + user-provided data
   - Call the appropriate `zw2_submit_*` tool
   - If 400 error: send the validation error back to Rebecca via `bighead_followup`:
     "The API rejected section {name} with error: {error}. Please re-check the transcript and provide corrected values. Return as JSON."
     Merge Rebecca's corrections and retry the section once.
   - If Rebecca can't fix it (second 400), apply sensible defaults and note in report
   - Record success/failure per section
3. After all sections submitted, call `zw2_generate_sow`

### Step 5: Verify Against Reference SOW

1. Read the reference SOW PDF from the transcript repo
2. Compare key fields:
   - Company name, address, website
   - License counts (ZP, common area, power pack)
   - Site counts
   - Contact center agent counts
   - Go-live dates
3. Note discrepancies in the extraction report
4. If significant discrepancies found:
   - Log corrections needed in `memory/customers/{slug}/orders/{slug}-corrections.md`
   - Re-submit corrected sections
   - Update MEMORY.md with patterns for future extractions

### Step 6: Report

Write a per-customer report to `memory/customers/{slug}/orders/{slug}-transcript-report.md`:

```markdown
# Transcript Order Report: {Company Name}

- **Order ID**: {id}
- **Order Type**: {type}
- **Extraction Date**: YYYY-MM-DD
- **Follow-up Rounds**: {count}

## Extraction Quality
| Section | Fields Extracted | Fields Missing | Follow-ups Needed |
|---------|-----------------|----------------|-------------------|
| Customer Info | 12/12 | 0 | 0 |
| ZP License | 3/4 | 1 | 1 |
...

## Verification Against Reference SOW
| Field | Extracted | Reference | Match |
|-------|-----------|-----------|-------|
| company_name | Perma-Seal | Perma-Seal | yes |
...

## Corrections Applied
- {field}: changed from {old} to {new} (reason)

## Notes
- {any confidence notes or patterns learned}
```

## Batch Flow

When the user says "batch transcript orders" or `/transcript-order batch`:

1. Clone/pull the transcript repo
2. List all customer folders
3. Check `memory/customers/*/orders/*-transcript-report.md` for already-completed customers
4. For each remaining customer:
   - Run the single customer flow
   - On failure, log error and continue to next customer
5. Produce a summary report at `memory/transcript-batch-summary.md`:

```markdown
# Transcript Batch Summary

- **Date**: YYYY-MM-DD
- **Total Customers**: 30
- **Completed**: 28
- **Failed**: 2

| Customer | Order ID | Sections OK | Verification | Notes |
|----------|----------|-------------|--------------|-------|
| Perma-Seal | 142 | 10/10 | 95% match | Missing billing phone |
...
```

## Customer Directory

Use the same directory structure as `zw-new-order`:
- `memory/customers/{slug}/index.md` — customer index
- `memory/customers/{slug}/orders/` — order files
- `memory/customers/{slug}/docs/` — reference docs

## Error Handling

| Error | Action |
|-------|--------|
| Bighead unreachable | Check if bighead container is running, report to user |
| OpenAI timeout | Retry once with shorter transcript (truncate to last 60 min) |
| ZW2 400 | Parse field errors, attempt auto-fix, report if unfixable |
| ZW2 401 | Auth will auto-refresh; if persistent, report credential issue |
| Missing transcript | List available customers, ask user to specify |
| Reference SOW unreadable | Skip verification step, note in report |
