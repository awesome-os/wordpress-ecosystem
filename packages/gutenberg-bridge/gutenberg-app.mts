/**
 * @file gutenberg-app.mts
 * @description Zero-dependency erasable-TS Gutenberg Route Discovery & Multi-Tenant
 * `.wp-php-sites` / `domain-apps` Web-Standard App Bridge (`fetch(Request) -> Promise<Response>`).
 * Replaces Node `node_modules` Hono boilerplate while preserving the exact export contract
 * of `Apps/wordpress-js/gutenberg/hono-app.mts`.
 */

import fs from 'node:fs';
import path from 'node:path';

export interface GutenbergExperimentItem {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly defaultEnabled: boolean;
}

export interface GutenbergExperimentGroup {
  readonly slug: string;
  readonly label: string;
  readonly items: readonly GutenbergExperimentItem[];
}

export interface GutenbergExperimentsSchema {
  readonly schema: 'gutenberg.experiments.v1';
  readonly groups: readonly GutenbergExperimentGroup[];
}

export const DEFAULT_EXPERIMENTS_SCHEMA: GutenbergExperimentsSchema = {
  schema: 'gutenberg.experiments.v1',
  groups: [
    {
      slug: 'blocks',
      label: 'Blocks',
      items: [
        {
          id: 'gutenberg-block-experiments',
          label: 'Experimental blocks',
          description: 'Enables experimental blocks on a rolling basis as they are developed.',
          defaultEnabled: false,
        },
        {
          id: 'gutenberg-grid-interactivity',
          label: 'Grid interactivity',
          description: 'Enables grid item movement and resizing in the editor canvas.',
          defaultEnabled: false,
        },
      ],
    },
    {
      slug: 'media',
      label: 'Media',
      items: [
        {
          id: 'gutenberg-media-editor',
          label: 'Media Editor (Route)',
          description: 'Replaces the core Edit Media screen with a route-based media editor.',
          defaultEnabled: false,
        },
        {
          id: 'gutenberg-dataviews-media-modal',
          label: 'Media Upload Modal',
          description: 'Replaces the WordPress media modal with a DataViews-powered modal.',
          defaultEnabled: false,
        },
      ],
    },
    {
      slug: 'interactivity',
      label: 'Interactivity',
      items: [
        {
          id: 'gutenberg-full-page-client-side-navigation',
          label: 'Full-page client-side navigation',
          description: 'Enables full-page client-side navigation powered by the Interactivity API.',
          defaultEnabled: false,
        },
      ],
    },
    {
      slug: 'real-time-collaboration',
      label: 'Real-Time Collaboration',
      items: [
        {
          id: 'gutenberg-real-time-collaboration',
          label: 'Enable real-time collaboration',
          description: 'Allows multiple editors to collaborate on the same post in real time.',
          defaultEnabled: false,
        },
      ],
    },
    {
      slug: 'other',
      label: 'Other',
      items: [
        {
          id: 'gutenberg-workflow-palette',
          label: 'Workflow Palette',
          description: 'Enables the Workflow Palette composed of abilities.',
          defaultEnabled: false,
        },
      ],
    },
  ],
};

export interface DiscoveredGutenbergRoute {
  readonly id: string;
  readonly packageName: string;
  readonly path: string;
  readonly page: readonly string[];
  readonly sourceDir?: string;
}

export interface ProjectedSiteMount {
  readonly id: string;
  readonly domain: string;
  readonly sourceKind: 'wp-php-sites' | 'domain-apps';
  readonly mountPath: string;
  readonly baseRoute: string;
  readonly routes: readonly DiscoveredGutenbergRoute[];
}

export interface GutenbergAppOptions {
  readonly routesDir?: string;
  readonly wpPhpSitesDir?: string;
  readonly domainAppsDir?: string;
  readonly basePath?: string;
  readonly experiments?: GutenbergExperimentsSchema;
  readonly routes?: readonly DiscoveredGutenbergRoute[];
}

export interface GutenbergAppHandle {
  readonly basePath: string;
  readonly routes: readonly DiscoveredGutenbergRoute[];
  readonly sites: readonly ProjectedSiteMount[];
  readonly experiments: GutenbergExperimentsSchema;
  fetch(request: Request): Promise<Response>;
}

const CANONICAL_GUTENBERG_ROUTES: readonly DiscoveredGutenbergRoute[] = [
  { id: 'connectors-home', packageName: '@wordpress/connectors-home-route', path: '/', page: ['options-connectors'] },
  { id: 'dashboard', packageName: '@wordpress/dashboard-route', path: '/', page: ['dashboard'] },
  { id: 'experiments-home', packageName: '@wordpress/experiments-home-route', path: '/', page: ['experiments'] },
  { id: 'font-list', packageName: '@wordpress/font-list-route', path: '/font-list', page: ['site-editor', 'font-library'] },
  { id: 'fonts-home', packageName: '@wordpress/fonts-home-route', path: '/', page: ['font-library'] },
  { id: 'guidelines', packageName: '@wordpress/guidelines-route', path: '/', page: ['guidelines'] },
  { id: 'home', packageName: '@wordpress/home-route', path: '/', page: ['site-editor-v2'] },
  { id: 'identity', packageName: '@wordpress/identity-route', path: '/identity', page: ['site-editor-v2'] },
  { id: 'media-editor', packageName: '@wordpress/media-editor-route', path: '/media-editor/$id', page: ['site-editor-v2', 'media-editor'] },
  { id: 'navigation', packageName: '@wordpress/navigation-route', path: '/navigation', page: ['site-editor-v2'] },
  { id: 'navigation-edit', packageName: '@wordpress/navigation-edit-route', path: '/navigation/edit/$id', page: ['site-editor-v2'] },
  { id: 'navigation-list', packageName: '@wordpress/navigation-list-route', path: '/navigation/list', page: ['site-editor-v2'] },
  { id: 'pattern', packageName: '@wordpress/pattern', path: '/patterns', page: ['site-editor-v2'] },
  { id: 'pattern-list', packageName: '@wordpress/pattern-list', path: '/patterns/list/$type', page: ['site-editor-v2'] },
  { id: 'post', packageName: '@wordpress/post', path: '/types/$type', page: ['site-editor-v2'] },
  { id: 'post-edit', packageName: '@wordpress/post-edit', path: '/types/$type/edit/$', page: ['site-editor-v2'] },
  { id: 'post-list', packageName: '@wordpress/post-list', path: '/types/$type/list/$slug', page: ['site-editor-v2'] },
  { id: 'post-new', packageName: '@wordpress/post-new', path: '/types/$type/new', page: ['site-editor-v2'] },
  { id: 'site-health', packageName: '@wordpress/site-health-route', path: '/site-health', page: ['dashboard'] },
  { id: 'styles', packageName: '@wordpress/styles-route', path: '/styles', page: ['site-editor-v2', 'theme-preview'] },
  { id: 'template', packageName: '@wordpress/template', path: '/templates', page: ['site-editor-v2'] },
  { id: 'template-list', packageName: '@wordpress/template-list', path: '/templates/list/$activeView', page: ['site-editor-v2'] },
  { id: 'template-part', packageName: '@wordpress/template-part', path: '/template-parts', page: ['site-editor-v2'] },
  { id: 'template-part-list', packageName: '@wordpress/template-part-list', path: '/template-parts/list/$area', page: ['site-editor-v2'] },
];

function normalizeRoutePath(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === '/') return '/';
  return `/${trimmed.replace(/^\/+|\/+$/g, '')}`;
}

function normalizePageList(page: unknown): string[] {
  if (typeof page === 'string' && page.trim().length > 0) {
    return [page.trim()];
  }
  if (Array.isArray(page)) {
    return page
      .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
      .map((entry) => entry.trim());
  }
  return ['site-editor-v2'];
}

/**
 * Discover Gutenberg route manifests from `routes/<name>/package.json`, falling back
 * to the canonical 24 Gutenberg route definitions when no directory is supplied or present.
 */
export function discoverGutenbergRoutes(routesDir?: string): DiscoveredGutenbergRoute[] {
  if (!routesDir || !fs.existsSync(routesDir)) {
    return CANONICAL_GUTENBERG_ROUTES.map((r) => ({ ...r, page: [...r.page] }));
  }

  const entries = fs
    .readdirSync(routesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name));

  const discovered: DiscoveredGutenbergRoute[] = [];
  for (const entry of entries) {
    const pkgPath = path.join(routesDir, entry.name, 'package.json');
    if (!fs.existsSync(pkgPath)) continue;

    try {
      const parsed = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as {
        name?: string;
        route?: { path?: string; page?: string | string[] } | null;
      };
      if (!parsed.route || typeof parsed.route.path !== 'string') continue;

      discovered.push({
        id: entry.name,
        packageName: parsed.name ?? `@wordpress/${entry.name}`,
        path: normalizeRoutePath(parsed.route.path),
        page: normalizePageList(parsed.route.page),
        sourceDir: path.join(routesDir, entry.name),
      });
    } catch {
      // Ignore malformed route package.json manifests.
    }
  }

  return discovered.length > 0
    ? discovered
    : CANONICAL_GUTENBERG_ROUTES.map((r) => ({ ...r, page: [...r.page] }));
}

function normalizeDomainFromFolder(folderName: string): string {
  return folderName.replace(/_/g, ':');
}

/**
 * Project multi-tenant `.wp-php-sites` and `src/wp-content/domain-apps` directories
 * onto deterministic Gutenberg route mounts without vendoring `node_modules`.
 */
export function projectMultiTenantSites(
  opts: {
    readonly wpPhpSitesDir?: string;
    readonly domainAppsDir?: string;
    readonly routes?: readonly DiscoveredGutenbergRoute[];
  } = {},
): ProjectedSiteMount[] {
  const baseRoutes = opts.routes ?? CANONICAL_GUTENBERG_ROUTES;
  const mounts: ProjectedSiteMount[] = [];

  const scanDir = (dir: string | undefined, sourceKind: 'wp-php-sites' | 'domain-apps'): void => {
    if (!dir || !fs.existsSync(dir)) return;
    const entries = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const id = entry.name.toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
      const domain = normalizeDomainFromFolder(entry.name);
      const baseRoute = `/sites/${encodeURIComponent(id)}`;
      mounts.push({
        id,
        domain,
        sourceKind,
        mountPath: path.join(dir, entry.name),
        baseRoute,
        routes: baseRoutes.map((route) => ({
          ...route,
          path: route.path === '/' ? baseRoute : `${baseRoute}${route.path}`,
          page: [...route.page],
        })),
      });
    }
  };

  scanDir(opts.wpPhpSitesDir, 'wp-php-sites');
  scanDir(opts.domainAppsDir, 'domain-apps');
  return mounts;
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function matchParameterizedRoute(
  patternPath: string,
  requestPath: string,
): Record<string, string> | null {
  const patSegs = normalizeRoutePath(patternPath).split('/').filter(Boolean);
  const reqSegs = normalizeRoutePath(requestPath).split('/').filter(Boolean);

  if (patSegs.length === 0 && reqSegs.length === 0) {
    return {};
  }
  if (patSegs.length !== reqSegs.length) {
    return null;
  }

  const params: Record<string, string> = {};
  for (let i = 0; i < patSegs.length; i++) {
    const pat = patSegs[i]!;
    const req = reqSegs[i]!;
    if (pat.startsWith('$')) {
      const key = pat.slice(1) || `param${i}`;
      params[key] = decodeURIComponent(req);
    } else if (pat !== req) {
      return null;
    }
  }
  return params;
}

/**
 * Create a zero-dependency Web-Standard Gutenberg App Bridge (`fetch(Request) -> Promise<Response>`).
 */
export function createGutenbergApp(options: GutenbergAppOptions = {}): GutenbergAppHandle {
  const basePath = options.basePath ? normalizeRoutePath(options.basePath) : '';
  const routes = options.routes
    ? options.routes.map((r) => ({ ...r, page: [...r.page] }))
    : discoverGutenbergRoutes(options.routesDir);
  const experiments = options.experiments ?? DEFAULT_EXPERIMENTS_SCHEMA;
  const sites = projectMultiTenantSites({
    wpPhpSitesDir: options.wpPhpSitesDir,
    domainAppsDir: options.domainAppsDir,
    routes,
  });

  async function fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    let pathname = url.pathname || '/';
    if (basePath && basePath !== '/' && pathname.startsWith(basePath)) {
      pathname = pathname.slice(basePath.length) || '/';
    }
    pathname = normalizeRoutePath(pathname);

    if (request.method === 'GET' && pathname === '/health') {
      return jsonResponse({
        ok: true,
        service: 'gutenberg-bridge',
        routeCount: routes.length,
        siteCount: sites.length,
      });
    }

    if (request.method === 'GET' && pathname === '/routes') {
      return jsonResponse({
        ok: true,
        routes,
      });
    }

    if (request.method === 'GET' && pathname === '/experiments') {
      return jsonResponse({
        ok: true,
        ...experiments,
      });
    }

    if (request.method === 'GET' && (pathname === '/sites' || pathname === '/domain-apps')) {
      return jsonResponse({
        ok: true,
        sites,
      });
    }

    // Check multi-tenant projected site routes first
    for (const site of sites) {
      for (const route of site.routes) {
        const params = matchParameterizedRoute(route.path, pathname);
        if (params !== null) {
          return jsonResponse({
            ok: true,
            site: { id: site.id, domain: site.domain, sourceKind: site.sourceKind },
            route,
            params,
          });
        }
      }
    }

    // Check primary Gutenberg routes
    for (const route of routes) {
      const params = matchParameterizedRoute(route.path, pathname);
      if (params !== null) {
        return jsonResponse({
          ok: true,
          route,
          params,
        });
      }
    }

    return jsonResponse(
      {
        ok: false,
        error: `Route not found: ${request.method} ${pathname}`,
      },
      404,
    );
  }

  return {
    basePath: basePath || '/',
    routes,
    sites,
    experiments,
    fetch,
  };
}

export const gutenbergApp: GutenbergAppHandle = createGutenbergApp();

export default gutenbergApp;
