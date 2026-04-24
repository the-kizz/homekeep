# Paste this single line into your root Claude Code session

Open a Claude Code session as root (`sudo claude` or `ssh root@aom-wiki`
then `claude`), and paste the one line below:

```
Read @/srv/homekeep/docs/vps-setup/root-infra-sync.md and execute the Procedure section end-to-end. Write the report to /opt/vps/reports/ per the template. Do not modify currently-running services. Ask me before running Task 5 (backups cron) if /var/backups/ has pre-existing content. At the end, print the Resume prompt so I can paste it back.
```

Root Claude will:
1. Read the full instruction doc at
   `/srv/homekeep/docs/vps-setup/root-infra-sync.md`
2. Verify-before-apply each task (idempotent — safe to re-run)
3. Install `/opt/vps/CLAUDE.md` + `/opt/vps/PORTS.md`
4. Symlink each service user's `~/.claude/CLAUDE.md` to the canonical
5. Centralize GoDaddy creds at `/etc/secrets/godaddy.creds` with POSIX ACLs
6. **Ask you** before installing `/etc/cron.daily/backups-projects` (only if `/var/backups` looks fresh)
7. Write a timestamped report to `/opt/vps/reports/root-sync-<timestamp>.md`
8. Print a "resume prompt" — paste that back into your `homekeep` Claude so both sides know the new state

No running service is touched. No code is modified. No DNS changes.

If root Claude reports anything unexpected, paste the full report
content back to the `homekeep` Claude for a second opinion before
continuing.
