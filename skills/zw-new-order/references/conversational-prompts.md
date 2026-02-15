# Conversational Prompts

Natural-language question groupings per section. Use these as templates — adapt tone to the conversation. Don't read questions verbatim; weave them into dialogue naturally.

## Turn Context Rules

Maintain awareness of who asked what. After every message you send, your **next expected input** is the user's response to that specific message.

- **If you asked a clarifying question** (e.g., "Do you mean X or Y?"), the user's next reply answers that question. Do not misinterpret it as a new request. Extract the answer, record the data, and continue.
- **If you asked for elaboration** (e.g., "Can you tell me more about the E911 setup?"), the user's reply IS the elaboration. Incorporate it into the field values for the current section.
- **If you presented options** (e.g., "cloud or multicast?"), a short reply like "cloud" or "the first one" is their selection. Record it and move on.
- **Never re-ask a question the user just answered.** If their reply is clear enough to populate the field, do so. Only re-ask if the answer is truly unresolvable.
- **Short/pronoun replies** ("yes", "that", "the second one") always reference your most recent question — not a prior turn.

---

## Section 1: Customer Info (3 turns)

**Turn 1 — Company info:**
> Let's start with the basics. What's the company name, their address, and website URL? Also, what should we call this order — and is it for **Zoom Phone**, **Contact Center**, or **both**?

**Turn 2 — Decision maker:**
> Who's the decision maker on this deal? I'll need their name, title, email, and phone number.

**Turn 3 — Billing contact:**
> Is the billing contact the same person as the decision maker? If not, I'll need the billing contact's name, email, and phone.

---

## Section 2: ZP License (1 turn)

> How many licenses do they need?
> - **Zoom Phone licenses** (standard user seats)
> - **Common Area licenses** (lobby phones, break rooms, etc.)
> - **Power Pack licenses** (advanced analytics add-on)
> - **Additional DIDs** (extra phone numbers beyond what's included)
>
> Just give me the numbers — zeros are fine for any they don't need.

---

## Section 3: ZP Location (2 turns)

**Turn 1 — Sites + E911:**
> How many physical sites/locations will have Zoom Phone? And do they need any additional E911 zones beyond the default one per site?

**Turn 2 — International:**
> Is this an international deployment? If so, which countries? (I'll need the 2-letter country codes like US, CA, GB.) Also, any foreign number porting requests?

---

## Section 4: ZP Features (3 turns)

**Turn 1 — Call handling:**
> How many **auto receptionists** (IVR menus) and **call queues** do they need? (At least 1 of each is required.)

**Turn 2 — ATAs:**
> Do they need any ATA devices (analog telephone adapters)? If yes:
> - Small ATAs (up to 4 ports)?
> - Medium ATAs (5-24 ports)?
> - Large ATAs (25-48 ports)?

**Turn 3 — Paging:**
> Do they need paging zones? If yes, **cloud** or **multicast**?
> And do they need paging integration devices? If so, **analog** or **SIP**, and how many?

---

## Section 5: ZP Hardware (1 turn)

> Quick hardware questions:
> - Are there physical desk phones currently in use?
> - Do any handsets need reprovisioning to work with Zoom? If so, how many?

---

## Section 6: ZP SBC/PBX (2 turns)

**Turn 1 — BYOC + SBC:**
> Is this a Bring Your Own Carrier (BYOC) deployment? Do they need SBC integration? If so, how many SBCs and what type — **Audiocode** or **Cisco**?

**Turn 2 — PBX:**
> Do they need PBX integration? If so, how many, and what type — **Zoom integration**, **customer integration**, or **both**?

---

## Section 7: ZCC (dynamic — 2-4 turns)

**Turn 1 — Base config + channel selection:**
> Let's set up the Contact Center. How many ZCC instances and how many agents/supervisors?
> Which channels do they need? Pick all that apply:
> - Voice
> - Video
> - SMS
> - Webchat
> - Email
> - Social Media (WhatsApp, Facebook Messenger, Instagram, or Zoom Teamchat)

**Turn 2+ — Per enabled channel:**
For each enabled channel, ask:
> For the **{channel}** channel, how many:
> - Flows?
> - Queues?
> - Surveys?
> - Database integrations?
> - Database dips?

For **voice** specifically, also ask:
> Do they need an outbound dialer? If yes, how many campaigns?

For **social media**, also ask:
> Which social media app — WhatsApp, Facebook Messenger, Instagram, or Zoom Teamchat?

**Final turn:**
> Do they need BYOC integration for the contact center? If so, is it **Zoom-managed** or **customer-managed**?

---

## Section 8: WFO — Workplace Optimization (dynamic — 2-4 turns)

**Turn 1 — Feature selection:**
> Which Workplace Optimization features should we include?
> - **Workforce Management** (scheduling, shifts)
> - **Quality Management** (scorecards)
> - **AI Expert Assist** (knowledge bases)
> - **ZVA Web/SMS** (virtual agent for webchat and SMS)
> - **ZVA Voice** (virtual agent for voice)

**Turn 2+ — Per enabled feature:**

If **Workforce Management**:
> Beyond the base allocation (1 agent group, 1 schedule, 1 shift), how many *additional* agents, schedules, and shifts?

If **Quality Management**:
> Beyond the base scorecard, how many *additional* scorecards?

If **AI Expert Assist**:
> How many knowledge bases — simple vs. advanced? (At least 1 total required.)

If **ZVA Web/SMS**:
> For the ZVA Web/SMS bot:
> - How many instances?
> - Knowledge bases (basic / advanced)?
> - Database integrations and dips?
> - Standard CRM integration included?
> - How many CRM ticket forms?

If **ZVA Voice**:
> For the ZVA Voice bot:
> - How many instances?
> - Knowledge bases (basic / advanced)?
> - Skills?
> - Database integrations and dips?
> - Standard CRM integration included?

---

## Section 9: Additions (3 turns)

**Turn 1 — SSO:**
> Does the customer need SSO? If yes, what level — **Basic** (SAML 2.0), **Intermediate** (Directory Sync), or **Advanced** (SCIM Provisioning)? The auth method is set automatically based on the level.

**Turn 2 — Marketplace apps:**
> Do they need any Zoom Marketplace app integrations? If so, which apps? (Just list the names.)

**Turn 3 — CTI:**
> Do they need CTI (Computer Telephony Integration) with any of these platforms?
> - Salesforce
> - Microsoft Dynamics
> - HubSpot
> - Zendesk
> - ServiceNow

---

## Section 10: Wrapup (2 turns)

**Turn 1 — Go-live dates:**
> When are the target go-live dates? I need a date and whether it's for Zoom Phone, Contact Center, or both. (Dates should be weekdays.)
> *Note: for "both" orders, I'll default to 30 days from today for each product type if none specified.*

**Turn 2 — Training + on-site support:**
> Training sessions are auto-set based on the order type (2 for ZP, 3 for ZCC). Does that work, or do you want to adjust?
> Do they need on-site support for the deployment? If so, describe what's needed.
