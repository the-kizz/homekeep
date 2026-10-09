#!/usr/bin/env node
// Dev-only: downloads PocketBase 0.37.1 on first run into ./.pb/ and runs it.
// Not used in production -- the container Dockerfile (01-02) bakes PB into the image.
// Requires Node 22+ (top-level await, fetch, Readable.fromWeb).

import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, createReadStream, rmSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const PB_VERSION = '0.37.1';
const PB_DIR = './.pb';
const PB_BIN = `${PB_DIR}/pocketbase`;
const MIGRATIONS_DIR = './pocketbase/pb_migrations';
const HOOKS_DIR = './pocketbase/pb_hooks';

/**
 * Compute SHA-256 of a file on disk, streaming. Returns the lowercase hex digest.
 * @param {string} path
 * @returns {Promise<string>}
 */
export async function sha256File(path) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}

/**
 * Parse a PocketBase `checksums.txt` body and return the SHA-256 hex digest
 * for the named release asset. Each line is `<hex>  <filename>`.
 * Returns null if the asset isn't listed.
 * @param {string} body
 * @param {string} filename
 * @returns {string | null}
 */
export function expectedSha256(body, filename) {
  for (const line of body.split(/\r?\n/)) {
    const m = line.match(/^([0-9a-fA-F]{64})\s+(\S+)$/);
    if (m && m[2] === filename) return m[1].toLowerCase();
  }
  return null;
}

async function main() {
  const platform = process.platform === 'darwin' ? 'darwin' : 'linux';
  const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';

  if (!existsSync(MIGRATIONS_DIR)) {
    mkdirSync(MIGRATIONS_DIR, { recursive: true });
  }

  if (!existsSync(HOOKS_DIR)) {
    mkdirSync(HOOKS_DIR, { recursive: true });
  }

  if (!existsSync(PB_BIN)) {
    console.log(`[dev-pb] downloading PocketBase ${PB_VERSION} (${platform}/${arch})...`);
    mkdirSync(PB_DIR, { recursive: true });
    const zipName = `pocketbase_${PB_VERSION}_${platform}_${arch}.zip`;
    const releaseBase = `https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}`;
    const url = `${releaseBase}/${zipName}`;
    const checksumsUrl = `${releaseBase}/pocketbase_${PB_VERSION}_checksums.txt`;
    const zipPath = `${PB_DIR}/pb.zip`;

    // 1. Download the zip
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`[dev-pb] download failed: HTTP ${res.status} ${res.statusText}`);
      process.exit(1);
    }
    if (!res.body) {
      console.error('[dev-pb] download failed: empty response body');
      process.exit(1);
    }
    await pipeline(Readable.fromWeb(res.body), createWriteStream(zipPath));

    // 2. SUPPLY-05: Fetch checksums.txt and verify SHA-256 before extraction.
    // Mirrors the production Dockerfile pattern (grep " <zip>$" checksums.txt | sha256sum -c -).
    // A MITM or compromised release asset is caught here, before any binary
    // is unpacked to disk or executed.
    const checksumsRes = await fetch(checksumsUrl);
    if (!checksumsRes.ok) {
      console.error(
        `[dev-pb] checksum fetch failed: HTTP ${checksumsRes.status} ${checksumsRes.statusText} for ${checksumsUrl}`
      );
      rmSync(zipPath, { force: true });
      process.exit(1);
    }
    const checksumsBody = await checksumsRes.text();
    const expected = expectedSha256(checksumsBody, zipName);
    if (!expected) {
      console.error(`[dev-pb] checksum verification failed: ${zipName} not listed in checksums.txt`);
      rmSync(zipPath, { force: true });
      process.exit(1);
    }
    const actual = await sha256File(zipPath);
    if (actual !== expected) {
      console.error(`[dev-pb] checksum MISMATCH for ${zipName}`);
      console.error(`  expected: ${expected}`);
      console.error(`  actual:   ${actual}`);
      rmSync(zipPath, { force: true });
      process.exit(1);
    }
    console.log(`[dev-pb] checksum OK (sha256:${actual.slice(0, 12)}...)`);

    // 3. Extract and make executable
    execSync(`unzip -o ${zipPath} -d ${PB_DIR}`, { stdio: 'inherit' });
    execSync(`chmod +x ${PB_BIN}`);
    console.log(`[dev-pb] installed to ${PB_BIN}`);
  }

  const pb = spawn(
    PB_BIN,
    [
      'serve',
      '--http=127.0.0.1:8090',
      `--dir=${PB_DIR}/pb_data`,
      `--migrationsDir=${MIGRATIONS_DIR}`,
      `--hooksDir=${HOOKS_DIR}`,
      '--dev',
    ],
    { stdio: 'inherit' }
  );

  const forwardSignal = (sig) => () => {
    if (!pb.killed) pb.kill(sig);
  };
  process.on('SIGINT', forwardSignal('SIGINT'));
  process.on('SIGTERM', forwardSignal('SIGTERM'));

  pb.on('exit', (code) => process.exit(code ?? 0));
}

// Only run when invoked directly (node scripts/dev-pb.js), not when imported
// by a test. `import.meta.url` matches `process.argv[1]` when entry-point.
const isDirectInvocation =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectInvocation) {
  await main();
}
