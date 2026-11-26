/**
 * @file gutenberg-app.test.mts
 * @description Unit tests for zero-dependency Gutenberg Route Discovery, Experiments schema,
 * and multi-tenant `.wp-php-sites` / `domain-apps` route projection.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import defaultApp, {
  createGutenbergApp,
  DEFAULT_EXPERIMENTS_SCHEMA,
  discoverGutenbergRoutes,
  gutenbergApp,
  projectMultiTenantSites,
} from './gutenberg-app.mts';

describe('gutenberg-bridge exports & schema', () => {
  it('exports default app, gutenbergApp, createGutenbergApp, discoverGutenbergRoutes, and DEFAULT_EXPERIMENTS_SCHEMA', () => {
    assert.equal(defaultApp, gutenbergApp);
    assert.equal(DEFAULT_EXPERIMENTS_SCHEMA.schema, 'gutenberg.experiments.v1');
    assert.ok(DEFAULT_EXPERIMENTS_SCHEMA.groups.length >= 5);

    const canonical = discoverGutenbergRoutes();
    assert.ok(canonical.length >= 20);
    assert.ok(canonical.some((r) => r.id === 'home' && r.path === '/'));
    assert.ok(canonical.some((r) => r.id === 'post-edit' && r.path === '/types/$type/edit/$'));
  });

  it('discovers routes from disk routes/<name>/package.json and skips lock-unlock null route', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'b8g-gutenberg-routes-'));
    try {
      const homeDir = path.join(tmpDir, 'home');
      const lockDir = path.join(tmpDir, 'lock-unlock');
      const customDir = path.join(tmpDir, 'custom-post');
      fs.mkdirSync(homeDir, { recursive: true });
      fs.mkdirSync(lockDir, { recursive: true });
      fs.mkdirSync(customDir, { recursive: true });

      fs.writeFileSync(
        path.join(homeDir, 'package.json'),
        JSON.stringify({ name: '@wordpress/home-route', route: { path: '/', page: 'site-editor-v2' } }),
      );
      fs.writeFileSync(
        path.join(lockDir, 'package.json'),
        JSON.stringify({ name: '@wordpress/routes-lock-unlock', route: null }),
      );
      fs.writeFileSync(
        path.join(customDir, 'package.json'),
        JSON.stringify({
          name: '@wordpress/custom-post',
          route: { path: '/types/$type/edit/$id', page: ['site-editor-v2'] },
        }),
      );

      const routes = discoverGutenbergRoutes(tmpDir);
      assert.equal(routes.length, 2);
      assert.equal(routes[0].id, 'custom-post');
      assert.equal(routes[1].id, 'home');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('multi-tenant .wp-php-sites & domain-apps projection', () => {
  it('projects site mounts and serves Web-Standard Request/Response routes', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'b8g-wp-sites-'));
    try {
      const wpPhpSitesDir = path.join(tmpDir, '.wp-php-sites');
      const domainAppsDir = path.join(tmpDir, 'domain-apps');
      fs.mkdirSync(path.join(wpPhpSitesDir, 'awesome-os-site'), { recursive: true });
      fs.mkdirSync(path.join(domainAppsDir, 'me.localhost_44'), { recursive: true });

      const projected = projectMultiTenantSites({ wpPhpSitesDir, domainAppsDir });
      assert.equal(projected.length, 2);
      assert.equal(projected[0].id, 'awesome-os-site');
      assert.equal(projected[0].sourceKind, 'wp-php-sites');
      assert.equal(projected[1].id, 'me.localhost_44');
      assert.equal(projected[1].domain, 'me.localhost:44');
      assert.equal(projected[1].sourceKind, 'domain-apps');

      const app = createGutenbergApp({
        wpPhpSitesDir,
        domainAppsDir,
        basePath: '/gutenberg',
      });

      const healthRes = await app.fetch(new Request('https://example.invalid/gutenberg/health'));
      assert.equal(healthRes.status, 200);
      const health = (await healthRes.json()) as { ok: boolean; siteCount: number; routeCount: number };
      assert.equal(health.ok, true);
      assert.equal(health.siteCount, 2);
      assert.ok(health.routeCount >= 20);

      const expRes = await app.fetch(new Request('https://example.invalid/gutenberg/experiments'));
      assert.equal(expRes.status, 200);
      const exp = (await expRes.json()) as { schema: string };
      assert.equal(exp.schema, 'gutenberg.experiments.v1');

      const sitesRes = await app.fetch(new Request('https://example.invalid/gutenberg/domain-apps'));
      assert.equal(sitesRes.status, 200);
      const sitesJson = (await sitesRes.json()) as { sites: Array<{ id: string }> };
      assert.equal(sitesJson.sites.length, 2);

      const tenantRouteRes = await app.fetch(
        new Request('https://example.invalid/gutenberg/sites/me.localhost_44/types/post/list/published'),
      );
      assert.equal(tenantRouteRes.status, 200);
      const tenantRoute = (await tenantRouteRes.json()) as {
        site: { domain: string };
        route: { id: string };
        params: Record<string, string>;
      };
      assert.equal(tenantRoute.site.domain, 'me.localhost:44');
      assert.equal(tenantRoute.route.id, 'post-list');
      assert.deepEqual(tenantRoute.params, { type: 'post', slug: 'published' });

      const missingRes = await app.fetch(new Request('https://example.invalid/gutenberg/does-not-exist'));
      assert.equal(missingRes.status, 404);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
