#!/usr/bin/env node
// Dev-only: downloads PocketBase 0.37.1 on first run into ./.pb/ and runs it.
// Not used in production -- the container Dockerfile (01-02) bakes PB into the image.
// Requires Node 22+ (top-level await, fetch, Readable.fromWeb).

import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { execSync } from 'node:child_process';

const PB_VERSION = '0.37.1';
const PB_DIR = './.pb';
const PB_BIN = `${PB_DIR}/pocketbase`;
const MIGRATIONS_DIR = './pocketbase/pb_migrations';

const platform = process.platform === 'darwin' ? 'darwin' : 'linux';
const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';

if (!existsSync(MIGRATIONS_DIR)) {
  mkdirSync(MIGRATIONS_DIR, { recursive: true });
}

if (!existsSync(PB_BIN)) {
  console.log(`[dev-pb] downloading PocketBase ${PB_VERSION} (${platform}/${arch})...`);
  mkdirSync(PB_DIR, { recursive: true });
  const url = `https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_${platform}_${arch}.zip`;
  const zipPath = `${PB_DIR}/pb.zip`;
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
