**Title options (pick one):**

- Built a free app to track home maintenance — the "what do I actually need to do this year" problem
- Tired of the "track home maintenance in a spreadsheet" advice, made an app
- New homeowner here — built a thing to track gutters/pest/HVAC/etc. sharing in case it helps someone

---

**Post body:**

Recently bought our first house. Same story everyone has: the "maintenance iceberg" — 90% of it you never thought about until you owned. Gutters twice a year, pest control quarterly, HVAC filter monthly, smoke alarm tests, sediment flush on the hot water, pressure-wash the deck, yada yada.

The common advice is "make a spreadsheet". I tried. Spreadsheets aren't actually great at this — everything shows up at once, nothing knows if you already did it, and you end up either ignoring it or stressing over things that aren't due for eight months.

So I built a small app that does a few specific things:

- **Separates what's due now from what's coming eventually.** A 365-day task shouldn't be in the same list as one due today.
- **Spreads the year's work evenly.** If you've got six annual tasks, the app doesn't let them all pile up on the same Saturday — it picks a date that's less busy.
- **Shared with your partner.** Both see the same list. Task assignment cascades so you can set "Alex always does the kitchen" once and it sticks.
- **Seasonal tasks just work.** Lawn mowing in summer, gutter cleaning in autumn — mark it seasonal, it goes dormant out of season.
- **Notifications without the SaaS.** Optional push via ntfy (free open-source app). No Google, no Firebase.

It's free, open source, self-hosted (runs on a cheap server or even a Raspberry Pi). Not a subscription, not a trial, no account with some company — your data stays on your machine.

Caveat: self-hosting means you need to be comfortable running a small Docker container. If that phrase means nothing to you, this might not be for you yet — there are friendlier options like Todoist for the price of a subscription.

If you're in the self-host-y crowd, though, the README has a one-line install and a quickstart:

https://github.com/conroyke56/homekeep

Built this while getting my head around owning a home, using Claude (AI assistant) to write a lot of the code — was a good test of what I could actually ship. Maybe it's useful to someone in the same boat.

Happy to answer questions about what kinds of tasks it handles or whether it'd fit your setup.
