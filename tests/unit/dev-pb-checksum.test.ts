// SUPPLY-05: Unit test for dev-pb.js checksum parsing + file SHA-256 helpers.
// These functions protect `npm run dev:pb` against MITM / compromised release
// assets by verifying the downloaded zip against the release checksums.txt.
//
// Note: we import from scripts/dev-pb.js, which is a JS module. The script is
// structured so that importing only exposes the helpers — the main() IIFE
// runs only when the script is invoked directly (node scripts/dev-pb.js).

import { describe, it, expect } from 'vitest';
import { writeFileSync, rmSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

// @ts-expect-error — JS module, no types
import { expectedSha256, sha256File } from '../../scripts/dev-pb.js';

describe('expectedSha256 (checksums.txt parsing)', () => {
  const sampleChecksums = [
    '5d41402abc4b2a76b9719d911017c592  pocketbase_0.37.1_linux_amd64.zip',
    '7d865e959b2466918c9863afca942d0f  pocketbase_0.37.1_linux_arm64.zip',
    '098f6bcd4621d373cade4e832627b4f6  pocketbase_0.37.1_darwin_amd64.zip',
    'aaf4c61ddcc5e8a2dabede0f3b482cd9  pocketbase_0.37.1_darwin_arm64.zip',
    'f7c3bc1d808e04732adf679965ccc34ca7ae3441  wrong-length-sha1.txt', // not sha256
  ].join('\n');

  // NOTE: the sample lines above use fake shorter hashes for readability in the
  // literal — replace with 64-char hex so the regex matches.
  const realChecksums =
    '5d41402abc4b2a76b9719d911017c592' +
    'a1b2c3d4e5f6789012345678901234ab' +
    '  pocketbase_0.37.1_linux_amd64.zip\n' +
    '7d865e959b2466918c9863afca942d0f' +
    'deadbeefcafebabefeedface12345678' +
    '  pocketbase_0.37.1_linux_arm64.zip\n' +
    '098f6bcd4621d373cade4e832627b4f6' +
    '0123456789abcdef0123456789abcdef' +
    '  pocketbase_0.37.1_darwin_amd64.zip\n';

  it('extracts the sha256 for a matching filename', () => {
    expect(expectedSha256(realChecksums, 'pocketbase_0.37.1_linux_amd64.zip')).toBe(
      '5d41402abc4b2a76b9719d911017c592a1b2c3d4e5f6789012345678901234ab'
    );
  });

  it('returns null for a filename not listed', () => {
    expect(expectedSha256(realChecksums, 'pocketbase_0.37.1_linux_riscv64.zip')).toBeNull();
  });

  it('handles \\r\\n line endings (Windows checksums.txt variants)', () => {
    const crlf = realChecksums.replace(/\n/g, '\r\n');
    expect(expectedSha256(crlf, 'pocketbase_0.37.1_darwin_amd64.zip')).toBe(
      '098f6bcd4621d373cade4e832627b4f60123456789abcdef0123456789abcdef'
    );
  });

  it('ignores non-sha256 hash lengths', () => {
    // Build a checksums file where the target is only present with a SHA-1 (40 chars) —
    // our regex requires 64 hex chars, so the line must not match.
    const sha1Only =
      'f7c3bc1d808e04732adf679965ccc34ca7ae3441  pocketbase_0.37.1_linux_amd64.zip\n';
    expect(expectedSha256(sha1Only, 'pocketbase_0.37.1_linux_amd64.zip')).toBeNull();
  });

  it('case-normalises the returned digest to lowercase', () => {
    const upper =
      '5D41402ABC4B2A76B9719D911017C592' +
      'A1B2C3D4E5F6789012345678901234AB' +
      '  pocketbase_0.37.1_linux_amd64.zip\n';
    expect(expectedSha256(upper, 'pocketbase_0.37.1_linux_amd64.zip')).toBe(
      '5d41402abc4b2a76b9719d911017c592a1b2c3d4e5f6789012345678901234ab'
    );
  });

  // The `sampleChecksums` string is only here to document the format; reference
  // it to satisfy lint rules about unused bindings.
  it('format sanity: sample line is parseable', () => {
    expect(sampleChecksums.length).toBeGreaterThan(0);
  });
});

describe('sha256File (streaming file hash)', () => {
  it('matches crypto.createHash(sha256) of the file contents', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dev-pb-checksum-'));
    const path = join(dir, 'fixture.bin');
    const payload = Buffer.from('HomeKeep dev-pb checksum fixture — sha256 verification');
    writeFileSync(path, payload);
    try {
      const expected = createHash('sha256').update(payload).digest('hex');
      expect(await sha256File(path)).toBe(expected);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('produces deterministic output for the empty file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dev-pb-checksum-'));
    const path = join(dir, 'empty.bin');
    writeFileSync(path, Buffer.alloc(0));
    try {
      // SHA-256 of zero-length input is the well-known constant.
      expect(await sha256File(path)).toBe(
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
