# API Field Reference

Field definitions per section, sourced from ZoomWarriors2 Django models and serializers.

Legend: **R** = required, **O** = optional, **D** = has default, **RO** = read-only (calculated)

---

## Section 1: Customer Info

Endpoint: `POST /orders/{id}/customer-info/`

| Field | Type | R/O | Choices / Notes |
|-------|------|-----|-----------------|
| `order_name` | string(255) | R | Descriptive name for the order |
| `order_type` | string(20) | R | `zoom_phone`, `zoom_contact_center`, `both` |
| `company_name` | string(255) | R | |
| `company_address` | text | R | Full address |
| `company_website` | URL | R | Must start with `http://` or `https://` |
| `decision_maker_name` | string(255) | R | |
| `decision_maker_title` | string(100) | R | |
| `decision_maker_email` | email | R | |
| `decision_maker_phone` | string(20) | R | |
| `billing_contact_name` | string(255) | R | Skippable if `billing_same_as_decision_maker=true` |
| `billing_contact_email` | email | R | Skippable if `billing_same_as_decision_maker=true` |
| `billing_contact_phone` | string(20) | R | Skippable if `billing_same_as_decision_maker=true` |
| `billing_same_as_decision_maker` | bool | D | Default: `false` |

**Validation**: All string fields must be non-empty after trimming.

---

## Section 2: ZP License

Endpoint: `POST /orders/{id}/zp-license/`
Condition: `order_type` = `zoom_phone` or `both`

| Field | Type | R/O | Default | Notes |
|-------|------|-----|---------|-------|
| `zoom_phone_licenses` | int | D | 0 | Non-negative |
| `common_area_licenses` | int | D | 0 | Non-negative |
| `power_pack_licenses` | int | D | 0 | Non-negative |
| `additional_dids` | int | D | 0 | Non-negative |

**Validation**: At least 1 `zoom_phone_licenses` OR 1 `common_area_licenses` required.

---

## Section 3: ZP Location

Endpoint: `POST /orders/{id}/zp-location/`
Condition: `order_type` = `zoom_phone` or `both`

| Field | Type | R/O | Default | Notes |
|-------|------|-----|---------|-------|
| `sites` | int | O | null | Unified site count (use this for new orders) |
| `small_sites` | int | D | 0 | Legacy: 1-25 users. Don't mix with `sites` |
| `medium_sites` | int | D | 0 | Legacy: 26-50 users. Don't mix with `sites` |
| `large_sites` | int | D | 0 | Legacy: 51+ users. Don't mix with `sites` |
| `additional_e911_zones` | int | D | 0 | Extra E911 zones beyond 1 per site |
| `foreign_port_request` | int | D | 0 | Non-negative |
| `international_deployment` | bool | D | false | |
| `countries_deployed` | array[string] | D | [] | ISO 3166-1 alpha-2 codes (e.g. `["US","CA"]`). Must be active in system. |

**Validation**: At least 1 site required (via `sites` field or legacy sum). Cannot mix `sites` with legacy fields in same request.

---

## Section 4: ZP Features

Endpoint: `POST /orders/{id}/zp-features/`
Condition: `order_type` = `zoom_phone` or `both`

| Field | Type | R/O | Default | Notes |
|-------|------|-----|---------|-------|
| `auto_receptionists_with_ivr` | int | D | 0 | Min 1 required |
| `call_queues` | int | D | 0 | Min 1 required |
| `ata_devices_needed` | bool | D | false | Gate for ATA fields |
| `small_atas` | int | D | 0 | Up to 4 ports |
| `medium_atas` | int | D | 0 | 5-24 ports |
| `large_atas` | int | D | 0 | 25-48 ports |
| `paging_zone_needed` | bool | D | false | Gate for paging zone |
| `paging_zone_type` | string(10) | O | "" | `cloud` or `multicast` |
| `paging_integration_needed` | bool | D | false | Gate for paging integration |
| `paging_integration_type` | string(10) | O | "" | `analog` or `sip` |
| `paging_integration_devices` | int | D | 0 | Non-negative |

**Validation**: Min 1 auto receptionist AND min 1 call queue required.

---

## Section 5: ZP Hardware

Endpoint: `POST /orders/{id}/zp-hardware/`
Condition: `order_type` = `zoom_phone` or `both`

| Field | Type | R/O | Default | Notes |
|-------|------|-----|---------|-------|
| `physical_phones_in_use` | bool | D | false | |
| `reprovisioning_needed` | bool | D | false | |
| `handset_reprovisioning_count` | int | D | 0 | Non-negative |

---

## Section 6: ZP SBC/PBX

Endpoint: `POST /orders/{id}/zp-sbc-pbx/`
Condition: `order_type` = `zoom_phone` or `both`

| Field | Type | R/O | Default | Notes |
|-------|------|-----|---------|-------|
| `byoc` | bool | D | false | Bring Your Own Carrier |
| `sbcs_needed` | bool | D | false | Gate for SBC fields |
| `sbc_count` | int | D | 0 | Non-negative |
| `sbc_type` | string(30) | O | "" | `audiocode_sbc_integration` or `cisco_sbc_integration` |
| `pbx_needed` | bool | D | false | Gate for PBX fields |
| `pbx_count` | int | D | 0 | Non-negative |
| `pbx_type` | string(30) | O | "" | `zoom_integration`, `customer_integration`, or `both` |

---

## Section 7: ZCC

Endpoint: `POST /orders/{id}/zcc/`
Condition: `order_type` = `zoom_contact_center` or `both`

### Base Config

| Field | Type | R/O | Default | Notes |
|-------|------|-----|---------|-------|
| `zcc_intent` | bool | D | false | |
| `zcc_instance` | int | D | 1 | Non-negative |
| `zcc_agents_supervisors` | int | D | 1 | Non-negative |

### Channel Groups

Each channel has the same sub-field pattern. The boolean field gates the others.

**Voice channel** (`voice_channel_included`):

| Field | Type | Default |
|-------|------|---------|
| `voice_channel_included` | bool | false |
| `voice_flows` | int | 0 |
| `voice_queues` | int | 0 |
| `voice_surveys` | int | 0 |
| `voice_database_integrations` | int | 0 |
| `voice_database_dips` | int | 0 |
| `voice_outbound_dialer_needed` | bool | false |
| `voice_outbound_dialer_campaigns` | int | 0 |

**Video channel** (`video_channel_included`):
Fields: `video_flows`, `video_queues`, `video_surveys`, `video_database_integrations`, `video_database_dips`

**SMS channel** (`sms_channel_needed`):
Fields: `sms_flows`, `sms_queues`, `sms_surveys`, `sms_database_integrations`, `sms_database_dips`

**Webchat channel** (`webchat_channel_needed`):
Fields: `webchat_flows`, `webchat_queues`, `webchat_surveys`, `webchat_database_integrations`, `webchat_database_dips`

**Email channel** (`email_channel_needed`):
Fields: `email_flows`, `email_queues`, `email_surveys`, `email_database_integrations`, `email_database_dips`

**Social Media channel** (`social_media_channel_needed`):
Fields: `social_media_flows`, `social_media_queues`, `social_media_surveys`, `social_media_database_integrations`, `social_media_database_dips`, plus `social_media_channel_app` (choices: `whatsapp`, `facebook_messenger`, `instagram`, `zoom_teamchat`)

### Other

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `byoc_integration` | string(10) | "" | `zoom` or `customer` |

**Read-only (auto-calculated)**: `total_flows`, `total_queues`, `total_surveys`, `total_database_integrations`, `total_database_dips`

---

## Section 8: WFO (Workplace Optimization)

Endpoint: `POST /orders/{id}/zcc-workplace-optimization/`
Condition: `order_type` = `zoom_contact_center` or `both`

### Workforce Management (`workforce_management_included`)

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `workforce_management_included` | bool | false | Gate |
| `wfm_additional_agents` | int | 0 | Must be 0 if WFM not included |
| `wfm_additional_schedules` | int | 0 | Must be 0 if WFM not included |
| `wfm_additional_shifts` | int | 0 | Must be 0 if WFM not included |
| `wfm_agents` | int | RO | Calculated: 1 + additional_agents |
| `wfm_schedules` | int | RO | Calculated: 1 + additional_schedules |
| `wfm_shifts` | int | RO | Calculated: 1 + additional_shifts |

### Quality Management (`quality_management_included`)

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `quality_management_included` | bool | false | Gate |
| `qm_additional_scorecards` | int | 0 | Must be 0 if QM not included |
| `qm_scorecards_total` | int | RO | Calculated: 1 + additional_scorecards |

### AI Expert Assist (`ai_expert_assist_included`)

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `ai_expert_assist_included` | bool | false | Gate |
| `ai_simple_knowledge_bases` | int | 0 | Must be 0 if AI not included |
| `ai_advanced_knowledge_bases` | int | 0 | Must be 0 if AI not included |
| `ai_knowledge_bases_total` | int | RO | Calculated: simple + advanced. Min 1 if enabled. |

### ZVA Web/SMS (`zva_websms_included`)

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `zva_websms_included` | bool | false | Gate |
| `zva_websms_instance` | int | 0 | |
| `zva_websms_basic_knowledge_bases` | int | 0 | |
| `zva_websms_advanced_knowledge_bases` | int | 0 | |
| `zva_websms_database_integrations` | int | 0 | |
| `zva_websms_database_dips` | int | 0 | |
| `zva_websms_standard_crm_included` | bool | false | |
| `zva_websms_crm_ticket_forms` | int | 0 | |

### ZVA Voice (`zva_voice_included`)

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `zva_voice_included` | bool | false | Gate |
| `zva_voice_instance` | int | 0 | |
| `zva_voice_basic_knowledge_bases` | int | 0 | |
| `zva_voice_advanced_knowledge_bases` | int | 0 | |
| `zva_voice_skills` | int | 0 | |
| `zva_voice_database_integrations` | int | 0 | |
| `zva_voice_database_dips` | int | 0 | |
| `zva_voice_standard_crm_included` | bool | false | |

---

## Section 9: Additions

Endpoint: `POST /orders/{id}/additions/`

### SSO

| Field | Type | R/O | Default | Notes |
|-------|------|-----|---------|-------|
| `sso_needed` | bool | D | false | Gate |
| `sso_type` | string(15) | O | "" | `basic`, `intermediate`, `advanced` |
| `sso_auth_method` | string(20) | O | "" | Auto-populated from `sso_type`: basic->saml_2_0, intermediate->directory_sync, advanced->scim_provisioning |

### Marketplace Apps

| Field | Type | R/O | Default | Notes |
|-------|------|-----|---------|-------|
| `marketplace_apps_needed` | bool | D | false | Gate |
| `marketplace_apps` | array[object] | D | [] | Array of `{"name": "App Name"}` objects |

### CTI Integration

| Field | Type | R/O | Default | Notes |
|-------|------|-----|---------|-------|
| `cti_integration_needed` | bool | D | false | Gate |
| `cti_salesforce` | bool | D | false | |
| `cti_microsoft_dynamics` | bool | D | false | |
| `cti_hubspot` | bool | D | false | |
| `cti_zendesk` | bool | D | false | |
| `cti_service_now` | bool | D | false | |

---

## Section 10: Wrapup Questions

Endpoint: `POST /orders/{id}/wrapup-questions/`

| Field | Type | R/O | Default | Notes |
|-------|------|-----|---------|-------|
| `go_live_events` | array[object] | D | [] | `{"date": "YYYY-MM-DD", "type": "zoom_phone"|"zoom_contact_center"}`. Auto-populated for `both` orders. Weekdays only. Event types must match order_type. |
| `zp_training_sessions` | int | RO | 0 | Auto: 2 for phone/both, 0 for cc-only |
| `zcc_training_sessions` | int | RO | 0 | Auto: 3 for cc/both, 0 for phone-only |
| `on_site_support_needed` | bool | D | false | |
| `on_site_support_description` | text | O | "" | Free-text description |
