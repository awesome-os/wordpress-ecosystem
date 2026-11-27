<!-- DOC-STATIC-CORPUS -->

# WordPress-JS & Sovereign CMS Consolidation Audit

> **Canonical Target:** [`awesome-os/wordpress-ecosystem`](https://github.com/awesome-os/wordpress-ecosystem)  
> **Runtime Substrate:** `php-wasi` (`holo-wasi-host-b8g.wasm`, `B8G_ABI_MAGIC_V3 = 0x33564742`) &amp; [`ghcr.io/awesome-os/holo-php:latest`](https://github.com/awesome-os/dockerimages/blob/main/holo-php/Dockerfile)  
> **CAS Protocol:** Holo `v11` (`v11/files/00..ff/<sha512>`) + `sqlite-wasi` drop-in (`zero node_modules`)

---

## 1. Executive Summary

Previously, WordPress-related tooling, Gutenberg route experiments, multi-tenant site directories, and PHP-WASI prototypes were split across legacy workspace trees (`Apps/wordpress-js/`, `intersections/b8g-site-cms/`), historical Docker stacks (`github.com/dockerimages/docker-wordpress`), and standalone starter repositories (`frank-dspeed/example-wp-blocks`, `frank-dspeed/generator-php`, `frank-dspeed/guide-how-to-integrate-javascript-frameworks-in-wordpress`).

This audit establishes **`awesome-os/wordpress-ecosystem`** as the single zero-dependency, `erasableSyntaxOnly: true` native Node 22/24/26 (`.mts`) monorepo unifying:

1. **Zero-Copy `@wp/env` Lifecycle &amp; Holo `v11` CAS Resolution** (`packages/wp-env-wasi/`)
2. **Gutenberg Block Comment / JSON AST Compiler** (`packages/wp-block-compiler/`)
3. **Zero-Dependency Gutenberg Route &amp; Multi-Tenant Domain-App Bridge** (`packages/gutenberg-bridge/`)
4. **Multi-Tenant Sovereign CMS Studio &amp; GitHub Pages Publisher** (`packages/site-cms/`)

No `node_modules/` directories, vendored `WordpPress/` binary dumps, or nested `gutenberg/` git clones are carried forward into the canonical monorepo.

---

## 2. Source-to-Target Consolidation Inventory

### 2.1 `Apps/wordpress-js/` Inventory

| Source Path | Observed Contents | Disposition | Target in `wordpress-ecosystem` |
| :--- | :--- | :--- | :--- |
| `Apps/wordpress-js/gutenberg/hono-app.mts` | Re-exported `gutenbergApp`, `createGutenbergApp`, `discoverGutenbergRoutes`, `DEFAULT_EXPERIMENTS_SCHEMA`, `GutenbergAppOptions`, `DiscoveredGutenbergRoute` | **Replaced with zero-dep Web Standard Bridge** | [`packages/gutenberg-bridge/gutenberg-app.mts`](../packages/gutenberg-bridge/gutenberg-app.mts) |
| `Apps/wordpress-js/gutenberg/routes/` | `24` route modules (`home`, `dashboard`, `post-list`, `post-edit`, `styles`, `template`, etc.) + `lock-unlock` | **Promoted as manifest discovery + canonical fallback** | [`discoverGutenbergRoutes()`](../packages/gutenberg-bridge/gutenberg-app.mts) |
| `Apps/wordpress-js/gutenberg/lib/experimental/experiments/` | Experiment groups (`blocks`, `media`, `interactivity`, `real-time-collaboration`, `other`) | **Consolidated into `DEFAULT_EXPERIMENTS_SCHEMA`** | [`DEFAULT_EXPERIMENTS_SCHEMA`](../packages/gutenberg-bridge/gutenberg-app.mts) |
| `Apps/wordpress-js/gutenberg/schemas/json/` | `block.json`, `font-collection.json`, `theme.json`, `wp-env.json` | **Schema contract preserved in TypeScript** | [`packages/wp-env-wasi/wp-env-wasi.mts`](../packages/wp-env-wasi/wp-env-wasi.mts) |
| `Apps/wordpress-js/WordpPress/wp-includes/` | Prebuilt `css/`, `js/dist/`, `build/` static bundle | **Excluded (resolved via Holo `v11` CAS / `php-wasi`)** | Holo `v11` CAS (`php.wasm` + WP core pack) |
| `Apps/wordpress-js/.wp-php-sites/` | Multi-tenant PHP site mount directory | **Projected dynamically onto `/sites/<id>`** | [`projectMultiTenantSites()`](../packages/gutenberg-bridge/gutenberg-app.mts) |
| `Apps/wordpress-js/src/wp-content/domain-apps/me.localhost_44/` | Domain-scoped WordPress app (`node_modules` only on disk) | **Projected onto domain routes without `node_modules`** | [`projectMultiTenantSites()`](../packages/gutenberg-bridge/gutenberg-app.mts) |

### 2.2 `intersections/b8g-site-cms/` Inventory

| Source File | Role | Target Package | Enhancements Applied |
| :--- | :--- | :--- | :--- |
| `wp-env-wasi.mts` + `wp-env-wasi.test.mts` | `@wp/env` parser, `wp-config.php` (`sqlite-wasi`), `WpEnvWasiManager` | [`packages/wp-env-wasi/`](../packages/wp-env-wasi/wp-env-wasi.mts) | Added PHP `'8.2' \| '8.3' \| '8.4' \| '8.5' \| '8.6'`, `resolvePhpWasmCas()`, `buildWpEnvHoloV11Lock()`, `exportWpEnvHoloV11Lock()` (`wp-env.holo-v11.json`) |
| `wp-block-compiler.mts` | Gutenberg comment/JSON block &amp; Markdown compiler to `<b8g-section>` | [`packages/wp-block-compiler/`](../packages/wp-block-compiler/wp-block-compiler.mts) | Promoted with dedicated `wp-block-compiler.test.mts` |
| `cms-store.mts` | Multi-tenant atomic `cms-state.json` persistence &amp; review pipeline | [`packages/site-cms/cms-store.mts`](../packages/site-cms/cms-store.mts) | Zero-dep atomic store preserved |
| `server.mts`, `ui-html.mts`, `cli.mts` | Studio server (`:7499`), dark-glass UI, CLI daemon | [`packages/site-cms/`](../packages/site-cms/server.mts) | Decoupled from root `../../site` &amp; `../../sections`; PHP `8.2`..`8.6` UI selector; `holo-ci-allow-guard` studio annotations |
| `cms-core.test.mts`, `server.test.mts` | Store, compiler, and full HTTP workflow integration tests | [`packages/site-cms/`](../packages/site-cms/server.test.mts) | Updated imports + `holoV11Lock` assertion |

### 2.3 External Upstream &amp; Historical Repositories

| External Repository | Original Role | Consolidation Target | Notes |
| :--- | :--- | :--- | :--- |
| `github.com/dockerimages/docker-wordpress` | Legacy Ubuntu/Apache/MySQL WordPress container (Tier 4 archive candidate in `awesome-os/dockerimages`) | `ghcr.io/awesome-os/holo-php:latest` + `packages/wp-env-wasi` | Replaced MySQL + Apache heavyweight stack with `php:8.4-cli-alpine` + Composer 2 + `/bin/holo-pm` + `sqlite-wasi` + `php-wasi` |
| `frank-dspeed/example-wp-blocks` | Example Gutenberg block registration &amp; build patterns | `packages/wp-block-compiler` + `packages/gutenberg-bridge` | Block AST parsing &amp; `<b8g-section>` emission without Webpack/Babel build loops |
| `frank-dspeed/generator-php` | Yeoman-style PHP project &amp; config scaffolding | `packages/wp-env-wasi` (`generateWpConfigPhp`, `buildWpEnvHoloV11Lock`) | Deterministic TypeScript generator emitting `wp-config.php`, `.wp-env.json`, and `wp-env.holo-v11.json` |
| `frank-dspeed/guide-how-to-integrate-javascript-frameworks-in-wordpress` | Guide &amp; bridge patterns for JS frameworks inside WordPress | `packages/gutenberg-bridge` + `packages/site-cms` | Web-Standard `fetch(Request)` bridge + multi-tenant `.wp-php-sites` / `domain-apps` projection |

---

## 3. Target Runtime &amp; Container Architecture

| Layer | Component | Artifact / Identifier | Description |
| :--- | :--- | :--- | :--- |
| **Container Base** | `ghcr.io/awesome-os/holo-php:latest` | `php:8.4-cli-alpine` + Composer 2 + `/bin/holo-pm` | Slim OCI image mounting `/var/lib/b8g/cas` (`COMPOSER_CACHE_DIR=/var/lib/b8g/cas/v11/composer`) |
| **WASI Host** | Holo Microkernel WASI Host | `holo-wasi-host-b8g.wasm` (`B8G_ABI_MAGIC_V3 = 0x33564742`) | Executes `php.wasm` sandboxed with zero host binary mutation |
| **Database Engine** | SQLite WASI Drop-In | `sqlite-wasi` (`DB_ENGINE = 'sqlite'`, `wp.sqlite`) | Eliminates MariaDB/MySQL sidecar containers |
| **Lock Projection** | Holo `v11` Composer / WP-Env Lock | `wp-env.holo-v11.json` (`holo-v11.wp-env.v1`) | Compatible with `holo-ci lock-compat --ecosystem composer` |
| **CI Verification** | `awesome-os/maintenance-workflows` | `reusable-holo-ci.yml@v1` | Runs all 5 `.test.mts` suites, doc verification, and `zeroGhost` / `zeroCasV1` guards |

---

## 4. Consolidation Verification Checklist

1. **Zero Vendored Bloat:** Confirm `node_modules/`, `WordpPress/`, and `gutenberg/` source clones are absent from `awesome-os/wordpress-ecosystem`.
2. **Direct Erasable TypeScript:** All source and test modules use `.mts` with `erasableSyntaxOnly: true` on Node `>=22.18.0` (`node --test`).
3. **Holo `v11` Compliance:** `wp-env-wasi` resolves `holo-wasi-host-b8g.wasm` and `php.wasm` CAS URIs under `B8G_ABI_MAGIC_V3 = '0x33564742'` and exports `wp-env.holo-v11.json`.
4. **Guard &amp; Doc Cleanliness:** `holo-ci verify` (`ok: true`, `guardViolations: []`) and `b8g-web-doc` (`0 diagnostics`).
