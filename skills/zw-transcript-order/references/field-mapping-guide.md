# Transcript-to-Field Mapping Guide

How common transcript language maps to ZW2 API field values.

## Order Type Detection

| Transcript Language | order_type |
|-------------------|------------|
| "Zoom Phone", "phone system", "desk phones", "VoIP" | `zoom_phone` |
| "Contact Center", "call center", "ZCC", "agent routing" | `zoom_contact_center` |
| "both phone and contact center", mentions both ZP + ZCC features | `both` |

## Customer Info

| Transcript Clue | Field |
|-----------------|-------|
| Company/org name mentioned by rep or customer | `company_name` |
| "our website is..." / domain mentioned | `company_website` (prefix https:// if missing) |
| Address, HQ location, "based in..." | `company_address` |
| Person making decisions, "I'm the VP of IT" | `decision_maker_name` + `decision_maker_title` |
| Email addresses exchanged | `decision_maker_email` / `billing_contact_email` |
| Phone numbers shared | `decision_maker_phone` / `billing_contact_phone` |
| "billing goes to the same person" / "I handle billing too" | `billing_same_as_decision_maker: true` |

## License Counts

| Transcript Clue | Field |
|-----------------|-------|
| "X users", "X employees need phones", "X phone licenses" | `zoom_phone_licenses` |
| "lobby phones", "conference room phones", "break room" | `common_area_licenses` |
| "power pack", "advanced analytics", "extended recording" | `power_pack_licenses` |
| "additional numbers", "extra DIDs", "vanity numbers" | `additional_dids` |
| Total license count with no breakdown | Split: assume all `zoom_phone_licenses` unless context suggests common area |

## Locations

| Transcript Clue | Field |
|-----------------|-------|
| "X offices", "X locations", "X branches", "X sites" | `sites` |
| "911", "E911", "emergency zones" | `additional_e911_zones` |
| "porting from another carrier", "transfer numbers" | `foreign_port_request` |
| "international offices", "outside the US" | `international_deployment: true` |
| Country names or codes | `countries_deployed` (convert to ISO 3166-1 alpha-2) |

## Features

| Transcript Clue | Field |
|-----------------|-------|
| "auto attendant", "IVR", "menu system", "press 1 for..." | `auto_receptionists_with_ivr` |
| "call queue", "hold queue", "ring group" | `call_queues` |
| "ATA", "analog adapter", "fax machines" | `ata_devices_needed: true` + size fields |
| "paging", "overhead speakers", "intercom" | `paging_zone_needed: true` + type |

## Hardware

| Transcript Clue | Field |
|-----------------|-------|
| "existing phones", "Polycom", "Yealink", "desk phones" | `physical_phones_in_use: true` |
| "reprovision", "reconfigure existing phones" | `reprovisioning_needed: true` |
| "X phones to reprovision" | `handset_reprovisioning_count` |

## SBC/PBX

| Transcript Clue | Field |
|-----------------|-------|
| "bring your own carrier", "BYOC", "keep our carrier" | `byoc: true` |
| "SBC", "session border controller", "AudioCodes" | `sbcs_needed: true`, `sbc_type` |
| "PBX integration", "existing PBX" | `pbx_needed: true`, `pbx_type` |

## Contact Center

| Transcript Clue | Field |
|-----------------|-------|
| "X agents", "X supervisors" | `zcc_agents_supervisors` |
| "voice", "phone calls" (in CC context) | `voice_channel_included: true` |
| "chat", "web chat", "live chat" | `webchat_channel_needed: true` |
| "SMS", "text messaging" | `sms_channel_needed: true` |
| "email routing", "email queue" | `email_channel_needed: true` |
| "WhatsApp", "Facebook", "social media" | `social_media_channel_needed: true` |
| "video support" | `video_channel_included: true` |
| "outbound dialer", "campaigns" | `voice_outbound_dialer_needed: true` |

## Workplace Optimization

| Transcript Clue | Field |
|-----------------|-------|
| "workforce management", "WFM", "scheduling" | `workforce_management_included: true` |
| "quality management", "QM", "call scoring" | `quality_management_included: true` |
| "AI assist", "knowledge base", "expert assist" | `ai_expert_assist_included: true` |
| "virtual agent", "chatbot", "ZVA" | `zva_websms_included` or `zva_voice_included` |

## Additions

| Transcript Clue | Field |
|-----------------|-------|
| "SSO", "single sign-on", "SAML", "SCIM" | `sso_needed: true`, `sso_type` |
| "marketplace", "integration apps" | `marketplace_apps_needed: true` |
| "Salesforce", "HubSpot", "Zendesk", "ServiceNow", "Dynamics" | `cti_integration_needed: true` + specific boolean |

## Wrapup

| Transcript Clue | Field |
|-----------------|-------|
| "go live", "launch date", "target date" | `go_live_events` (convert to YYYY-MM-DD, weekday only) |
| "on-site support", "someone on location" | `on_site_support_needed: true` |
