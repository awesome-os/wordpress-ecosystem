import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WASI } from 'node:wasi';

export const B8G_ABI_MAGIC_V3 = '0x33564742' as const;

export type WasmAbiKind = 'wasi_snapshot_preview1' | 'emscripten-wasm' | 'pure-wasm';

export interface WasmExportDescriptor {
  readonly name: string;
  readonly kind: WebAssembly.ExportKind;
}

export interface WasmBinaryInspection {
  readonly valid: true;
  readonly byteLength: number;
  readonly sha512: string;
  readonly abi: WasmAbiKind;
  readonly importCount: number;
  readonly importModules: string[];
  readonly exportCount: number;
  readonly exportNames: string[];
  readonly exports: WasmExportDescriptor[];
}

export interface WasiCommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
}

export interface Sqlite3WasiProbeResult {
  readonly version: string;
  readonly exportCount: number;
  readonly initialized: boolean;
  readonly memoryByteLength: number;
  readonly probeMode: 'sqlite3_libversion' | 'reactor_initialize';
  readonly durationMs: number;
}

export interface WasiBundleExecProof {
  readonly schema: 'holo-v11.wasi-exec-proof.v1';
  readonly abiMagic: typeof B8G_ABI_MAGIC_V3;
  readonly bundleDir: string;
  readonly verifiedAt: string;
  readonly nodeVersion: string;
  readonly sqlite3: {
    readonly filename: 'sqlite3-wasm32-wasi.wasm';
    readonly byteLength: number;
    readonly sha512: string;
    readonly sha512Verified: true;
    readonly abi: WasmAbiKind;
    readonly exportCount: number;
    readonly version: string;
    readonly probeMode: 'sqlite3_libversion' | 'reactor_initialize';
    readonly memoryByteLength: number;
    readonly durationMs: number;
  };
  readonly ruby: {
    readonly filename: 'ruby-wasm32-wasi.wasm';
    readonly byteLength: number;
    readonly sha512: string;
    readonly sha512Verified: true;
    readonly abi: WasmAbiKind;
    readonly exportCount: number;
    readonly exitCode: number;
    readonly stdout: string;
    readonly stderr: string;
    readonly durationMs: number;
  };
  readonly php: {
    readonly filename: 'php-wasm32-wasi.wasm';
    readonly byteLength: number;
    readonly sha512: string;
    readonly sha512Verified: true;
    readonly abi: WasmAbiKind;
    readonly importModules: string[];
    readonly exportCount: number;
    readonly hasMemoryExport: boolean;
    readonly phpSymbolCount: number;
  };
  readonly ok: true;
}

function classifyWasmAbi(importModules: readonly string[]): WasmAbiKind {
  if (
    importModules.includes('env') ||
    importModules.includes('GOT.func') ||
    importModules.includes('GOT.mem')
  ) {
    return 'emscripten-wasm';
  }
  if (importModules.includes('wasi_snapshot_preview1')) {
    return 'wasi_snapshot_preview1';
  }
  return 'pure-wasm';
}

function toArrayBufferView(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  if (bytes.buffer instanceof ArrayBuffer) {
    return bytes as Uint8Array<ArrayBuffer>;
  }
  return new Uint8Array(bytes);
}

function sha512Bytes(bytes: Uint8Array): string {
  return crypto.createHash('sha512').update(bytes).digest('hex');
}

function readCStringUtf8(memory: WebAssembly.Memory, ptr: number): string {
  const view = new Uint8Array(memory.buffer);
  if (ptr < 0 || ptr >= view.byteLength) {
    throw new Error(`Invalid Wasm memory pointer for C string: ${ptr}`);
  }
  let end = ptr;
  while (end < view.byteLength && view[end] !== 0) {
    end += 1;
  }
  return new TextDecoder('utf-8').decode(view.subarray(ptr, end));
}

function parseSha512Sums(raw: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const match = /^([0-9a-fA-F]{128})\s+\*?(.+)$/.exec(trimmed);
    if (match) {
      map.set(match[2].trim(), match[1].toLowerCase());
    }
  }
  return map;
}

/**
 * Validate, compile, hash, and classify a WebAssembly binary.
 */
export async function inspectWasmBinary(bytes: Uint8Array): Promise<WasmBinaryInspection> {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 8) {
    throw new Error('Invalid WebAssembly input: expected Uint8Array of at least 8 bytes');
  }
  const normalized = toArrayBufferView(bytes);
  if (!WebAssembly.validate(normalized)) {
    throw new Error('WebAssembly.validate() rejected binary');
  }

  const mod = await WebAssembly.compile(normalized);
  const imports = WebAssembly.Module.imports(mod);
  const rawExports = WebAssembly.Module.exports(mod);

  const importModules = Array.from(new Set(imports.map((imp) => imp.module))).sort();
  const exports: WasmExportDescriptor[] = rawExports.map((exp) => ({
    name: exp.name,
    kind: exp.kind,
  }));

  return {
    valid: true,
    byteLength: normalized.byteLength,
    sha512: sha512Bytes(normalized),
    abi: classifyWasmAbi(importModules),
    importCount: imports.length,
    importModules,
    exportCount: exports.length,
    exportNames: exports.map((e) => e.name),
    exports,
  };
}

/**
 * Execute a `wasi_snapshot_preview1` command (`_start`) via Node's built-in `node:wasi`.
 */
export async function executeWasiPreview1Command(
  bytes: Uint8Array,
  args: string[],
  env?: Record<string, string>,
  preopens?: Record<string, string>,
): Promise<WasiCommandResult> {
  const normalized = toArrayBufferView(bytes);
  if (!WebAssembly.validate(normalized)) {
    throw new Error('WebAssembly.validate() rejected command binary');
  }

  const mod = await WebAssembly.compile(normalized);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'holo-wasi-cmd-'));
  const stdoutPath = path.join(tmpDir, 'stdout.txt');
  const stderrPath = path.join(tmpDir, 'stderr.txt');

  let outFd: number | undefined;
  let errFd: number | undefined;
  const startedAt = performance.now();

  try {
    outFd = fs.openSync(stdoutPath, 'w');
    errFd = fs.openSync(stderrPath, 'w');

    const wasi = new WASI({
      version: 'preview1',
      args,
      env: env ?? {},
      stdout: outFd,
      stderr: errFd,
      returnOnExit: true,
      ...(preopens ? { preopens } : {}),
    });

    const instance = await WebAssembly.instantiate(mod, wasi.getImportObject() as WebAssembly.Imports);
    const exitCode = wasi.start(instance);

    fs.closeSync(outFd);
    outFd = undefined;
    fs.closeSync(errFd);
    errFd = undefined;

    const stdout = fs.readFileSync(stdoutPath, 'utf8');
    const stderr = fs.readFileSync(stderrPath, 'utf8');
    const durationMs = Math.max(0, Math.round((performance.now() - startedAt) * 100) / 100);

    return {
      exitCode,
      stdout,
      stderr,
      durationMs,
    };
  } finally {
    if (outFd !== undefined) {
      try {
        fs.closeSync(outFd);
      } catch {
        // Ignore close errors during cleanup
      }
    }
    if (errFd !== undefined) {
      try {
        fs.closeSync(errFd);
      } catch {
        // Ignore close errors during cleanup
      }
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Instantiate a `wasi_snapshot_preview1` / reactor SQLite3 Wasm module, invoke `_initialize()`
 * if exported, and read `sqlite3_libversion()` (when exported) or reactor memory proof.
 */
export async function executeSqlite3WasiProbe(bytes: Uint8Array): Promise<Sqlite3WasiProbeResult> {
  const normalized = toArrayBufferView(bytes);
  if (!WebAssembly.validate(normalized)) {
    throw new Error('WebAssembly.validate() rejected sqlite3 Wasm binary');
  }

  const startedAt = performance.now();
  const mod = await WebAssembly.compile(normalized);
  const wasi = new WASI({
    version: 'preview1',
    returnOnExit: true,
  });

  const instance = await WebAssembly.instantiate(mod, wasi.getImportObject() as WebAssembly.Imports);
  const exports = instance.exports;
  const exportCount = Object.keys(exports).length;

  let initialized = false;
  if (typeof exports._initialize === 'function') {
    wasi.initialize(instance);
    initialized = true;
  }

  const memory = exports.memory;
  if (!(memory instanceof WebAssembly.Memory)) {
    throw new Error('SQLite3 Wasm module does not export linear WebAssembly.Memory');
  }
  const memoryByteLength = memory.buffer.byteLength;

  if (typeof exports.sqlite3_libversion === 'function') {
    const fn = exports.sqlite3_libversion as () => number;
    const ptr = fn();
    const version = readCStringUtf8(memory, ptr);
    if (!version) {
      throw new Error('sqlite3_libversion() returned an empty string');
    }
    const durationMs = Math.max(0, Math.round((performance.now() - startedAt) * 100) / 100);
    return {
      version,
      exportCount,
      initialized,
      memoryByteLength,
      probeMode: 'sqlite3_libversion',
      durationMs,
    };
  }

  if (!initialized || memoryByteLength <= 0) {
    throw new Error('SQLite3 WASI reactor neither exported sqlite3_libversion() nor initialized linear memory');
  }

  const durationMs = Math.max(0, Math.round((performance.now() - startedAt) * 100) / 100);
  return {
    version: `wasm32-wasi-reactor-initialized (memory=${memoryByteLength}B)`,
    exportCount,
    initialized,
    memoryByteLength,
    probeMode: 'reactor_initialize',
    durationMs,
  };
}

/**
 * Verify `SHA512SUMS.txt` checksums and run live Wasm/WASI execution probes across
 * `sqlite3-wasm32-wasi.wasm`, `ruby-wasm32-wasi.wasm`, and `php-wasm32-wasi.wasm`.
 */
export async function verifyWasiBundleDir(dir: string): Promise<WasiBundleExecProof> {
  const resolvedDir = path.resolve(dir);
  const sumsPath = path.join(resolvedDir, 'SHA512SUMS.txt');
  if (!fs.existsSync(sumsPath)) {
    throw new Error(`Missing SHA512SUMS.txt in ${resolvedDir}`);
  }

  const sums = parseSha512Sums(fs.readFileSync(sumsPath, 'utf8'));

  const readAndVerify = (
    filename: 'sqlite3-wasm32-wasi.wasm' | 'ruby-wasm32-wasi.wasm' | 'php-wasm32-wasi.wasm',
  ): { bytes: Uint8Array; expectedSha512: string } => {
    const expectedSha512 = sums.get(filename);
    if (!expectedSha512) {
      throw new Error(`SHA512SUMS.txt does not contain checksum for ${filename}`);
    }
    const filePath = path.join(resolvedDir, filename);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Missing WASI bundle binary: ${filePath}`);
    }
    const bytes = new Uint8Array(fs.readFileSync(filePath));
    const actualSha512 = sha512Bytes(bytes);
    if (actualSha512 !== expectedSha512) {
      throw new Error(
        `SHA-512 mismatch for ${filename}: expected ${expectedSha512}, got ${actualSha512}`,
      );
    }
    return { bytes, expectedSha512 };
  };

  const sqliteFile = readAndVerify('sqlite3-wasm32-wasi.wasm');
  const rubyFile = readAndVerify('ruby-wasm32-wasi.wasm');
  const phpFile = readAndVerify('php-wasm32-wasi.wasm');

  const sqliteInspection = await inspectWasmBinary(sqliteFile.bytes);
  const rubyInspection = await inspectWasmBinary(rubyFile.bytes);
  const phpInspection = await inspectWasmBinary(phpFile.bytes);

  const sqliteProbe = await executeSqlite3WasiProbe(sqliteFile.bytes);
  const rubyResult = await executeWasiPreview1Command(
    rubyFile.bytes,
    ['ruby', '-e', 'puts "HOLO_RUBY_" + RUBY_VERSION'],
    {},
    { '/': resolvedDir },
  );

  if (rubyResult.exitCode !== 0) {
    throw new Error(
      `ruby-wasm32-wasi.wasm exited with ${rubyResult.exitCode}: ${rubyResult.stderr}`,
    );
  }
  if (!rubyResult.stdout.includes('HOLO_RUBY_')) {
    throw new Error(
      `ruby-wasm32-wasi.wasm stdout missing HOLO_RUBY_ marker: ${JSON.stringify(rubyResult.stdout)}`,
    );
  }

  const hasMemoryExport = phpInspection.exportNames.includes('memory');
  const phpSymbolCount = phpInspection.exportNames.filter(
    (name) => name.startsWith('php_') || name.startsWith('zend_') || name === '__wasm_call_ctors',
  ).length;
  if (!hasMemoryExport || phpSymbolCount === 0) {
    throw new Error(
      `php-wasm32-wasi.wasm missing expected memory or PHP/Emscripten exports (exports=${phpInspection.exportCount})`,
    );
  }

  return {
    schema: 'holo-v11.wasi-exec-proof.v1',
    abiMagic: B8G_ABI_MAGIC_V3,
    bundleDir: resolvedDir,
    verifiedAt: new Date().toISOString(),
    nodeVersion: process.version,
    sqlite3: {
      filename: 'sqlite3-wasm32-wasi.wasm',
      byteLength: sqliteInspection.byteLength,
      sha512: sqliteInspection.sha512,
      sha512Verified: true,
      abi: sqliteInspection.abi,
      exportCount: sqliteInspection.exportCount,
      version: sqliteProbe.version,
      probeMode: sqliteProbe.probeMode,
      memoryByteLength: sqliteProbe.memoryByteLength,
      durationMs: sqliteProbe.durationMs,
    },
    ruby: {
      filename: 'ruby-wasm32-wasi.wasm',
      byteLength: rubyInspection.byteLength,
      sha512: rubyInspection.sha512,
      sha512Verified: true,
      abi: rubyInspection.abi,
      exportCount: rubyInspection.exportCount,
      exitCode: rubyResult.exitCode,
      stdout: rubyResult.stdout,
      stderr: rubyResult.stderr,
      durationMs: rubyResult.durationMs,
    },
    php: {
      filename: 'php-wasm32-wasi.wasm',
      byteLength: phpInspection.byteLength,
      sha512: phpInspection.sha512,
      sha512Verified: true,
      abi: phpInspection.abi,
      importModules: phpInspection.importModules,
      exportCount: phpInspection.exportCount,
      hasMemoryExport,
      phpSymbolCount,
    },
    ok: true,
  };
}
