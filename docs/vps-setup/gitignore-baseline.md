# `.gitignore` baseline for every the-kizz.com project

Start every new repo with the sections below. Add project-specific
sections AFTER these (Next.js, Python, Go, whatever). This baseline
is language-agnostic — it catches secrets, Claude Code artifacts, and
common OS cruft that every repo needs regardless of stack.

---

```gitignore
# ─── Env / secrets ────────────────────────────────────────────
.env
.env.local
.env.*.local
# Backups from migration sessions etc.
*.env.pre-*-backup
*.env.*.bak

# ─── Claude Code per-session artifacts ────────────────────────
# Project-level Claude files that should travel with the repo
# live in .claude/agents/, .claude/skills/, .claude/commands/,
# .claude/hooks/ — those are committed explicitly, not gitignored.
# Everything below is personal / machine-local / runtime.
/.claude/scheduled_tasks.lock
/.claude/settings.json
/.claude/settings.local.json
/.claude/settings.json.pre-*
/.claude/.credentials.json
/.claude/cache/
/.claude/sessions/
/.claude/history.jsonl
/.claude/file-history/
CLAUDE.local.md

# ─── TLS / SSH / GPG private material (belt-and-braces) ──────
# .env covers app config; these catch anything dropped loose.
*.pem
*.key
!public.key        # allow public.key if a project really has one
*.p12
*.pfx
id_rsa
id_ed25519
*.gpg
*secret*.json
!*.secret.template.json

# ─── OS / editor cruft ────────────────────────────────────────
.DS_Store
Thumbs.db
.vscode/
.idea/
*.swp

# ─── Logs / temp ──────────────────────────────────────────────
*.log
*.tmp
```

---

## Stack-specific additions

### Next.js (HomeKeep pattern)
```gitignore
/node_modules
/.next/
/out/
/build
/.pnp
.pnp.*
/coverage
/test-results
/playwright-report
/playwright/.cache
*.tsbuildinfo
```

### Python / FastAPI
```gitignore
__pycache__/
*.py[cod]
*$py.class
.venv/
venv/
.pytest_cache/
.mypy_cache/
.ruff_cache/
*.egg-info/
dist/
build/
```

### Docker / compose
```gitignore
# Host-side data volumes / bind mounts
/data/
# Pre-migration compose env backups
docker/.env.pre-*-backup
```

### PocketBase (if the stack uses it)
```gitignore
# Dev PocketBase (dev-pb.js or similar downloads binary + data here)
/.pb/
# PocketBase runtime state (generated on first boot)
/pocketbase/pb_data/
```

---

## How to use this

**For a new repo:**
```bash
curl -sL https://raw.githubusercontent.com/the-kizz/homekeep/master/docs/vps-setup/gitignore-baseline.md \
  | sed -n '/^```gitignore$/,/^```$/p' \
  | grep -v '^```' \
  > .gitignore
# Then append stack-specific sections manually.
```

**For a project that already has a `.gitignore`:**
Diff against this baseline and add any missing lines. Order in the
file doesn't matter to git.

---

## Review cadence

- **Year-1:** re-read this doc quarterly; patterns drift as tooling
  evolves (e.g. Claude Code adds new runtime files, AWS rotates its
  key format).
- **On new Claude Code release:** check the release notes for new
  paths under `.claude/` and update this baseline.
- **On new stack:** add a section above when you pick up a language
  not already listed.
