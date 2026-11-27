#!/usr/bin/env node
/**
 * @file packages/wp-env-wasi/wasi-bundle-release.mts
 * @description Real upstream WASI binary acquisition (`sqlite3`, `@php-wasm/node-8-4`,
 *   `ruby.wasm`), WebAssembly binary validation, manifest + `SHA512SUMS.txt` emission,
 *   and GitHub Release publishing for `v11-wp-wasi-latest`.
 *
 * Strictly `erasableSyntaxOnly: true` & Node built-ins only (`shell: false`).
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateWasmBinaryHeader,
  WP_WASI_BUNDLE_RELEASE_TAG,
  WP_WASI_BUNDLE_REPO,
} from './wp-env-wasi.mts';

export const SQLITE3_WASI_UPSTREAM_URL =
  'https://github.com/awesome-os/upstream-mirrors/releases/download/v11-max-5os-latest/libsqlite3-wasm32-wasi.wasm';

export const PHP_WASM_NPM_CANDIDATES = [
  '@php-wasm/node-8-4',
  '@php-wasm/web-8-4',
  'php-cgi-wasm',
] as const;

export interface GitHubReleaseAsset {
  readonly name: string;
  readonly browser_download_url: string;
}

export interface WasiBundleArtifactEntry {
  readonly id: 'sqlite3' | 'php' | 'ruby';
  readonly filename: string;
  readonly bytes: number;
  readonly sha512: string;
  readonly wasmValidated: true;
  readonly upstreamSource: string;
}

export interface WasiBundleManifest {
  readonly schema: 'holo-v11.wasi-bundle-manifest.v1';
  readonly repository: string;
  readonly releaseTag: string;
  readonly generatedAt: string;
  readonly artifacts: readonly WasiBundleArtifactEntry[];
}

export interface ValidateBundleOptions {
  readonly bundleDir: string;
  readonly sqlite3Source: string;
  readonly phpSource: string;
  readonly rubySource: string;
  readonly minBytes?: number;
}

export function pickPhpWasmCandidate(relativeWasmPaths: readonly string[]): string | null {
  const normalized = relativeWasmPaths
    .map((p) => p.replace(/\\/g, '/'))
    .filter((p) => p.endsWith('.wasm'));
  const asyncify = normalized.find((p) => /asyncify\/.*php_8_4\.wasm$/.test(p));
  if (asyncify) return asyncify;
  const php84 = normalized.find((p) => /php_8_4\.wasm$/.test(p));
  if (php84) return php84;
  const sorted = [...normalized].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return sorted[0] ?? null;
}

export function selectRubyWasmAsset(
  assets: readonly GitHubReleaseAsset[],
): GitHubReleaseAsset {
  const exact = assets.find((a) => a.name === 'ruby-3.4-wasm32-unknown-wasip1-full.tar.gz');
  if (exact) return exact;
  const wasip1 = assets.find((a) => /wasm32-unknown-wasip1-full\.tar\.gz$/.test(a.name));
  if (wasip1) return wasip1;
  const wasiLegacy = assets.find((a) =>
    /wasm32-unknown-wasi-full.*\.(tar\.gz|tgz)$/.test(a.name),
  );
  if (wasiLegacy) return wasiLegacy;
  const rawWasm = assets.find((a) => a.name === 'ruby.wasm');
  if (rawWasm) return rawWasm;
  throw new Error(
    `No matching ruby.wasm release asset found: ${assets.map((a) => a.name).join(', ')}`,
  );
}

export function appendGithubOutputs(
  outputs: Readonly<Record<string, string>>,
  outputFilePath: string | undefined = process.env.GITHUB_OUTPUT,
): void {
  if (!outputFilePath) return;
  const lines = Object.entries(outputs).map(([key, value]) => `${key}=${value}\n`);
  fs.appendFileSync(outputFilePath, lines.join(''), 'utf8');
}

function walkFiles(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      walkFiles(full, out);
    } else if (ent.isFile()) {
      out.push(full);
    }
  }
  return out;
}

async function downloadToFile(
  url: string,
  destPath: string,
  headers: Readonly<Record<string, string>> = {},
): Promise<void> {
  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} downloading ${url}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, buf);
}

async function fetchPhpWasiBinary(workPhpDir: string, outWasmPath: string): Promise<string> {
  const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  for (const pkg of PHP_WASM_NPM_CANDIDATES) {
    fs.rmSync(workPhpDir, { recursive: true, force: true });
    fs.mkdirSync(workPhpDir, { recursive: true });
    try {
      execFileSync(npmBin, ['pack', pkg, '--silent'], {
        cwd: workPhpDir,
        stdio: 'inherit',
        shell: false,
      });
    } catch {
      continue;
    }
    const tgz = fs.readdirSync(workPhpDir).find((f) => f.endsWith('.tgz'));
    if (!tgz) continue;
    execFileSync('tar', ['-xzf', tgz], {
      cwd: workPhpDir,
      stdio: 'inherit',
      shell: false,
    });
    const pkgDir = path.join(workPhpDir, 'package');
    const relPaths = walkFiles(pkgDir).map((f) =>
      path.relative(workPhpDir, f).replace(/\\/g, '/'),
    );
    const candidate = pickPhpWasmCandidate(relPaths);
    if (!candidate) continue;
    const candidateFull = path.join(workPhpDir, candidate);
    if (fs.existsSync(candidateFull) && fs.statSync(candidateFull).size > 0) {
      fs.copyFileSync(candidateFull, outWasmPath);
      const source = `npm:${pkg}#${candidate}`;
      console.log(`Extracted PHP Wasm from ${source}`);
      return source;
    }
  }
  throw new Error(
    `Failed to acquire real PHP Wasm binary from ${PHP_WASM_NPM_CANDIDATES.join(', ')}`,
  );
}

async function fetchRubyWasiBinary(
  workRubyDir: string,
  outWasmPath: string,
  ghToken: string | undefined,
): Promise<string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'awesome-os-wordpress-ecosystem-wasi-bundle',
  };
  if (ghToken) {
    headers.Authorization = `Bearer ${ghToken}`;
  }
  const relRes = await fetch('https://api.github.com/repos/ruby/ruby.wasm/releases/latest', {
    headers,
  });
  if (!relRes.ok) {
    throw new Error(`HTTP ${relRes.status} querying ruby/ruby.wasm latest release`);
  }
  const relData = (await relRes.json()) as { assets?: GitHubReleaseAsset[] };
  const picked = selectRubyWasmAsset(Array.isArray(relData.assets) ? relData.assets : []);
  console.log(`Downloading Ruby WASI from ${picked.browser_download_url}`);

  fs.rmSync(workRubyDir, { recursive: true, force: true });
  fs.mkdirSync(workRubyDir, { recursive: true });

  if (picked.browser_download_url.endsWith('.wasm')) {
    await downloadToFile(picked.browser_download_url, outWasmPath);
    return picked.browser_download_url;
  }

  const archivePath = path.join(workRubyDir, 'ruby-wasi.tar.gz');
  await downloadToFile(picked.browser_download_url, archivePath);
  execFileSync('tar', ['-xzf', archivePath], {
    cwd: workRubyDir,
    stdio: 'inherit',
    shell: false,
  });
  const allFiles = walkFiles(workRubyDir).map((f) => f.replace(/\\/g, '/'));
  const rubyBin =
    allFiles.find((f) => f.endsWith('/usr/local/bin/ruby')) ??
    allFiles.find((f) => path.posix.basename(f) === 'ruby.wasm');
  if (!rubyBin || fs.statSync(rubyBin).size === 0) {
    throw new Error(`Failed to locate usr/local/bin/ruby inside ${picked.browser_download_url}`);
  }
  fs.copyFileSync(rubyBin, outWasmPath);
  return picked.browser_download_url;
}

export async function fetchAllUpstreamWasi(repoRoot: string): Promise<{
  readonly sqlite3Source: string;
  readonly phpSource: string;
  readonly rubySource: string;
}> {
  const bundleDir = path.join(repoRoot, 'dist', 'wasi-bundle');
  const workPhpDir = path.join(repoRoot, 'work', 'php');
  const workRubyDir = path.join(repoRoot, 'work', 'ruby');
  fs.mkdirSync(bundleDir, { recursive: true });

  console.log(`Downloading SQLite3 WASI from ${SQLITE3_WASI_UPSTREAM_URL}`);
  await downloadToFile(
    SQLITE3_WASI_UPSTREAM_URL,
    path.join(bundleDir, 'sqlite3-wasm32-wasi.wasm'),
  );
  const sqlite3Source = SQLITE3_WASI_UPSTREAM_URL;

  const phpSource = await fetchPhpWasiBinary(
    workPhpDir,
    path.join(bundleDir, 'php-wasm32-wasi.wasm'),
  );

  const rubySource = await fetchRubyWasiBinary(
    workRubyDir,
    path.join(bundleDir, 'ruby-wasm32-wasi.wasm'),
    process.env.GH_TOKEN,
  );

  appendGithubOutputs({
    sqlite3_source: sqlite3Source,
    php_source: phpSource,
    ruby_source: rubySource,
  });

  for (const name of fs.readdirSync(bundleDir)) {
    const size = fs.statSync(path.join(bundleDir, name)).size;
    console.log(`[bundle] ${name}: ${size} bytes`);
  }

  return { sqlite3Source, phpSource, rubySource };
}

export function validateAndBuildWasiBundle(
  options: ValidateBundleOptions,
): { readonly manifest: WasiBundleManifest; readonly manifestPath: string; readonly sumsPath: string } {
  const bundleDir = path.resolve(options.bundleDir);
  const minBytes = options.minBytes ?? 50 * 1024;
  const specs: ReadonlyArray<{
    readonly id: 'sqlite3' | 'php' | 'ruby';
    readonly filename: string;
    readonly upstreamSource: string;
  }> = [
    {
      id: 'sqlite3',
      filename: 'sqlite3-wasm32-wasi.wasm',
      upstreamSource: options.sqlite3Source,
    },
    {
      id: 'php',
      filename: 'php-wasm32-wasi.wasm',
      upstreamSource: options.phpSource,
    },
    {
      id: 'ruby',
      filename: 'ruby-wasm32-wasi.wasm',
      upstreamSource: options.rubySource,
    },
  ];

  const artifacts: WasiBundleArtifactEntry[] = [];
  const checksumLines: string[] = [];

  for (const spec of specs) {
    const filePath = path.join(bundleDir, spec.filename);
    assert.ok(fs.existsSync(filePath), `Missing WASI binary: ${spec.filename}`);
    const bytes = fs.readFileSync(filePath);
    assert.ok(
      bytes.byteLength > minBytes,
      `${spec.filename} must exceed ${minBytes} bytes (got ${bytes.byteLength} bytes)`,
    );
    assert.equal(
      validateWasmBinaryHeader(bytes),
      true,
      `${spec.filename} failed validateWasmBinaryHeader()`,
    );
    assert.equal(
      WebAssembly.validate(bytes),
      true,
      `${spec.filename} failed WebAssembly.validate()`,
    );

    const sha512 = crypto.createHash('sha512').update(bytes).digest('hex');
    artifacts.push({
      id: spec.id,
      filename: spec.filename,
      bytes: bytes.byteLength,
      sha512,
      wasmValidated: true,
      upstreamSource: spec.upstreamSource,
    });
    checksumLines.push(`${sha512}  ${spec.filename}`);
    console.log(
      `VERIFIED: ${spec.filename} ${bytes.byteLength} bytes sha512=${sha512.slice(0, 16)}...`,
    );
  }

  const manifest: WasiBundleManifest = {
    schema: 'holo-v11.wasi-bundle-manifest.v1',
    repository: WP_WASI_BUNDLE_REPO,
    releaseTag: WP_WASI_BUNDLE_RELEASE_TAG,
    generatedAt: new Date().toISOString(),
    artifacts,
  };

  const manifestPath = path.join(bundleDir, 'wasi-bundle-manifest.json');
  const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`;
  fs.writeFileSync(manifestPath, manifestJson, 'utf8');

  const manifestSha512 = crypto.createHash('sha512').update(manifestJson, 'utf8').digest('hex');
  checksumLines.push(`${manifestSha512}  wasi-bundle-manifest.json`);

  const sumsPath = path.join(bundleDir, 'SHA512SUMS.txt');
  fs.writeFileSync(sumsPath, `${checksumLines.join('\n')}\n`, 'utf8');

  return { manifest, manifestPath, sumsPath };
}

function publishWasiRelease(repoRoot: string, targetSha: string): void {
  const bundleDir = path.join(repoRoot, 'dist', 'wasi-bundle');
  const tag = WP_WASI_BUNDLE_RELEASE_TAG;

  let exists = false;
  try {
    execFileSync('gh', ['release', 'view', tag], { stdio: 'ignore', shell: false });
    exists = true;
  } catch {
    exists = false;
  }

  if (!exists) {
    execFileSync(
      'gh',
      [
        'release',
        'create',
        tag,
        '--target',
        targetSha,
        '--title',
        `WordPress Ecosystem Real WASI Runtime Bundle (${tag})`,
        '--notes',
        'Verified real WASI/Wasm runtime binaries (php-wasm32-wasi.wasm, sqlite3-wasm32-wasi.wasm, ruby-wasm32-wasi.wasm), wasi-bundle-manifest.json, and SHA512SUMS.txt validated via WebAssembly.validate().',
      ],
      { stdio: 'inherit', shell: false },
    );
  }

  execFileSync(
    'gh',
    [
      'release',
      'upload',
      tag,
      path.join(bundleDir, 'sqlite3-wasm32-wasi.wasm'),
      path.join(bundleDir, 'php-wasm32-wasi.wasm'),
      path.join(bundleDir, 'ruby-wasm32-wasi.wasm'),
      path.join(bundleDir, 'wasi-bundle-manifest.json'),
      path.join(bundleDir, 'SHA512SUMS.txt'),
      '--clobber',
    ],
    { stdio: 'inherit', shell: false },
  );
}

function parseMode(argv: readonly string[]): string {
  const idx = argv.indexOf('--mode');
  if (idx === -1 || !argv[idx + 1]) {
    throw new Error('Missing --mode <fetch|validate|publish>');
  }
  return argv[idx + 1];
}

async function main(): Promise<void> {
  const mode = parseMode(process.argv.slice(2));
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

  if (mode === 'fetch') {
    await fetchAllUpstreamWasi(repoRoot);
    return;
  }
  if (mode === 'validate') {
    validateAndBuildWasiBundle({
      bundleDir: path.join(repoRoot, 'dist', 'wasi-bundle'),
      sqlite3Source: process.env.SQLITE3_SOURCE ?? SQLITE3_WASI_UPSTREAM_URL,
      phpSource: process.env.PHP_SOURCE ?? '@php-wasm/node-8-4',
      rubySource: process.env.RUBY_SOURCE ?? 'ruby/ruby.wasm',
    });
    return;
  }
  if (mode === 'publish') {
    const sha = process.env.GITHUB_SHA || 'main';
    publishWasiRelease(repoRoot, sha);
    return;
  }
  throw new Error(`Unsupported --mode: ${mode}`);
}

const isMain =
  Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
