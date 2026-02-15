# SOW Verification Checklist

Checklist for comparing extracted/submitted order data against a reference SOW PDF.

## Critical Fields (must match exactly)

- [ ] `company_name` — exact spelling
- [ ] `order_type` — zoom_phone / zoom_contact_center / both
- [ ] `zoom_phone_licenses` — exact count
- [ ] `common_area_licenses` — exact count
- [ ] `sites` — exact count
- [ ] `zcc_agents_supervisors` — exact count (if CC order)

## Important Fields (should match closely)

- [ ] `company_address` — same location (formatting may differ)
- [ ] `company_website` — same domain
- [ ] `decision_maker_name` — same person
- [ ] `decision_maker_title` — same role
- [ ] `power_pack_licenses` — exact count
- [ ] `additional_dids` — exact count
- [ ] `auto_receptionists_with_ivr` — exact count
- [ ] `call_queues` — exact count
- [ ] `go_live_events` — dates match (allow +/- 1 day for weekday adjustment)

## Secondary Fields (best effort)

- [ ] Contact emails and phones
- [ ] ATA counts and types
- [ ] Paging configuration
- [ ] SBC/PBX details
- [ ] SSO type
- [ ] CTI integrations
- [ ] WFO feature flags
- [ ] ZVA configuration

## Scoring

For each field comparison:
- **Exact match**: 1 point
- **Close match** (e.g., minor formatting difference): 0.5 points
- **Mismatch**: 0 points
- **Not in reference**: skip (don't penalize)

Overall score = points earned / total applicable fields * 100%

## Common Discrepancy Patterns

Track these in MEMORY.md for pattern learning:

1. **License count ambiguity** — transcript says "92 licenses" but SOW splits into ZP + common area
2. **Site count vs location count** — "3 offices" might mean 3 sites or 1 HQ + 2 branches
3. **Contact center channels** — transcript discusses capabilities but SOW only enables what was purchased
4. **Date formats** — transcript uses "March 15th" but API needs "2025-03-15"
5. **Billing contact** — often not discussed in transcript, defaults to same as decision maker
