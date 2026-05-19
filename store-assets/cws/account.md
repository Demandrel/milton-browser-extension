# Chrome Web Store — Demandrel Developer Account

_Per BE-8-10 AC6 / Task 6.3. Documents which Demandrel-owned identity registered as the CWS developer that publishes the Milton extension. No secrets — just provenance + accountability so future stories know which account owns the listing._

---

## Account ownership

- **Account email:** [TODO: Pierre to fill in before clicking Submit. Demandrel-owned email only — NEVER a personal address.]
- **Registration date:** [TODO: YYYY-MM-DD, filled in at Task 6.1 completion]
- **Two-factor auth method:** [TODO: Google Authenticator / hardware key / etc. — required per Task 6.2]
- **$5 developer fee paid:** [TODO: Yes / No + date. Demandrel-billed card.]
- **Listing ID (assigned post-Submit):** [TODO: captured from CWS dashboard URL after Task 8.6]

---

## Why org-owned and not Pierre individual

Pre-draft batch decision 2026-05-19: Demandrel org account, not Pierre's personal Google account. Rationale:

- **Transfer-safe.** If Demandrel hires team members later, the CWS listing stays with the org. Transferring from a personal CWS account to an org account requires Google support intervention + risks downtime; starting at the org avoids the future tax.
- **Matches AGPL repo ownership.** The public source repo is `github.com/Demandrel/...`. The CWS listing publisher attribution should match.
- **Accountability.** A Demandrel-owned email is part of org SSO + visible in shared infra logs; a personal email isn't.

---

## Loss-of-access risk

The CWS extension ID is generated at first publish + locked to this account. Loss of access to the registered account = loss of ability to update the listing (and therefore loss of the locked extension ID, which means future updates would have to register under a new ID, breaking auto-update for existing users).

Mitigations (Demandrel SOP for service accounts presumably covers these already):

- 2FA enabled (mandatory per Task 6.2)
- Recovery info points to org-owned secondary email + Demandrel admin
- Account credentials stored in Demandrel's password manager
- At least one Demandrel admin has account-recovery permissions

---

## Versioning history

| Version | Submitted | Listing status | Notes |
|---|---|---|---|
| 0.2.0 | [TODO: timestamp at Task 8.6] | Pending review | First public release |
