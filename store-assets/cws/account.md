# Chrome Web Store — Developer Account

_Per BE-8-10 AC6 / Task 6.3. Documents which Google identity registered as the CWS developer that publishes the Milton extension — provenance + accountability so future stories know which account owns the listing. No secrets._

---

## Account ownership

- **Account email:** `pierre.jacquel@gmail.com`
- **Publisher display name (public, shown on the listing):** Milton
- **Use declaration:** Non-commercial (free, open-source extension; no payments, ads, or trackers)
- **Registration date:** 2026-05-21
- **Two-factor auth:** Enabled 2026-05-21 (2-Step Verification on the Google account)
- **$5 developer fee paid:** Yes — 2026-05-21
- **Listing ID (assigned post-Submit):** [TODO: captured from CWS dashboard URL after Task 8.6]

---

## Account choice — AC6 override (2026-05-21)

AC6 and the 2026-05-19 pre-draft batch originally specified a **Demandrel-owned** account (explicitly "NOT a personal address"). On 2026-05-21 Pierre **consciously overrode** that decision: v0.2 ships registered under `pierre.jacquel@gmail.com`, a personal Gmail, for speed of launch.

**Trade-off accepted:**

- The CWS **extension ID is generated at first publish and locked permanently** to this account.
- The listing is bound to Pierre's personal Google identity. ("Demandrel" is Pierre's pseudonymous handle / GitHub org name, not a registered company — there is no Demandrel Google Workspace to register under.)
- The **publisher display name is "Milton"** — matching the product + extension name, so the public listing reads coherently ("Milton", published by "Milton").
- The original AC6 rationale still stands as the *eventual* target: transfer-safety + account recovery tied to shared infra rather than one personal account.

**v0.3+ follow-up (not blocking v0.2):** if/when a dedicated or org-owned account is wanted, migrate the listing via a CWS **item transfer**. Manual, with some downtime risk — cheaper to do early (few users) than late. Tracked as a post-launch follow-up.

---

## Loss-of-access risk

The CWS extension ID is generated at first publish + locked to this account. Loss of access to `pierre.jacquel@gmail.com` = loss of ability to update the listing (and the locked extension ID — future updates would need a new ID, breaking auto-update for existing users).

Mitigations:

- **2FA enabled** 2026-05-21 (2-Step Verification).
- Google account **recovery info** (recovery email + phone) kept current.
- Account credentials stored in a password manager.

---

## Versioning history

| Version | Submitted | Listing status | Notes |
|---|---|---|---|
| 0.2.0 | [TODO: timestamp at Task 8.6] | Pending review | First public release |
