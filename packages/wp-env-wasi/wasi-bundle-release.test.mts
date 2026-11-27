import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  appendGithubOutputs,
  pickPhpWasmCandidate,
  selectRubyWasmAsset,
  validateAndBuildWasiBundle,
  type WasiBundleManifest,
} from './wasi-bundle-release.mts';

/**
 * Construct a valid WebAssembly module > 50 KB using a valid custom section (`id = 0`).
 */
function buildValidLargeWasm(minBytes: number): Uint8Array {
  const header = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];
  const nameBytes = Buffer.from('holo', 'utf8');
  const payloadLen = minBytes + 128;
  const sectionContent = Buffer.alloc(1 + nameBytes.length + payloadLen, 0x20);
  sectionContent[0] = nameBytes.length;
  nameBytes.copy(sectionContent, 1);

  const leb: number[] = [];
  let n = sectionContent.length;
  do {
    let byte = n & 0x7f;
    n >>>= 7;
    if (n !== 0) byte |= 0x80;
    leb.push(byte);
  } while (n !== 0);

  return Buffer.concat([
    Buffer.from(header),
    Buffer.from([0x00, ...leb]),
    sectionContent,
  ]);
}

describe('wasi-bundle-release', () => {
  it('picks PHP Wasm candidates with asyncify php_8_4 priority', () => {
    assert.equal(
      pickPhpWasmCandidate([
        'package/php_8_4.wasm',
        'package/jspi/php_8_4.wasm',
        'package/asyncify/php_8_4.wasm',
      ]),
      'package/asyncify/php_8_4.wasm',
    );
    assert.equal(
      pickPhpWasmCandidate(['package/other.wasm', 'package/php_8_4.wasm']),
      'package/php_8_4.wasm',
    );
    assert.equal(
      pickPhpWasmCandidate(['package/z.wasm', 'package/a.wasm']),
      'package/a.wasm',
    );
    assert.equal(pickPhpWasmCandidate(['package/readme.md']), null);
  });

  it('selects ruby.wasm release assets with exact priority order', () => {
    const pickedExact = selectRubyWasmAsset([
      { name: 'ruby.wasm', browser_download_url: 'https://example.invalid/ruby.wasm' },
      {
        name: 'ruby-3.4-wasm32-unknown-wasip1-full.tar.gz',
        browser_download_url: 'https://example.invalid/ruby-3.4.tar.gz',
      },
    ]);
    assert.equal(pickedExact.name, 'ruby-3.4-wasm32-unknown-wasip1-full.tar.gz');

    const pickedRegex = selectRubyWasmAsset([
      {
        name: 'ruby-3.5-wasm32-unknown-wasip1-full.tar.gz',
        browser_download_url: 'https://example.invalid/ruby-3.5.tar.gz',
      },
    ]);
    assert.equal(pickedRegex.name, 'ruby-3.5-wasm32-unknown-wasip1-full.tar.gz');

    assert.throws(
      () => selectRubyWasmAsset([{ name: 'unrelated.zip', browser_download_url: 'https://x' }]),
      /No matching ruby\.wasm release asset/,
    );
  });

  it('validates real WebAssembly binaries and emits manifest + SHA512SUMS.txt', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-wasi-bundle-'));
    try {
      const wasmBytes = buildValidLargeWasm(52 * 1024);
      assert.equal(WebAssembly.validate(wasmBytes), true);

      for (const name of [
        'sqlite3-wasm32-wasi.wasm',
        'php-wasm32-wasi.wasm',
        'ruby-wasm32-wasi.wasm',
      ]) {
        fs.writeFileSync(path.join(tmp, name), wasmBytes);
      }

      const { manifest, manifestPath, sumsPath } = validateAndBuildWasiBundle({
        bundleDir: tmp,
        sqlite3Source: 'https://example.invalid/sqlite3.wasm',
        phpSource: 'npm:@php-wasm/node-8-4#package/asyncify/php_8_4.wasm',
        rubySource: 'https://example.invalid/ruby-3.4.tar.gz',
      });

      assert.equal(manifest.schema, 'holo-v11.wasi-bundle-manifest.v1');
      assert.equal(manifest.repository, 'awesome-os/wordpress-ecosystem');
      assert.equal(manifest.releaseTag, 'v11-wp-wasi-latest');
      assert.equal(manifest.artifacts.length, 3);
      assert.ok(fs.existsSync(manifestPath));
      assert.ok(fs.existsSync(sumsPath));

      const diskManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as WasiBundleManifest;
      assert.equal(diskManifest.artifacts.every((a) => a.wasmValidated), true);

      const sumLines = fs.readFileSync(sumsPath, 'utf8').trim().split('\n');
      assert.equal(sumLines.length, 4);
      const manifestSha = crypto
        .createHash('sha512')
        .update(fs.readFileSync(manifestPath))
        .digest('hex');
      assert.equal(sumLines[3], `${manifestSha}  wasi-bundle-manifest.json`);

      const ghOut = path.join(tmp, 'github-output.txt');
      appendGithubOutputs({ sqlite3_source: 's', php_source: 'p' }, ghOut);
      assert.equal(fs.readFileSync(ghOut, 'utf8'), 'sqlite3_source=s\nphp_source=p\n');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('rejects undersized or invalid WebAssembly files', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-wasi-bad-'));
    try {
      fs.writeFileSync(path.join(tmp, 'sqlite3-wasm32-wasi.wasm'), Buffer.from('not-wasm'));
      fs.writeFileSync(path.join(tmp, 'php-wasm32-wasi.wasm'), Buffer.from('not-wasm'));
      fs.writeFileSync(path.join(tmp, 'ruby-wasm32-wasi.wasm'), Buffer.from('not-wasm'));

      assert.throws(
        () =>
          validateAndBuildWasiBundle({
            bundleDir: tmp,
            sqlite3Source: 's',
            phpSource: 'p',
            rubySource: 'r',
          }),
        /must exceed/,
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
