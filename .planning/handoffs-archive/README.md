# Handoff archive

Historical mid-session handoff docs preserved for traceability.
The **current** handoff (if any) lives at the `.planning/` root.

## Naming convention

- Primary: `HANDOFF-YYYY-MM-DD.md`
- Multiple handoffs in one day: `HANDOFF-YYYY-MM-DD-NN.md` (zero-padded sequence)

## What each handoff is for

A handoff is written when a session needs to end mid-work with enough
context to resume cleanly in a fresh Claude session — typically
because context is running low or the operator wants a clean break.

**Not every session produces a handoff.** Only ones with genuine
unfinished work or unusual state that can't be reconstructed from
git history + planning docs.

## Cleanup cadence

When a milestone ships (e.g. v1.2.1), the handoffs covering the
work leading up to it can be moved here. The freshest handoff
stays at the root as the "resume prompt" for future sessions.
