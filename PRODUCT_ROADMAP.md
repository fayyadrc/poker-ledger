# Poker Ledger — Product Analysis & Roadmap

Your app is a solid home-game ledger MVP: tables, live sessions, settlements, sharing, and import/export. Below is what’s strong today, what to improve first, and what to add next.

---

## What you already have

| Area | Capabilities |
|------|----------------|
| **Core ledger** | Tables, members, sessions, buy-ins/rebuys, cash-outs, complete with discrepancy handling |
| **Settlements** | Who-pays-whom after each night + all-time leaderboard |
| **Sharing** | Share links, viewer join, leave/remove, change requests |
| **Data** | JSON export/import, audit log, multi-currency |
| **Extras** | Chip calculator, hand rankings, light/dark theme, PWA (prod) |
| **Infra** | Owner isolation + RLS, Redis caching, Docker/Render |

The product job is clear: run a night, balance chips, settle cash, keep a running score among friends.

---

## Make better (highest leverage)

### 1. Finish half-built features

These exist in the model/API but feel incomplete in the product:

- **Off-table transfers** — shown and imported, but no create/edit/delete UI. Friends settle mid-week; this should be a first-class action on the table page.
- **`default_buy_in`** — on the table model, unused in UI. Wire it into “Start session” / buy-in defaults.
- **Audit labels** — some actions (`session_imported`, change-request events) still show raw codes; map them like the rest.

### 2. Collaboration that matches how groups play

Viewers can only watch and raise requests; owners do all edits.

- Let owners **apply** a change request (or at least deep-link into the session edit with prefilled values).
- Optional **co-host / editor** role so one person isn’t the bottleneck mid-game.
- Allow viewers to open **active** shared sessions (not just list them).

### 3. Session UX polish

- Link the **chip calculator → cash-out** (or a quick “count stack” per player) so cash-out isn’t pure number entry.
- Stronger **balance feedback** while cashing out (who’s short/over, running delta).
- **Default buy-in** + quick rebuy chips (e.g. +1 buy-in) for speed at the table.

### 4. Account basics

- Password reset / forgot password
- Optional email verification (you currently skip it)
- Social login only if you care about conversion; email/password + reset is enough for a friend-group app

### 5. Trust & clarity on settlements

- Mark settlements as **paid / unpaid** (and sync those into the leaderboard / transfers).
- Show a simple “running balance between A and B” so people don’t only see per-session IOUs.
- Copy-friendly settlement text (“Alice pays Bob £40”) for WhatsApp/iMessage.

---

## Add next (new features worth building)

Prioritized for a poker home-game product:

### Must-have for retention

1. **Mark settlements paid** + optional off-table transfer creation from unpaid settlements
2. **Player profiles / history** — sessions played, win rate, biggest win/loss, streak (per table)
3. **Reminders / unpaid badge** on table cards (“£120 unsettled”)
4. **Better analytics** — profit over time chart, by month, by player; filter completed sessions

### Strong differentiators

5. **Live multiplayer session** — co-hosts enter buy-ins; others see live pot/balance (WebSocket or polling)
6. **Invite by email/link with roles** (owner / editor / viewer) instead of only a generic share token
7. **Payment deep links** (Venmo/PayPal/Wise/Revolut URL schemes) from each settlement row
8. **Blind / structure notes** on a session (stakes, location, notes) for memory, not just money

### Nice-to-have later

9. Season / series mode (e.g. 10-night league standings)
10. Recurring table templates (“Friday home game”)
11. Receipt / session share image for Stories/chat
12. Push notifications for “session started” / “settlement ready” / “change request”
13. Merge/rename players with real alias support (`Aly` → `Aaliyah`) — currently only whitespace trim
14. Guest players who aren’t permanent table members

---

## What I’d deprioritize

- Expanding Learn/hand rankings beyond a light reference
- Heavy social/feed features
- Complex tournament brackets unless you explicitly want MTT support
- Overbuilding the calculator unless it’s tied into cash-out

---

## Suggested roadmap (practical order)

| Phase | Focus |
|-------|--------|
| **A — Close gaps** | Transfer CRUD, default buy-in, audit labels, password reset, settlement “copy / mark paid” |
| **B — Everyday use** | Player stats, unpaid balances, calculator → cash-out, apply change requests |
| **C — Multiplayer feel** | Editor role or live session updates, better share UX |
| **D — Stickiness** | Charts, payment links, notifications, seasons |

---

## Bottom line

The core loop (table → session → settle → leaderboard) is already good. The biggest product wins are finishing **transfers + paid settlements**, making **viewers/co-hosts more useful mid-game**, and adding **player history / unpaid balance** so the app stays valuable between game nights—not only during them.
