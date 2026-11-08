# TheSportzine FPL Pro — Implementation Plan

## Product decisions

| Area | Decision |
|---|---|
| Monthly subscription | ₹99 / month |
| Season pass | ₹499 / full FPL season |
| Free experience | A meaningful preview before upgrade |
| Authentication | Google sign-in |
| Payment gateway | Other / undecided — keep integration provider-neutral until selected |
| Existing free dashboard | Remains free |

## Product and access model

- Keep the current FPL dashboard, live points, squad, leagues, fixtures and basic player information free.
- FPL Pro unlocks the full Improve Your Squad experience: Ideal XI optimisation, captain and vice-captain analysis, transfer recommendations across 1/3/5 gameweeks, chip strategy and squad planning.
- Anonymous visitors can see the Pro landing page and a limited illustrative preview.
- A signed-in user links an FPL ID to their account. An FPL ID alone is never proof of subscription ownership.
- Paid access is determined server-side from a verified subscription entitlement. Hiding UI in the browser is not an access-control mechanism.

## Phases

### Phase 1 — Pricing and preview experience (started)
- Add a dedicated /fpl-pro landing and upgrade page.
- Display both confirmed price points and explain the free-versus-Pro split.
- Provide an illustrative free preview and locked-feature explanations.
- Add plan selection UI without pretending authentication or payment is live.
- Keep payment provider selection open; no credentials or gateway assumptions.

**Deliverable:** Responsive Pro landing page and pricing/preview experience in the repository.

### Phase 2 — Google authentication and account foundation
- Select an auth implementation compatible with Cloudflare Pages/Workers.
- Configure Google OAuth client ID/secret and exact callback URLs as environment secrets.
- Add D1 tables for users, linked FPL IDs, sessions and account audit events.
- Implement secure, HTTP-only, same-site session cookies, CSRF/state validation and sign-out.
- Allow a signed-in user to link and manage an FPL ID; validate the ID against FPL data.

### Phase 3 — Payment provider and subscription lifecycle
- Confirm the payment gateway and supported recurring-payment methods before implementation.
- Define a provider-neutral checkout/subscription adapter.
- Create server-side checkout, customer and subscription records.
- Verify webhook signatures; make webhook processing idempotent.
- Support pending, active, past-due, cancelled, expired and refunded states.
- For season pass, store a fixed season entitlement and explicit season end date; do not model it as a monthly renewal.

### Phase 4 — Entitlements and Pro feature gating
- Add a shared server-side entitlement check for every premium API.
- Gate full Ideal XI, captaincy, transfer horizons, chip strategy and squad tools.
- Return only preview-safe data to free users.
- Add account/billing status UI and a clear renewal/expiry state.
- Keep public FPL data and existing free dashboard endpoints available.

### Phase 5 — QA, rollout and operations
- Test OAuth callbacks, session expiry, account linking and duplicate FPL ID handling.
- Test payment success, failure, retries, duplicate/out-of-order webhooks, cancellation and refunds.
- Verify that direct API calls cannot bypass Pro entitlements.
- Add subscription event logging, support/admin lookup and basic conversion analytics.
- Deploy to a staging environment, verify end-to-end, then roll out production.

## Phase 1 implementation notes

- Route: /fpl-pro
- Source: src/fpl-pro.js, src/fpl-pro.css
- Plan IDs: monthly and season
- The current page uses illustrative preview figures, clearly labelled as examples. Live team-specific preview data will be connected after the account and FPL-ID linking foundation is in place.
- The plan buttons currently confirm the selected plan and explain that Google sign-in and checkout are not enabled yet. No payment is taken and no account is created in Phase 1.

## Decisions still required before Phase 2/3

1. Google OAuth project/client and production callback domain.
2. Payment provider name and whether monthly recurring billing is supported for the intended Indian customer/payment methods.
3. Season boundary and refund/cancellation policy.
4. Whether one account may link multiple FPL IDs, and whether Pro applies to all linked teams.
