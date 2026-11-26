/**
 * @file gh-pages.mts
 * @description Self-contained zero-dependency GitHub Pages staging and publishing helper.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export interface StageGhPagesOptions {
  readonly siteDir: string;
  readonly repo: string;
  readonly outDir: string;
  readonly cname?: string;
  readonly branch?: string;
  readonly maxFileBytes?: number;
}

export interface StageGhPagesResult {
  readonly outDir: string;
  readonly repo: string;
  readonly cname?: string;
  readonly fileCount: number;
  readonly totalBytes: number;
  readonly skippedLargeFiles: string[];
  readonly manifestSha256: string;
}

const PAGES_WORKFLOW_YAML = `name: Deploy Static Site to GitHub Pages

on:
  push:
    branches: ["main"]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: "pages"
  cancel-in-progress: false

jobs:
  deploy:
    environment:
      name: github-pages
      url: \${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
      - name: Setup Pages
        uses: actions/configure-pages@v5
      - name: Upload artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: "."
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
`;

function walkFiles(rootDir: string, relBase = ''): string[] {
  const out: string[] = [];
  if (!fs.existsSync(rootDir)) return out;
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const abs = path.join(rootDir, entry.name);
    const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(...walkFiles(abs, rel));
    } else if (entry.isFile()) {
      out.push(rel);
    }
  }
  return out.sort();
}

export function stageGhPagesRepo(opts: StageGhPagesOptions): StageGhPagesResult {
  const srcRoot = path.resolve(opts.siteDir);
  if (!fs.existsSync(srcRoot)) {
    throw new Error(`Site source directory does not exist: ${srcRoot}`);
  }
  const outDir = path.resolve(opts.outDir);
  const maxBytes = opts.maxFileBytes ?? 95 * 1024 * 1024;

  fs.mkdirSync(outDir, { recursive: true });
  for (const entry of fs.readdirSync(outDir)) {
    if (entry === '.git') continue;
    fs.rmSync(path.join(outDir, entry), { recursive: true, force: true });
  }

  const relFiles = walkFiles(srcRoot);
  const manifestEntries: Array<{ path: string; bytes: number; sha256: string }> = [];
  const skippedLargeFiles: string[] = [];
  let totalBytes = 0;

  for (const rel of relFiles) {
    const srcPath = path.join(srcRoot, rel);
    const st = fs.statSync(srcPath);
    if (st.size > maxBytes) {
      skippedLargeFiles.push(rel);
      continue;
    }
    const dstPath = path.join(outDir, rel);
    fs.mkdirSync(path.dirname(dstPath), { recursive: true });
    const buf = fs.readFileSync(srcPath);
    fs.writeFileSync(dstPath, buf);
    const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
    manifestEntries.push({ path: rel, bytes: buf.length, sha256 });
    totalBytes += buf.length;
  }

  fs.writeFileSync(path.join(outDir, '.nojekyll'), '', 'utf8');
  if (opts.cname && opts.cname.trim()) {
    fs.writeFileSync(path.join(outDir, 'CNAME'), `${opts.cname.trim()}\n`, 'utf8');
  }

  const notFoundPath = path.join(outDir, '404.html');
  if (!fs.existsSync(notFoundPath)) {
    const fallback404 =
      '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8" /><title>404 — Page Not Found</title></head>' +
      '<body style="background:#070b12;color:#e6eefb;font-family:system-ui,sans-serif;padding:48px;">' +
      '<h1>404 — Page Not Found</h1><p><a href="/" style="color:#38bdf8;">Return to home</a></p></body></html>\n';
    fs.writeFileSync(notFoundPath, fallback404, 'utf8');
  }

  const wfDir = path.join(outDir, '.github', 'workflows');
  fs.mkdirSync(wfDir, { recursive: true });
  fs.writeFileSync(path.join(wfDir, 'pages.yml'), PAGES_WORKFLOW_YAML, 'utf8');

  const manifestObj = {
    schema: 'b8g.gh-pages-manifest.v1',
    repo: opts.repo,
    cname: opts.cname ?? null,
    fileCount: manifestEntries.length,
    totalBytes,
    skippedLargeFiles,
    files: manifestEntries,
  };
  const manifestJson = `${JSON.stringify(manifestObj, null, 2)}\n`;
  fs.writeFileSync(path.join(outDir, 'pages-manifest.json'), manifestJson, 'utf8');
  const manifestSha256 = crypto.createHash('sha256').update(manifestJson).digest('hex');

  return {
    outDir,
    repo: opts.repo,
    cname: opts.cname,
    fileCount: manifestEntries.length,
    totalBytes,
    skippedLargeFiles,
    manifestSha256,
  };
}

function runCmd(bin: string, args: string[], cwd: string): { status: number; stdout: string; stderr: string } {
  const res = spawnSync(bin, args, {
    cwd,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });
  return {
    status: res.status ?? 1,
    stdout: res.stdout || '',
    stderr: res.stderr || '',
  };
}

export function publishGhPagesRepo(
  opts: StageGhPagesOptions & { readonly createRepo?: boolean },
): StageGhPagesResult {
  const branch = opts.branch ?? 'main';
  const remoteUrl = `https://github.com/${opts.repo}.git`;
  const outDir = path.resolve(opts.outDir);

  const view = runCmd('gh', ['repo', 'view', opts.repo], outDir);
  const repoExists = view.status === 0;

  if (!repoExists && opts.createRepo) {
    const created = runCmd(
      'gh',
      ['repo', 'create', opts.repo, '--public', '--description', `GitHub Pages site for ${opts.cname ?? opts.repo}`],
      path.dirname(outDir),
    );
    if (created.status !== 0) {
      throw new Error(`Failed to create GitHub repo ${opts.repo}: ${created.stderr || created.stdout}`);
    }
  } else if (repoExists) {
    if (fs.existsSync(outDir)) fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(outDir), { recursive: true });
    const cloned = runCmd('git', ['clone', '--depth', '1', remoteUrl, outDir], path.dirname(outDir));
    if (cloned.status !== 0) {
      fs.mkdirSync(outDir, { recursive: true });
    }
  }

  const staged = stageGhPagesRepo(opts);

  if (!fs.existsSync(path.join(staged.outDir, '.git'))) {
    runCmd('git', ['init', '-b', branch], staged.outDir);
    runCmd('git', ['remote', 'add', 'origin', remoteUrl], staged.outDir);
  }
  runCmd('git', ['add', '-A'], staged.outDir);
  const diff = runCmd('git', ['status', '--porcelain'], staged.outDir);
  if (diff.stdout.trim()) {
    runCmd('git', ['commit', '-m', `chore(pages): publish ${opts.repo} (${staged.manifestSha256.slice(0, 12)})`], staged.outDir);
    const push = runCmd('git', ['push', '-u', 'origin', branch], staged.outDir);
    if (push.status !== 0) {
      throw new Error(`git push failed for ${opts.repo}: ${push.stderr || push.stdout}`);
    }
  }

  return staged;
}
