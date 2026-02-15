---
name: zw-new-order
description: >
  Create a ZoomWarriors presales order via conversational data gathering.
  Gathers customer info, Zoom Phone, Contact Center, and wrap-up details section by section.
  Stores progress as Markdown in workspace memory. Submits to ZoomWarriors2 API and generates SOW.
  Triggers: /new-order, "create a zoomwarriors order", "start a new order", "new ZW order",
  "create order for [company]", "presales order", "start order".
metadata:
  openclaw:
    emoji: "📋"
---

# ZoomWarriors New Order

Create a presales order conversationally: resume or create -> gather data section-by-section -> confirm -> submit to API -> generate SOW.

## References

- `references/api-fields.md` — field definitions, types, choices, and validation rules per section
- `references/conversational-prompts.md` — natural-language question groupings per section
- `references/capture-summary-template.md` — HTML template for the capture summary artifact
- `references/customer-dir-template.md` — index.md template for scaffolding a new customer directory

## Resume Logic

On invocation, scan `memory/customers/*/orders/` for any `.md` files whose frontmatter contains `Status: in-progress`.

- If found, ask: "I found an in-progress order for **{order_name}**. Resume it, or start a new order?"
- If resuming, locate the first section heading marked `[pending]` and continue from there.
- If starting new, create a fresh tracking file.

**Fallback**: Also check `memory/orders/` for legacy in-progress files. If found there, offer to resume (files stay in the old location for that session).

## Customer Directory Scaffolding

Before creating any order files, ensure the customer directory exists:

1. Derive `{customer-slug}` from the company name (kebab-case, lowercase, alphanumeric + hyphens).
2. Check if `memory/customers/{customer-slug}/index.md` exists.
3. If not, scaffold the directory using the template from `references/customer-dir-template.md`:
   - Create `memory/customers/{customer-slug}/index.md`
   - Create subdirectories `orders/` and `docs/`
4. After creating order files, update `memory/customers/{customer-slug}/index.md` — add entries under the `## Orders` section linking to each order file.

## Order Tracking File

Maintain `memory/customers/{customer-slug}/orders/{order-slug}.md` using `Write`/`Edit`. The `{customer-slug}` is derived from the company name; `{order-slug}` is the kebab-cased order name.

```markdown
# Order: {Order Name}

- **Status**: in-progress | submitted | completed
- **Created**: YYYY-MM-DD
- **Updated**: YYYY-MM-DD
- **API Order ID**: (pending)
- **Order Type**: zoom_phone | zoom_contact_center | both

## Section 1: Customer Info [complete|pending|skipped]

| Field | Value |
|-------|-------|
| order_name | ... |
| company_name | ... |
...

## Section 2: ZP License [pending]
...
```

Update `**Updated**` and the section status tag after every section is gathered.

## Section Flow

| # | Section | Condition | API Endpoint |
|---|---------|-----------|--------------|
| 1 | Customer Info | always | `POST /orders/{id}/customer-info/` |
| 2 | ZP License | phone or both | `POST /orders/{id}/zp-license/` |
| 3 | ZP Location | phone or both | `POST /orders/{id}/zp-location/` |
| 4 | ZP Features | phone or both | `POST /orders/{id}/zp-features/` |
| 5 | ZP Hardware | phone or both | `POST /orders/{id}/zp-hardware/` |
| 6 | ZP SBC/PBX | phone or both | `POST /orders/{id}/zp-sbc-pbx/` |
| 7 | ZCC | cc or both | `POST /orders/{id}/zcc/` |
| 8 | WFO | cc or both | `POST /orders/{id}/zcc-workplace-optimization/` |
| 9 | Additions | always | `POST /orders/{id}/additions/` |
| 10 | Wrapup | always | `POST /orders/{id}/wrapup-questions/` |

Mark sections not applicable to the order type as `[skipped]` immediately after learning the `order_type` in Section 1.

## Conversational Gathering Rules

1. Ask one section at a time. Group related fields naturally — don't ask 15 individual questions.
2. Use sensible defaults (0 for quantities, false for booleans) and confirm them with the user.
3. After each section, update the tracking MD and mark the section `[complete]`.
4. For detailed field info (types, choices, validation), read `references/api-fields.md`.
5. For suggested question wording, read `references/conversational-prompts.md`.
6. If the user says "skip" for an optional section, mark it `[skipped]` with default values.

### Follow-up & Clarification Awareness

**Critical**: When you ask the user a clarifying or follow-up question, their next message is almost certainly an answer to YOUR question — not a new topic. You must track conversational turn context:

- **You asked a clarifying question** → The user's reply is a clarification. Parse it as an answer to what you just asked, extract the relevant data, and continue the current section. Do NOT re-ask the question, reinterpret their answer as a new question, or jump to a different section.
- **You offered multiple options** (e.g., "Are you asking about X, Y, or Z?") → The user picking one is giving you their answer. Record it immediately and move forward.
- **You asked for more detail** (e.g., "Can you tell me more about the E911 requirements?") → Their response IS the detail. Incorporate it into the current field values.
- **Ambiguous short replies** (e.g., "yes", "the first one", "that one") → Resolve these against your most recent question, not against the section prompt or any earlier context.

Never treat a user's direct response to your question as if they are asking you something new. The pattern is: you ask → they answer → you record and advance.

## Capture Summary

After all sections are gathered (before API submission), generate a self-contained HTML summary:

1. Read `references/capture-summary-template.md` for the HTML template.
2. Populate the template with values from the tracking MD file.
3. Write the HTML to `memory/customers/{customer-slug}/orders/{order-slug}-summary.html`.
4. Tell the user: "Capture summary saved."
5. Register the summary in `memory/customers/{customer-slug}/index.md` under `## Orders`.

The HTML file is self-contained (inline CSS, no external dependencies) so any bot or user can open it directly in a browser.

## API Authentication

Base URL: `$ZW2_URL` (env var, e.g. `http://zoomwarriors2-backend:8000`)
Auth: JWT via username/password login (same creds as the read extension).

**Login flow** — run once at the start of API submission:

```
POST $ZW2_URL/api/v1/auth/login/
Content-Type: application/json
{"username": "$ZW2_USERNAME", "password": "$ZW2_PASSWORD", "terms_accepted": true}
```

Response: `{"access_token": "...", "refresh_token": "..."}`.
Use the `access_token` as `Authorization: Bearer <access_token>` on all subsequent calls.

**Token refresh** — if any API call returns 401:

```
POST $ZW2_URL/api/v1/auth/token/refresh/
Content-Type: application/json
{"refresh_token": "<refresh_token>"}
```

If refresh fails, re-login from scratch.

## API Submission Flow

After all sections are complete:

1. Show the full order summary from the tracking MD.
2. Ask: "Ready to submit this order?"
3. Login to the API (see Authentication above) to obtain an access token.
4. `POST /api/v1/orders/` with `{"status": "in_progress"}` -> capture `{id}`.
5. POST each section's data to its endpoint. Construct JSON payloads from the MD table values.
6. Update tracking MD with the API Order ID.
7. If a section POST returns 400, show the validation errors, re-ask the user for corrected values, then retry.

## SOW Generation

After successful submission:

1. Ask: "Generate the Statement of Work?"
2. `POST /api/v1/orders/{id}/generate-sow/`
3. `GET /api/v1/orders/{id}/download-sow-pdf/` -> save PDF to workspace.
4. Generate a markdown SOW draft in `memory/customers/{customer-slug}/orders/{order-slug}-sow-draft.md` for quick review.
5. Register the SOW draft in `memory/customers/{customer-slug}/index.md` under `## Orders`.
6. Update tracking MD status to `completed`.

## Error Handling

| Code | Action |
|------|--------|
| 400 | Parse field-level errors, re-ask user for corrected values, retry the failed section |
| 401 | Token expired — refresh via `/api/v1/auth/token/refresh/`; if that fails, re-login with `$ZW2_USERNAME`/`$ZW2_PASSWORD` |
| 500 | Retry once after 3 seconds; if still failing, inform user — data is safe in tracking MD |

For partial failures: mark successfully submitted sections `[submitted]`, retry only the failed ones.

## End-to-End Flow

1. User says `/new-order` or "create an order for Acme Corp"
2. Agent loads skill, checks `memory/customers/*/orders/` for in-progress orders (also checks legacy `memory/orders/`)
3. Derives `{customer-slug}` from company name, ensures customer directory exists via `references/customer-dir-template.md`
4. Creates tracking MD at `memory/customers/{customer-slug}/orders/{order-slug}.md` with all sections marked `[pending]`
5. Walks through sections conversationally, updating MD after each
6. Skips ZP sections (2-6) if `zoom_contact_center`, skips ZCC/WFO (7-8) if `zoom_phone`
6.5. Generates HTML capture summary at `memory/customers/{customer-slug}/orders/{order-slug}-summary.html`
7. Updates `memory/customers/{customer-slug}/index.md` with order artifact links
8. After all sections complete, shows summary, asks to submit
9. Creates order via API, submits each section, records order ID
10. Generates MD SOW draft + calls API to generate official SOW PDF
11. Presents download link, marks order `completed`
