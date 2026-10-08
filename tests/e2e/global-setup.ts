/**
 * Playwright globalSetup (04-03) — ensures a PB superuser exists for the
 * E2E run so `acceptInvite` (which needs PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD
 * to auth the admin client) has valid creds.
 *
 * Approach: after webServer spins up PB, we auth-probe the expected
 * superuser. If that fails, we shell out to `pocketbase superuser upsert`
 * — idempotent, works whether or not PB is running (SQLite WAL mode
 * handles concurrent writes per 02-01 integration-test notes).
 *
 * Env propagation: playwright.config.ts webServer.env explicitly sets
 * PB_ADMIN_EMAIL/PASSWORD with the same constants below. The constants
 * are duplicated — keep them in sync.
 */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { PB_URL } from './helpers';

const PB_BIN = './.pb/pocketbase';
const PB_DIR = './.pb/pb_data';

export const E2E_ADMIN_EMAIL = 'e2e-admin@test.local';
export const E2E_ADMIN_PASSWORD = 'e2e-admin-password-12345';

async function waitForPB(urlHealth: string, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(urlHealth);
      if (r.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((res) => setTimeout(res, 300));
  }
  throw new Error(`PB did not become healthy at ${urlHealth}`);
}

async function superuserExists(): Promise<boolean> {
  try {
    const r = await fetch(
      `${PB_URL}/api/collections/_superusers/auth-with-password`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          identity: E2E_ADMIN_EMAIL,
          password: E2E_ADMIN_PASSWORD,
        }),
      },
    );
    return r.ok;
  } catch {
    return false;
  }
}

function upsertSuperuserViaCli() {
  if (!existsSync(PB_BIN)) {
    throw new Error(
      `PocketBase binary not found at ${PB_BIN}. Run dev-pb once to download it.`,
    );
  }
  execSync(
    `${PB_BIN} superuser upsert ${E2E_ADMIN_EMAIL} ${E2E_ADMIN_PASSWORD} --dir ${PB_DIR}`,
    { stdio: 'inherit' },
  );
}

export default async function globalSetup() {
  await waitForPB(`${PB_URL}/api/health`, 60_000);
  if (await superuserExists()) return;
  upsertSuperuserViaCli();
  // Give PB a beat to pick up the new superuser row.
  await new Promise((r) => setTimeout(r, 500));
  if (!(await superuserExists())) {
    throw new Error('E2E superuser upsert succeeded but auth probe still fails');
  }
}
