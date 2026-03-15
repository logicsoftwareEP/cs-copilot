# CS Copilot — TODOs

## TODO 1: Zendesk sentiment analysis via Claude Haiku
**What:** Analyse each ticket's subject + first comment for sentiment classification (positive/neutral/negative/frustrated). Adds a 4th sub-signal to the Zendesk penalty (up to -5 pts, raising cap from -20 to -25).
**Why:** Ticket volume alone doesn't capture frustration. A customer with 3 polite tickets is very different from one with 3 angry ones. Sentiment adds signal quality.
**Pros:** More accurate penalty; catches "polite but drowning" and "angry but low volume" cases.
**Cons:** Adds Claude API dependency (~$2/sync run). LLM classification adds complexity (malformed responses, refusals, hallucinated categories). Requires caching to avoid re-analysing tickets.
**Context:** The original Zendesk penalty plan included this as the 4th sub-signal. Cut during SCOPE REDUCTION review (2026-03-15) to eliminate Claude API dependency for v1. The scoring function and penalty cap are designed to accommodate this — add the sub-signal and raise cap from -20 to -25.
**Effort:** M
**Priority:** P2
**Depends on:** Zendesk penalty v1 (ticket volume + open + severity)

## TODO 2: Slack alert on penalty spike
**What:** When a previously clean account (penalty=0) suddenly gets a penalty of -10 or worse, send a Slack message to the account's CSM.
**Why:** CSMs shouldn't have to check the dashboard daily. Proactive alerts on sudden support load changes drive faster intervention.
**Pros:** Proactive CSM action; catches sudden support storms before they escalate.
**Cons:** Requires Slack integration (bot token, channel config). Risk of alert fatigue if thresholds are too sensitive.
**Context:** Deferred during SCOPE REDUCTION review (2026-03-15). Natural follow-up once Zendesk penalty is live and thresholds are validated against real data.
**Effort:** S
**Priority:** P3
**Depends on:** Zendesk penalty v1 + Slack integration (not yet built)

## TODO 3: Inline-editable domain column
**What:** Add a Domain column to Portfolio.tsx with inline editing (same pattern as Licences and Amplitude Alias). Uses existing `AccountStore.mergeFields()` method via PATCH /api/accounts/{id}.
**Why:** Some HubSpot accounts may have missing or incorrect domain fields. CSMs need a way to manually set/override the domain so Zendesk matching works for those accounts.
**Pros:** Quick win; reuses existing inline-edit pattern and mergeFields() method. Unblocks Zendesk penalty for accounts with bad HubSpot data.
**Cons:** Minor — adds another editable column to an already wide table.
**Context:** Cut during SCOPE REDUCTION review (2026-03-15). Domain auto-syncs from HubSpot's built-in `domain` property, which covers most accounts. This is for the exceptions.
**Effort:** S
**Priority:** P2
**Depends on:** Zendesk penalty v1
