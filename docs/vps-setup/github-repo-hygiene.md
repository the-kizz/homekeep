# GitHub repo hygiene — best practice for every project

Checklist every new public repo on `github.com/the-kizz/*` should
satisfy. Most of it is one-time setup; some is ongoing discipline.

---

## 1. Account-level security features (turn on day one)

GitHub provides these for free on public repos. Enable via the API
or repo settings → Security:

- **Secret scanning** — GitHub scans commits for known token formats
  (AWS keys, GitHub PATs, Stripe keys, …) and alerts on matches.
- **Secret scanning push protection** — blocks pushes containing
  detected secrets at the push step. Prevents the "oh crap, I just
  pushed a PAT" problem entirely.
- **Dependabot security updates** — auto-opens PRs to patch
  known CVEs in dependencies.
- **Dependabot vulnerability alerts** — raises an issue per vulnerable
  dependency; Dependabot updates can then auto-PR them.

**All four can be enabled via a single API call:**

```bash
. /srv/<project>/.env  # for GITHUB_PAT + GITHUB_OWNER
for repo in <list-of-repos>; do
  curl -sH "Authorization: Bearer $GITHUB_PAT" -X PATCH \
    "https://api.github.com/repos/$GITHUB_OWNER/$repo" \
    -H "Content-Type: application/json" \
    -d '{"security_and_analysis":{
      "secret_scanning":{"status":"enabled"},
      "secret_scanning_push_protection":{"status":"enabled"},
      "dependabot_security_updates":{"status":"enabled"}
    }}'
  curl -sH "Authorization: Bearer $GITHUB_PAT" -X PUT \
    "https://api.github.com/repos/$GITHUB_OWNER/$repo/vulnerability-alerts"
done
```

As of 2026-04-24, all four are enabled on `the-kizz/{homekeep,
delivery-carrier, geofeed, product-attribute}`.

---

## 2. `.gitignore` — the baseline every project should ship with

See [`gitignore-baseline.md`](gitignore-baseline.md) for the full
starter template. Minimum entries:

- `.env`, `.env.local`, `.env.*.local` — app secrets
- Claude session files (see section 3)
- `*.pem`, `*.key`, `id_rsa`, `id_ed25519`, `*.gpg` — TLS / SSH / GPG
  private material (catches surprises)
- `CLAUDE.local.md` — personal overrides

---

## 3. Claude Code files — what goes in git, what doesn't

### Commit (team-shareable, versionable with the project)

| Path | Purpose |
|---|---|
| `CLAUDE.md` at repo root | Project context, coding rules, architecture notes. **THE most important file to commit.** |
| `.claude/agents/*.md` | Project-specific agent definitions |
| `.claude/skills/*/` | Project-specific skills |
| `.claude/commands/*.md` | Project-specific slash commands |
| `.claude/hooks/*` | Project-specific hooks |

### Gitignore (per-operator / per-machine / runtime)

| Path | Why |
|---|---|
| `.claude/settings.json` | Personal permission preferences |
| `.claude/settings.local.json` | Same — Anthropic explicitly designates this as not-for-commit |
| `.claude/settings.json.pre-*` | Backups from `ccstatusline` / `ccusage` installs — pure cruft |
| `.claude/scheduled_tasks.lock` | Runtime lockfile |
| `.claude/.credentials.json` | Auth token — **NEVER commit** |
| `.claude/cache/` | Runtime caches |
| `.claude/sessions/` | Per-session state |
| `.claude/history.jsonl` | Personal conversation history |
| `.claude/file-history/` | Claude's per-session file snapshots |
| `CLAUDE.local.md` | Anthropic-designated personal overrides file |

### User-global memory (NEVER commit from a project repo)

Lives in `~/.claude/projects/<hash>/memory/` and
`~/.claude/CLAUDE.md`. Often contains domain names, VPS paths, PATs,
etc. **Stays in the user's home directory** — not in any repo.

---

## 4. Secrets in the repo — what to do if you find one

### During development (pre-push)

Push protection (section 1) should block it. If it blocks, the error
message tells you the file + line; edit, recommit, re-push.

### If it already landed in git history

Secrets in git history are **compromised even if you delete them from
master** — cloners still have the history. Standard procedure:

1. **Rotate the secret immediately** (GitHub PAT, API key, whatever).
   Old value is dead — any `git clone` can read it.
2. Remove the value from the current tree (commit `.gitignore`d or
   literal deletion).
3. Optional: rewrite history with `git filter-repo --path .env
   --invert-paths` or BFG Repo-Cleaner. Only useful if the repo is
   private or has no external clones.
4. Document the rotation in a comment or changelog so the audit
   trail exists.

**Never run `git filter-repo` on a public repo with real external
users** unless you've coordinated a scorched-earth rotation with
every consumer.

---

## 5. PAT convention

- **Default to fine-grained PATs** (GA'd by GitHub in 2025).
- **One PAT per repo** — fine-grained scopes are cheap, and blast
  radius on a leaked fine-grained PAT is limited to one repo.
- Max expiry: 90 days. Calendar a rotation reminder.
- Store at `/srv/<project>/.env` (mode 600, gitignored).
- The current `homekeep/.env` holds a **classic** PAT (HOTFIX-03
  pending). Rotate to fine-grained on next touch.

---

## 6. Verification one-liners

```bash
# Is any secret pattern in full git history?
git log --all -p --full-history | grep -aE \
  "(ghp_[A-Za-z0-9]{36}|gho_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{82,}|AKIA[0-9A-Z]{16}|BEGIN (RSA|OPENSSH|DSA) PRIVATE KEY)"

# Has .env ever been committed?
git log --all --oneline -- '.env' '.env.local' 'docker/.env'

# Account-wide: any open secret-scanning alerts?
. /srv/<project>/.env
curl -sH "Authorization: Bearer $GITHUB_PAT" \
  "https://api.github.com/repos/$GITHUB_OWNER/$GITHUB_REPO/secret-scanning/alerts?state=open" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'{len(d) if isinstance(d,list) else d} alerts')"
```

Run section 6 before tagging any release. Run annually as an audit.
