# Capture Summary HTML Template

Use the following HTML template to generate the capture summary. Replace all `{{placeholder}}` tokens with values from the tracking MD file. For sections marked `[skipped]`, render the collapsed gray row. For sections marked `[complete]`, render the full field/value table.

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Order Summary — {{order_name}}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #1a1a1a; max-width: 900px; margin: 0 auto; padding: 24px; background: #f8f9fa; }
  .header { background: #1a56db; color: #fff; padding: 24px 28px; border-radius: 8px 8px 0 0; }
  .header h1 { font-size: 22px; margin-bottom: 6px; }
  .header .meta { font-size: 13px; opacity: 0.85; }
  .badge { display: inline-block; padding: 3px 10px; border-radius: 12px; font-size: 12px; font-weight: 600; text-transform: uppercase; background: rgba(255,255,255,0.2); margin-left: 10px; vertical-align: middle; }
  .body { background: #fff; padding: 28px; border-radius: 0 0 8px 8px; border: 1px solid #e2e6ea; border-top: none; }
  .section { margin-bottom: 24px; }
  .section-title { font-size: 15px; font-weight: 700; padding: 10px 14px; border-radius: 6px; margin-bottom: 10px; }
  .section-title.complete { background: #d1fae5; color: #065f46; }
  .section-title.skipped { background: #f3f4f6; color: #6b7280; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 4px; }
  th, td { text-align: left; padding: 7px 14px; font-size: 13px; border-bottom: 1px solid #eee; }
  th { width: 40%; color: #6b7280; font-weight: 500; }
  td { color: #111827; }
  .sub-heading { font-size: 13px; font-weight: 600; color: #374151; padding: 8px 14px 4px; }
  .skipped-note { font-size: 13px; color: #9ca3af; padding: 4px 14px 10px; font-style: italic; }
  .footer { text-align: center; font-size: 11px; color: #9ca3af; margin-top: 24px; }
  @media print {
    body { background: #fff; padding: 0; }
    .header { border-radius: 0; }
    .body { border: none; border-radius: 0; }
    .section { page-break-inside: avoid; }
  }
</style>
</head>
<body>

<div class="header">
  <h1>{{order_name}} <span class="badge">{{order_type}}</span></h1>
  <div class="meta">{{company_name}} &bull; Created: {{created_date}} &bull; Updated: {{updated_date}}</div>
</div>

<div class="body">

  <!-- Section 1: Customer Info -->
  <div class="section">
    <div class="section-title {{section1_status}}">1. Customer Info [{{section1_status}}]</div>
    <!-- If complete, render table. If skipped, render skipped-note. -->
    <!-- COMPLETE BLOCK -->
    <table>
      <tr><th>Order Name</th><td>{{order_name}}</td></tr>
      <tr><th>Company Name</th><td>{{company_name}}</td></tr>
      <tr><th>Company Address</th><td>{{company_address}}</td></tr>
      <tr><th>Company Website</th><td>{{company_website}}</td></tr>
      <tr><th>Decision Maker</th><td>{{decision_maker_name}} — {{decision_maker_title}}</td></tr>
      <tr><th>Decision Maker Email</th><td>{{decision_maker_email}}</td></tr>
      <tr><th>Decision Maker Phone</th><td>{{decision_maker_phone}}</td></tr>
      <tr><th>Billing Contact</th><td>{{billing_contact_name}}</td></tr>
      <tr><th>Billing Email</th><td>{{billing_contact_email}}</td></tr>
      <tr><th>Billing Phone</th><td>{{billing_contact_phone}}</td></tr>
    </table>
    <!-- SKIPPED BLOCK -->
    <!-- <div class="skipped-note">Skipped (not applicable)</div> -->
  </div>

  <!-- Section 2: ZP License -->
  <div class="section">
    <div class="section-title {{section2_status}}">2. ZP License [{{section2_status}}]</div>
    <!-- COMPLETE BLOCK -->
    <table>
      <tr><th>Zoom Phone Licenses</th><td>{{zoom_phone_licenses}}</td></tr>
      <tr><th>Common Area Licenses</th><td>{{common_area_licenses}}</td></tr>
      <tr><th>Power Pack Licenses</th><td>{{power_pack_licenses}}</td></tr>
      <tr><th>Additional DIDs</th><td>{{additional_dids}}</td></tr>
    </table>
    <!-- SKIPPED BLOCK -->
    <!-- <div class="skipped-note">Skipped (not applicable)</div> -->
  </div>

  <!-- Section 3: ZP Location -->
  <div class="section">
    <div class="section-title {{section3_status}}">3. ZP Location [{{section3_status}}]</div>
    <!-- COMPLETE BLOCK -->
    <table>
      <tr><th>Sites</th><td>{{sites}}</td></tr>
      <tr><th>Additional E911 Zones</th><td>{{additional_e911_zones}}</td></tr>
      <tr><th>Foreign Port Requests</th><td>{{foreign_port_request}}</td></tr>
      <tr><th>International Deployment</th><td>{{international_deployment}}</td></tr>
      <tr><th>Countries Deployed</th><td>{{countries_deployed}}</td></tr>
    </table>
    <!-- SKIPPED BLOCK -->
    <!-- <div class="skipped-note">Skipped (not applicable)</div> -->
  </div>

  <!-- Section 4: ZP Features -->
  <div class="section">
    <div class="section-title {{section4_status}}">4. ZP Features [{{section4_status}}]</div>
    <!-- COMPLETE BLOCK -->
    <table>
      <tr><th>Auto Receptionists w/ IVR</th><td>{{auto_receptionists_with_ivr}}</td></tr>
      <tr><th>Call Queues</th><td>{{call_queues}}</td></tr>
      <tr><th>ATA Devices Needed</th><td>{{ata_devices_needed}}</td></tr>
      <tr><th>Small ATAs</th><td>{{small_atas}}</td></tr>
      <tr><th>Medium ATAs</th><td>{{medium_atas}}</td></tr>
      <tr><th>Large ATAs</th><td>{{large_atas}}</td></tr>
      <tr><th>Paging Zone Needed</th><td>{{paging_zone_needed}}</td></tr>
      <tr><th>Paging Zone Type</th><td>{{paging_zone_type}}</td></tr>
      <tr><th>Paging Integration Needed</th><td>{{paging_integration_needed}}</td></tr>
      <tr><th>Paging Integration Type</th><td>{{paging_integration_type}}</td></tr>
      <tr><th>Paging Integration Devices</th><td>{{paging_integration_devices}}</td></tr>
    </table>
    <!-- SKIPPED BLOCK -->
    <!-- <div class="skipped-note">Skipped (not applicable)</div> -->
  </div>

  <!-- Section 5: ZP Hardware -->
  <div class="section">
    <div class="section-title {{section5_status}}">5. ZP Hardware [{{section5_status}}]</div>
    <!-- COMPLETE BLOCK -->
    <table>
      <tr><th>Physical Phones in Use</th><td>{{physical_phones_in_use}}</td></tr>
      <tr><th>Reprovisioning Needed</th><td>{{reprovisioning_needed}}</td></tr>
      <tr><th>Handset Reprovisioning Count</th><td>{{handset_reprovisioning_count}}</td></tr>
    </table>
    <!-- SKIPPED BLOCK -->
    <!-- <div class="skipped-note">Skipped (not applicable)</div> -->
  </div>

  <!-- Section 6: ZP SBC/PBX -->
  <div class="section">
    <div class="section-title {{section6_status}}">6. ZP SBC/PBX [{{section6_status}}]</div>
    <!-- COMPLETE BLOCK -->
    <table>
      <tr><th>BYOC</th><td>{{byoc}}</td></tr>
      <tr><th>SBCs Needed</th><td>{{sbcs_needed}}</td></tr>
      <tr><th>SBC Count</th><td>{{sbc_count}}</td></tr>
      <tr><th>SBC Type</th><td>{{sbc_type}}</td></tr>
      <tr><th>PBX Needed</th><td>{{pbx_needed}}</td></tr>
      <tr><th>PBX Count</th><td>{{pbx_count}}</td></tr>
      <tr><th>PBX Type</th><td>{{pbx_type}}</td></tr>
    </table>
    <!-- SKIPPED BLOCK -->
    <!-- <div class="skipped-note">Skipped (not applicable)</div> -->
  </div>

  <!-- Section 7: ZCC -->
  <div class="section">
    <div class="section-title {{section7_status}}">7. ZCC [{{section7_status}}]</div>
    <!-- COMPLETE BLOCK -->
    <table>
      <tr><th>ZCC Intent</th><td>{{zcc_intent}}</td></tr>
      <tr><th>ZCC Instances</th><td>{{zcc_instance}}</td></tr>
      <tr><th>Agents / Supervisors</th><td>{{zcc_agents_supervisors}}</td></tr>
      <tr><th>BYOC Integration</th><td>{{byoc_integration}}</td></tr>
    </table>
    <!-- Channel sub-tables: only include channels where the _included/_needed flag is true -->
    <div class="sub-heading">Voice Channel</div>
    <table>
      <tr><th>Included</th><td>{{voice_channel_included}}</td></tr>
      <tr><th>Flows / Queues / Surveys</th><td>{{voice_flows}} / {{voice_queues}} / {{voice_surveys}}</td></tr>
      <tr><th>DB Integrations / Dips</th><td>{{voice_database_integrations}} / {{voice_database_dips}}</td></tr>
      <tr><th>Outbound Dialer</th><td>{{voice_outbound_dialer_needed}} ({{voice_outbound_dialer_campaigns}} campaigns)</td></tr>
    </table>
    <div class="sub-heading">Video Channel</div>
    <table>
      <tr><th>Included</th><td>{{video_channel_included}}</td></tr>
      <tr><th>Flows / Queues / Surveys</th><td>{{video_flows}} / {{video_queues}} / {{video_surveys}}</td></tr>
      <tr><th>DB Integrations / Dips</th><td>{{video_database_integrations}} / {{video_database_dips}}</td></tr>
    </table>
    <div class="sub-heading">SMS Channel</div>
    <table>
      <tr><th>Needed</th><td>{{sms_channel_needed}}</td></tr>
      <tr><th>Flows / Queues / Surveys</th><td>{{sms_flows}} / {{sms_queues}} / {{sms_surveys}}</td></tr>
      <tr><th>DB Integrations / Dips</th><td>{{sms_database_integrations}} / {{sms_database_dips}}</td></tr>
    </table>
    <div class="sub-heading">Webchat Channel</div>
    <table>
      <tr><th>Needed</th><td>{{webchat_channel_needed}}</td></tr>
      <tr><th>Flows / Queues / Surveys</th><td>{{webchat_flows}} / {{webchat_queues}} / {{webchat_surveys}}</td></tr>
      <tr><th>DB Integrations / Dips</th><td>{{webchat_database_integrations}} / {{webchat_database_dips}}</td></tr>
    </table>
    <div class="sub-heading">Email Channel</div>
    <table>
      <tr><th>Needed</th><td>{{email_channel_needed}}</td></tr>
      <tr><th>Flows / Queues / Surveys</th><td>{{email_flows}} / {{email_queues}} / {{email_surveys}}</td></tr>
      <tr><th>DB Integrations / Dips</th><td>{{email_database_integrations}} / {{email_database_dips}}</td></tr>
    </table>
    <div class="sub-heading">Social Media Channel</div>
    <table>
      <tr><th>Needed</th><td>{{social_media_channel_needed}}</td></tr>
      <tr><th>App</th><td>{{social_media_channel_app}}</td></tr>
      <tr><th>Flows / Queues / Surveys</th><td>{{social_media_flows}} / {{social_media_queues}} / {{social_media_surveys}}</td></tr>
      <tr><th>DB Integrations / Dips</th><td>{{social_media_database_integrations}} / {{social_media_database_dips}}</td></tr>
    </table>
    <!-- SKIPPED BLOCK -->
    <!-- <div class="skipped-note">Skipped (not applicable)</div> -->
  </div>

  <!-- Section 8: WFO -->
  <div class="section">
    <div class="section-title {{section8_status}}">8. WFO [{{section8_status}}]</div>
    <!-- COMPLETE BLOCK — render only included sub-features -->
    <div class="sub-heading">Workforce Management</div>
    <table>
      <tr><th>Included</th><td>{{workforce_management_included}}</td></tr>
      <tr><th>Agents / Schedules / Shifts</th><td>{{wfm_agents}} / {{wfm_schedules}} / {{wfm_shifts}}</td></tr>
    </table>
    <div class="sub-heading">Quality Management</div>
    <table>
      <tr><th>Included</th><td>{{quality_management_included}}</td></tr>
      <tr><th>Scorecards</th><td>{{qm_scorecards_total}}</td></tr>
    </table>
    <div class="sub-heading">AI Expert Assist</div>
    <table>
      <tr><th>Included</th><td>{{ai_expert_assist_included}}</td></tr>
      <tr><th>Simple / Advanced KBs</th><td>{{ai_simple_knowledge_bases}} / {{ai_advanced_knowledge_bases}}</td></tr>
    </table>
    <div class="sub-heading">ZVA Web/SMS</div>
    <table>
      <tr><th>Included</th><td>{{zva_websms_included}}</td></tr>
      <tr><th>Instances</th><td>{{zva_websms_instance}}</td></tr>
      <tr><th>Basic / Advanced KBs</th><td>{{zva_websms_basic_knowledge_bases}} / {{zva_websms_advanced_knowledge_bases}}</td></tr>
      <tr><th>DB Integrations / Dips</th><td>{{zva_websms_database_integrations}} / {{zva_websms_database_dips}}</td></tr>
      <tr><th>Standard CRM</th><td>{{zva_websms_standard_crm_included}}</td></tr>
      <tr><th>CRM Ticket Forms</th><td>{{zva_websms_crm_ticket_forms}}</td></tr>
    </table>
    <div class="sub-heading">ZVA Voice</div>
    <table>
      <tr><th>Included</th><td>{{zva_voice_included}}</td></tr>
      <tr><th>Instances</th><td>{{zva_voice_instance}}</td></tr>
      <tr><th>Basic / Advanced KBs</th><td>{{zva_voice_basic_knowledge_bases}} / {{zva_voice_advanced_knowledge_bases}}</td></tr>
      <tr><th>Skills</th><td>{{zva_voice_skills}}</td></tr>
      <tr><th>DB Integrations / Dips</th><td>{{zva_voice_database_integrations}} / {{zva_voice_database_dips}}</td></tr>
      <tr><th>Standard CRM</th><td>{{zva_voice_standard_crm_included}}</td></tr>
    </table>
    <!-- SKIPPED BLOCK -->
    <!-- <div class="skipped-note">Skipped (not applicable)</div> -->
  </div>

  <!-- Section 9: Additions -->
  <div class="section">
    <div class="section-title {{section9_status}}">9. Additions [{{section9_status}}]</div>
    <!-- COMPLETE BLOCK -->
    <div class="sub-heading">SSO</div>
    <table>
      <tr><th>SSO Needed</th><td>{{sso_needed}}</td></tr>
      <tr><th>SSO Type</th><td>{{sso_type}}</td></tr>
      <tr><th>Auth Method</th><td>{{sso_auth_method}}</td></tr>
    </table>
    <div class="sub-heading">Marketplace Apps</div>
    <table>
      <tr><th>Marketplace Apps Needed</th><td>{{marketplace_apps_needed}}</td></tr>
      <tr><th>Apps</th><td>{{marketplace_apps}}</td></tr>
    </table>
    <div class="sub-heading">CTI Integration</div>
    <table>
      <tr><th>CTI Needed</th><td>{{cti_integration_needed}}</td></tr>
      <tr><th>Salesforce</th><td>{{cti_salesforce}}</td></tr>
      <tr><th>Microsoft Dynamics</th><td>{{cti_microsoft_dynamics}}</td></tr>
      <tr><th>HubSpot</th><td>{{cti_hubspot}}</td></tr>
      <tr><th>Zendesk</th><td>{{cti_zendesk}}</td></tr>
      <tr><th>ServiceNow</th><td>{{cti_service_now}}</td></tr>
    </table>
    <!-- SKIPPED BLOCK -->
    <!-- <div class="skipped-note">Skipped (not applicable)</div> -->
  </div>

  <!-- Section 10: Wrapup -->
  <div class="section">
    <div class="section-title {{section10_status}}">10. Wrapup [{{section10_status}}]</div>
    <!-- COMPLETE BLOCK -->
    <table>
      <tr><th>Go-Live Events</th><td>{{go_live_events}}</td></tr>
      <tr><th>ZP Training Sessions</th><td>{{zp_training_sessions}}</td></tr>
      <tr><th>ZCC Training Sessions</th><td>{{zcc_training_sessions}}</td></tr>
      <tr><th>On-Site Support Needed</th><td>{{on_site_support_needed}}</td></tr>
      <tr><th>On-Site Support Description</th><td>{{on_site_support_description}}</td></tr>
    </table>
    <!-- SKIPPED BLOCK -->
    <!-- <div class="skipped-note">Skipped (not applicable)</div> -->
  </div>

</div>

<div class="footer">Generated {{generated_timestamp}} by ZoomWarriors Order Capture</div>

</body>
</html>
```

## Template Instructions

- Replace each `{{placeholder}}` with the corresponding value from the tracking MD file.
- For each section, check its status tag (`[complete]`, `[skipped]`, or `[pending]`):
  - **`[complete]`**: Render the full table with field values. Use class `complete` on the section title.
  - **`[skipped]`**: Remove the table block and uncomment the `<div class="skipped-note">` line. Use class `skipped` on the section title.
  - **`[pending]`**: Should not exist at summary generation time. If found, treat as skipped.
- For ZCC channel sub-tables (Section 7): only render channels where the gate boolean is `true`. Omit disabled channel sub-tables entirely.
- For WFO sub-features (Section 8): only render sub-feature tables where the gate boolean is `true`. Omit disabled sub-feature tables entirely.
- For boolean values, display as `Yes` or `No`.
- For arrays (e.g., `countries_deployed`, `marketplace_apps`, `go_live_events`), format as comma-separated strings or bullet lists.
- `{{generated_timestamp}}` should be the current date/time in `YYYY-MM-DD HH:mm` format.
