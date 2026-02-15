# Transcript-to-Order Pipeline: Testing Findings

## Test Environment

- **Bighead**: `POST /api/analyze/transcript` + `POST /api/analyze/followup` (OpenAI GPT-4o, `response_format: json_object`)
- **ZW2 API**: `https://dev2.api.zoomwarriors.com` (dev environment)
- **Transcripts**: `https://github.com/cloudwarriors-ai/transcript-simulation` (30 customers)

## Test Results Summary

| Customer | Order Type | Order ID | Sections | Follow-ups | Ref SOW Match | Key Issues |
|----------|-----------|----------|----------|------------|---------------|------------|
| Perma-Seal | both | #364 | 10/10 | 1 | 18/18 (100%) | None |
| K&L Wine Merchants | zoom_contact_center | #365 | 10/10 | 0 | 100% | None |
| Von Braun Brewing | zoom_phone | #366 | 10/10 | 1 | 20/20 (100%) | None |
| Empire Auto Parts | both | #367 | 10/10 | 2 | See below | Field type mismatches, fudged contact data |

## Empire Auto Parts Detailed Verification

### Section 1: Zoom Phone

| Field | Reference SOW | Generated SOW | Match |
|-------|--------------|---------------|-------|
| Total Zoom Licenses (incl CAP) | 850 | 900 | NO — Rebecca fudged 50 CAP; ref has 0 |
| Power Pack | 0 | 0 | yes |
| Additional DIDs | 0 | 0 | yes |
| Sites | 51 | 51 | yes |
| Extra E911 Zones | 0 | 0 | yes |
| ARs & Call Queues | 19 | 24 | NO — Rebecca split into 5 AR + 19 CQ; ref is 19 total |
| ATA | None | None | yes |
| Paging Zone | None | None | yes |
| SBC | None | None | yes |
| BYOC | Not Included | Not Included | yes |
| PBX | None | None | yes |
| SSO | Basic (SAML 2.0) | Basic (SAML 2.0) | yes |
| Foreign Ports | 0 | 0 | yes |
| Marketplace Apps | Microsoft Teams | Microsoft Teams | yes |
| CTI/CRM | None | None | yes |
| Go-Live Events | 1 | 1 | yes |
| Training Sessions | 2 | 2 | yes |

### Section 1: Zoom Contact Center

| Field | Reference SOW | Generated SOW | Match |
|-------|--------------|---------------|-------|
| Instances | 1 | 1 | yes |
| Agents/Supervisors | 70 | 70 | yes |
| Voice | Included | Included | yes |
| SMS | Not Included | Not Included | yes |
| Webchat | Included | Not Included | NO |
| Email | Not Included | Not Included | yes |
| Video | Not Included | Not Included | yes |
| Social | Not Included | Not Included | yes |
| Flows | 10 | 10 | yes |
| Queues | 4 | 4 | yes |
| Surveys | 0 | 0 | yes |
| DB Connections | 2 | 0 | NO |
| DB Dips | 2 | 0 | NO |
| Go-Live Events | 1 | 1 | yes |
| Training | 3 | 3 | yes |

### Discrepancies Found

1. **Common area licenses (50 fudged)**: Rebecca was told to fudge this; real transcript doesn't specify. Generated SOW shows 900 total (850+50) vs reference 850.
2. **ARs & Call Queues (24 vs 19)**: Rebecca split "19 total ARs and call queues" into 5+19=24. The transcript says 19 *total*. Rebecca should keep the combined total, not guess a split.
3. **Webchat channel missing**: The transcript mentions webchat but Rebecca didn't extract it.
4. **Database connections/dips (0 vs 2)**: The transcript mentions database integrations but Rebecca missed them.

## Validation Errors Encountered During Submission

| Section | Error | Root Cause | Fix |
|---------|-------|-----------|-----|
| zp-hardware | `physical_phones_in_use: Must be a valid boolean` | Rebecca returned int (800), API expects bool | Map non-zero int to `true` |
| zcc | `zcc_intent: Must be a valid boolean` | Rebecca returned string ("new_deployment"), API expects bool | Map any truthy value to `true` |
| wfo | `ai_expert_assist: At least 1 knowledge base required` | Rebecca didn't extract `ai_simple_knowledge_bases` | Default to 1 when `ai_expert_assist_included=true` |
| additions | `sso_type: "SAML 2.0" is not a valid choice` | Rebecca used display name, API wants `basic` | Map: "SAML 2.0"→basic, "directory_sync"→intermediate, "SCIM"→advanced |
| wrapup | `go_live_events: object of type 'int' has no len()` | Rebecca returned int (1), API expects array of `{date, type}` | Convert int to array with estimated dates |

## How to Run Tests

### Prerequisites

1. **Bighead running**: `cd /root/web/bighead && docker-compose -f docker-compose.cpu.yml up -d`
2. **Moltbot running**: `cd /root/web/moltbot && docker-compose -f docker-compose.dev.yml up -d`
3. **Transcript repo cloned**: The bot auto-clones to `memory/transcript-simulation/` on first run

### Manual API Test (single customer)

```bash
# 1. Prepare transcript payload
python3 -c "
import json
with open('path/to/transcript.txt') as f:
    text = f.read()
with open('/tmp/transcript.json', 'w') as f:
    json.dump({'text': text}, f)
"

# 2. Extract via Rebecca
curl -s -X POST http://localhost:8015/api/analyze/transcript \
  -H "Content-Type: application/json" \
  -d @/tmp/transcript.json | python3 -m json.tool

# 3. Follow up for missing fields (use conversation_id from step 2)
curl -s -X POST http://localhost:8015/api/analyze/followup \
  -H "Content-Type: application/json" \
  -d '{"conversation_id":"<id>","message":"<question>"}' | python3 -m json.tool

# 4. Fudge contact data for testing
curl -s -X POST http://localhost:8015/api/analyze/followup \
  -H "Content-Type: application/json" \
  -d '{"conversation_id":"<id>","message":"This is a test run — no live customer. Generate realistic placeholder data for missing contact fields."}' | python3 -m json.tool

# 5. Submit to ZW2 (from inside moltbot container to use env vars)
docker exec openclaw node --input-type=module -e '<submission script>'
```

### Bot-Driven Test (via chat)

Tell the bot:
```
/transcript-order Empire Auto Partners
```

The bot will:
1. Clone/pull transcript repo
2. Read the VTT file
3. Call `bighead_analyze_transcript`
4. Validate against api-fields.md
5. Follow up with Rebecca for ambiguous fields
6. Ask Rebecca to fudge contact data (test mode)
7. Submit all sections to ZW2
8. Generate SOW
9. Verify against reference PDF
10. Produce report

### Reference SOW Verification

After submission, compare generated SOW against the reference PDF in the transcript repo:
```bash
# Extract both to text
pdftotext "memory/transcript-simulation/<Customer>/reference-sow.pdf" /tmp/ref.txt
# Download generated SOW via ZW2 API and extract
pdftotext /tmp/generated.pdf /tmp/gen.txt
# Compare Section 1 fields side by side
```

## Known Issues & Required Fixes

### Must fix before production

1. **Field type coercion layer**: Rebecca returns human-readable values; the API expects machine values. Need a mapping layer between extraction and submission:
   - `physical_phones_in_use`: int → bool
   - `zcc_intent`: string → bool
   - `sso_type`: "SAML 2.0" → "basic", "Directory Sync" → "intermediate", "SCIM" → "advanced"
   - `go_live_events`: int → array of `{date, type}` objects

2. **ARs vs Call Queues split**: The system prompt should instruct Rebecca to return a **combined** total for `auto_receptionists_with_ivr + call_queues`, matching the SOW's "Total # of AR's & Call Queues" field. The current prompt asks for them separately, leading to Rebecca guessing a split.

3. **Missing ZCC sub-fields**: Rebecca doesn't reliably extract `webchat_channel_included`, `database_connections`, `database_dips`. The system prompt needs explicit ZCC field definitions.

4. **AI Expert Assist knowledge bases**: When `ai_expert_assist_included=true`, default `ai_simple_knowledge_bases=1` if not extracted.

### Nice to have

5. **Contact data collection**: In production, Rebecca asks on the call. For testing, the fudge-via-followup flow works well — Rebecca generates plausible data from company context.

6. **Batch testing harness**: Script to run all 30 customers, collect pass/fail rates, and produce a summary report.

## Extraction Accuracy by Order Type

Based on 4 test runs:

| Order Type | Customers Tested | Quantitative Field Accuracy | Notes |
|------------|-----------------|---------------------------|-------|
| zoom_phone | 1 (Von Braun) | 100% | Clean extraction |
| zoom_contact_center | 1 (K&L Wine) | 100% | Clean extraction |
| both | 2 (Perma-Seal, Empire) | ~90% | AR/CQ split issue, webchat missed |

## Full SOW Comparison: Empire Auto Parts (#367)

### Header

| Field | Reference SOW | Generated SOW | Match |
|-------|--------------|---------------|-------|
| Customer Name | Empire Auto Parts | Empire Auto Parts | YES |
| Bill To Contact | Charles Hollien | Jane Doe | NO (fudged) |
| Bill To Address | 15 Jackson Rd, Totowa NJ | 1234 Auto Lane, Parts City CA 90210 | NO (fudged) |
| Sold To Contact | Charles Hollien | Charles Hollien | YES |
| Title | Director of IT Operations | Director of IT Operations | YES |
| Phone | 9737724206 | +1-555-0123 | NO (fudged) |
| Email | chollien@empireautoparts.com | chollien@empireautoparts.com | YES |
| Total Amount | $59,625.00 | $63,925.00 | NO (price diff from extra CAP + ARs) |

### Section 1: Zoom Phone Scope

| Field | Reference | Generated | Match |
|-------|-----------|-----------|-------|
| Deployment Type | Remote | Remote | YES |
| Total Zoom Licenses (incl CAP) | 850 | 900 | NO (+50 fudged CAP) |
| Power Pack License | 0 | 0 | YES |
| Additional DIDs | 0 | 0 | YES |
| Sites (incl 1 E911 Zone) | 51 | 51 | YES |
| Extra E911 Zones | 0 | 0 | YES |
| Total ARs & Call Queues | 19 | 24 | NO (5 AR + 19 CQ vs 19 total) |
| ATAs | None Selected | None Selected | YES |
| Paging Zone | None Selected | None Selected | YES |
| Paging Integration | None Selected | None Selected | YES |
| SBC Integrations | None Selected | None Selected | YES |
| BYOC | Not Included | Not Included | YES |
| BYOPBX | None Selected | None Selected | YES |
| SSO | Basic (SAML 2.0) | Basic (SAML 2.0) | YES |
| Foreign Port Requests | 0 | 0 | YES |
| Foreign Port Countries | None Selected | None Selected | YES |
| Marketplace Apps | Microsoft Teams | Microsoft Teams | YES |
| CTI/CRM | None Selected | None Selected | YES |
| Go-Live Events | 1 | 1 | YES |
| Training Sessions | 2 | 2 | YES |

**ZP Score: 17/20 match (85%)**

### Section 1: Zoom Contact Center Scope

| Field | Reference | Generated | Match |
|-------|-----------|-----------|-------|
| SSO | Basic (SAML 2.0) | Basic (SAML 2.0) | YES |
| Marketplace Apps | Microsoft Teams | Microsoft Teams | YES |
| Total CC Instances | 1 | 1 | YES |
| Total Agents/Supervisors | 70 | 70 | YES |
| Voice Channel | Included | Included | YES |
| SMS Channel | Not Included | Not Included | YES |
| Webchat Channel | Included | Not Included | NO |
| Email Channel | Not Included | Not Included | YES |
| Video Channel | Not Included | Not Included | YES |
| Social Media Channel | Not Included | Not Included | YES |
| Standard Flows | 10 | 10 | YES |
| Queues | 4 | 4 | YES |
| Surveys | 0 | 0 | YES |
| Database Connections | 2 | 0 | NO |
| Database Dips | 2 | 0 | NO |
| BYOC (Zoom) | Not Included | Not Included | YES |
| BYOC (Customer) | Not Included | Not Included | YES |
| CRM/CTI | None Selected | None Selected | YES |
| Outbound Dialer | 0 | 0 | YES |
| Go-Live Events | 1 | 1 | YES |
| Training Sessions | 3 | 3 | YES |

**ZCC Score: 18/21 match (86%)**

### Section 1: Workforce Optimization Scope

| Field | Reference | Generated | Match |
|-------|-----------|-----------|-------|
| WFM | Included | Included | YES |
| WFM Agents | 1 | 1 | YES |
| WFM Schedules | 1 | 1 | YES |
| WFM Shifts | 1 | 1 | YES |
| QM | Included | Included | YES |
| QM Scorecards | 1 | 1 | YES |
| AI Expert Assist | Included | Included | YES |
| AI Knowledge Bases | 1 | 1 | YES |
| ZVA SMS/Webchat | Not Included | Not Included | YES |
| ZVA Voice | Not Included | Not Included | YES |

**WFO Score: 10/10 match (100%)**

### Overall SOW Match Summary

| Section | Fields Compared | Matches | Accuracy |
|---------|----------------|---------|----------|
| Header (contact/billing) | 8 | 5 | 63% (3 fudged) |
| Zoom Phone | 20 | 17 | 85% |
| Zoom Contact Center | 21 | 18 | 86% |
| Workforce Optimization | 10 | 10 | 100% |
| **Total (excl fudged)** | **51** | **45** | **88%** |
| **Total (excl fudged contact)** | **48** | **45** | **94%** |

### Discrepancy Root Causes

| # | Field | Ref | Gen | Cause | Fix |
|---|-------|-----|-----|-------|-----|
| 1 | Total Licenses | 850 | 900 | Rebecca fudged 50 CAP when told to generate placeholders | Don't fudge technical fields — only fudge contact data |
| 2 | ARs & CQs | 19 | 24 | Rebecca split 19 into 5 AR + 19 CQ | Update prompt: return combined total, not split |
| 3 | Webchat | Included | Not Included | Rebecca missed webchat mention in transcript | Add explicit ZCC channel checklist to prompt |
| 4 | DB Connections | 2 | 0 | Rebecca missed database integration discussion | Add explicit database fields to prompt |
| 5 | DB Dips | 2 | 0 | Same as above | Same as above |

## Recommended Next Steps

1. Add field type coercion between Rebecca extraction and ZW2 submission
2. Update system prompt with explicit ZCC sub-field definitions
3. Instruct Rebecca to return combined AR+CQ total
4. Run batch test across all 30 customers
5. Build correction feedback loop: discrepancies → update system prompt → re-test
