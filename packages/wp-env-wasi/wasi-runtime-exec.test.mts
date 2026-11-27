import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  B8G_ABI_MAGIC_V3,
  executeSqlite3WasiProbe,
  executeWasiPreview1Command,
  inspectWasmBinary,
  verifyWasiBundleDir,
} from './wasi-runtime-exec.mts';

function u32Leb(value: number): number[] {
  const out: number[] = [];
  let v = value >>> 0;
  do {
    let byte = v & 0x7f;
    v >>>= 7;
    if (v !== 0) {
      byte |= 0x80;
    }
    out.push(byte);
  } while (v !== 0);
  return out;
}

function encodeString(text: string): number[] {
  const bytes = Array.from(new TextEncoder().encode(text));
  return [...u32Leb(bytes.length), ...bytes];
}

function encodeSection(id: number, payload: number[]): number[] {
  return [id, ...u32Leb(payload.length), ...payload];
}

/**
 * Hand-encode a minimal valid `wasi_snapshot_preview1` command `.wasm` module:
 * imports `fd_write` + `proc_exit`, writes `"HOLO_WASI_OK\n"` to fd 1, and exits 0.
 */
function buildMinimalWasiHelloWasm(): Uint8Array {
  const msgBytes = Array.from(new TextEncoder().encode('HOLO_WASI_OK\n'));
  // iovec at offset 0: ptr = 16 (0x10), len = 13 (0x0d)
  const iovecBytes = [16, 0, 0, 0, msgBytes.length, 0, 0, 0];

  // Type section:
  // 0: (i32, i32, i32, i32) -> (i32)  [fd_write]
  // 1: (i32) -> ()                    [proc_exit]
  // 2: () -> ()                       [_start]
  const typeSection = encodeSection(1, [
    3,
    0x60, 4, 0x7f, 0x7f, 0x7f, 0x7f, 1, 0x7f,
    0x60, 1, 0x7f, 0,
    0x60, 0, 0,
  ]);

  // Import section:
  // func 0: wasi_snapshot_preview1.fd_write (type 0)
  // func 1: wasi_snapshot_preview1.proc_exit (type 1)
  const importSection = encodeSection(2, [
    2,
    ...encodeString('wasi_snapshot_preview1'), ...encodeString('fd_write'), 0x00, 0,
    ...encodeString('wasi_snapshot_preview1'), ...encodeString('proc_exit'), 0x00, 1,
  ]);

  // Function section: func 2 has type 2
  const funcSection = encodeSection(3, [1, 2]);

  // Memory section: 1 memory, min 1 page
  const memSection = encodeSection(5, [1, 0x00, 1]);

  // Export section: "memory" -> memory 0, "_start" -> func 2
  const exportSection = encodeSection(7, [
    2,
    ...encodeString('memory'), 0x02, 0,
    ...encodeString('_start'), 0x00, 2,
  ]);

  // Code section for _start:
  // fd_write(1, 0, 1, 32); drop; proc_exit(0);
  const body = [
    0x00, // 0 local declarations
    0x41, 0x01, // i32.const 1 (stdout)
    0x41, 0x00, // i32.const 0 (iovs ptr)
    0x41, 0x01, // i32.const 1 (iovs_len)
    0x41, 0x20, // i32.const 32 (nwritten ptr)
    0x10, 0x00, // call 0 (fd_write)
    0x1a,       // drop
    0x41, 0x00, // i32.const 0
    0x10, 0x01, // call 1 (proc_exit)
    0x0b,       // end
  ];
  const codeSection = encodeSection(10, [1, ...u32Leb(body.length), ...body]);

  // Data section:
  // seg 0: offset 0 -> iovecBytes
  // seg 1: offset 16 -> msgBytes
  const dataSection = encodeSection(11, [
    2,
    0x00, 0x41, 0x00, 0x0b, ...u32Leb(iovecBytes.length), ...iovecBytes,
    0x00, 0x41, 0x10, 0x0b, ...u32Leb(msgBytes.length), ...msgBytes,
  ]);

  return new Uint8Array([
    0x00, 0x61, 0x73, 0x6d,
    0x01, 0x00, 0x00, 0x00,
    ...typeSection,
    ...importSection,
    ...funcSection,
    ...memSection,
    ...exportSection,
    ...codeSection,
    ...dataSection,
  ]);
}

/**
 * Hand-encode a minimal reactor `.wasm` module exporting `memory`, `_initialize`,
 * and `sqlite3_libversion() -> i32` pointing to `"3.49.1\0"`.
 */
function buildMinimalSqliteReactorWasm(includeLibversion: boolean): Uint8Array {
  const versionBytes = Array.from(new TextEncoder().encode('3.49.1\0'));

  const typeSection = encodeSection(
    1,
    includeLibversion
      ? [2, 0x60, 0, 0, 0x60, 0, 1, 0x7f]
      : [1, 0x60, 0, 0],
  );

  const funcSection = encodeSection(3, includeLibversion ? [2, 0, 1] : [1, 0]);
  const memSection = encodeSection(5, [1, 0x00, 1]);

  const exportItems = [
    ...encodeString('memory'), 0x02, 0,
    ...encodeString('_initialize'), 0x00, 0,
  ];
  if (includeLibversion) {
    exportItems.push(...encodeString('sqlite3_libversion'), 0x00, 1);
  }
  const exportSection = encodeSection(7, [includeLibversion ? 3 : 2, ...exportItems]);

  const initBody = [0x00, 0x0b];
  const libversionBody = [0x00, 0x41, 0x10, 0x0b];
  const codePayload = includeLibversion
    ? [2, ...u32Leb(initBody.length), ...initBody, ...u32Leb(libversionBody.length), ...libversionBody]
    : [1, ...u32Leb(initBody.length), ...initBody];
  const codeSection = encodeSection(10, codePayload);

  const dataSection = encodeSection(11, [
    1,
    0x00, 0x41, 0x10, 0x0b, ...u32Leb(versionBytes.length), ...versionBytes,
  ]);

  return new Uint8Array([
    0x00, 0x61, 0x73, 0x6d,
    0x01, 0x00, 0x00, 0x00,
    ...typeSection,
    ...funcSection,
    ...memSection,
    ...exportSection,
    ...codeSection,
    ...dataSection,
  ]);
}

describe('wasi-runtime-exec hermetic WASI probes', () => {
  it('inspects and executes a hand-encoded wasi_snapshot_preview1 command binary', async () => {
    const wasmBytes = buildMinimalWasiHelloWasm();
    const inspection = await inspectWasmBinary(wasmBytes);

    assert.equal(inspection.valid, true);
    assert.equal(inspection.abi, 'wasi_snapshot_preview1');
    assert.deepEqual(inspection.importModules, ['wasi_snapshot_preview1']);
    assert.equal(inspection.importCount, 2);
    assert.deepEqual(inspection.exportNames, ['memory', '_start']);
    assert.match(inspection.sha512, /^[0-9a-f]{128}$/);

    const result = await executeWasiPreview1Command(wasmBytes, ['holo-test']);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, 'HOLO_WASI_OK\n');
    assert.equal(result.stderr, '');
    assert.ok(result.durationMs >= 0);
  });

  it('probes reactor modules both with sqlite3_libversion() and _initialize-only fallback', async () => {
    const withLibver = buildMinimalSqliteReactorWasm(true);
    const probe1 = await executeSqlite3WasiProbe(withLibver);
    assert.equal(probe1.version, '3.49.1');
    assert.equal(probe1.probeMode, 'sqlite3_libversion');
    assert.equal(probe1.initialized, true);
    assert.equal(probe1.exportCount, 3);

    const reactorOnly = buildMinimalSqliteReactorWasm(false);
    const inspection = await inspectWasmBinary(reactorOnly);
    assert.equal(inspection.abi, 'pure-wasm');
    const probe2 = await executeSqlite3WasiProbe(reactorOnly);
    assert.equal(probe2.probeMode, 'reactor_initialize');
    assert.equal(probe2.initialized, true);
    assert.ok(probe2.version.includes('reactor-initialized'));
    assert.equal(probe2.memoryByteLength, 65536);
  });
});

const liveBundleDir = process.env.HOLO_WP_WASI_LIVE_DIR;

describe('wasi-runtime-exec live v11-wp-wasi-latest bundle verification', () => {
  it(
    'verifies SHA-512 checksums and executes live sqlite3, ruby, and php WASI artifacts',
    { skip: !liveBundleDir },
    async () => {
      const proof = await verifyWasiBundleDir(liveBundleDir!);
      assert.equal(proof.schema, 'holo-v11.wasi-exec-proof.v1');
      assert.equal(proof.abiMagic, B8G_ABI_MAGIC_V3);
      assert.equal(proof.ok, true);

      assert.equal(proof.sqlite3.sha512Verified, true);
      assert.ok(proof.sqlite3.version.length > 0);
      assert.ok(proof.sqlite3.memoryByteLength > 0);

      assert.equal(proof.ruby.sha512Verified, true);
      assert.equal(proof.ruby.exitCode, 0);
      assert.ok(proof.ruby.stdout.includes('HOLO_RUBY_'));

      assert.equal(proof.php.sha512Verified, true);
      assert.equal(proof.php.hasMemoryExport, true);
      assert.ok(proof.php.phpSymbolCount > 0);
    },
  );
});
