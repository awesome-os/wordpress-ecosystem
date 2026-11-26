/**
 * @file wp-block-compiler.test.mts
 * @description Unit tests for Gutenberg block parser, Markdown/Block/B8G-HTML compiler, and staging preview writer.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
  compilePageToHtml,
  parseGutenbergCommentBlocks,
  writeStagingPreview,
} from './wp-block-compiler.mts';

describe('wp-block-compiler', () => {
  it('parses Gutenberg comment blocks, nested blocks, self-closing blocks, and JSON WpBlock arrays', () => {
    const rawComments = [
      '<!-- wp:heading {"level":2} -->',
      '<h2>Sovereign Runtime</h2>',
      '<!-- /wp:heading -->',
      '<!-- wp:paragraph -->',
      '<p>Zero bloat, direct execution.</p>',
      '<!-- /wp:paragraph -->',
      '<!-- wp:code -->',
      'const x = 42;',
      '<!-- /wp:code -->',
      '<!-- wp:quote -->',
      '<!-- wp:paragraph -->',
      '<p>Nested quote paragraph.</p>',
      '<!-- /wp:paragraph -->',
      '<!-- /wp:quote -->',
      '<!-- wp:separator /-->',
      '<!-- wp:list {"ordered":true} -->',
      '<li>First</li><li>Second</li>',
      '<!-- /wp:list -->',
    ].join('\n');

    const blocks = parseGutenbergCommentBlocks(rawComments);
    assert.equal(blocks.length, 6);
    assert.equal(blocks[0].name, 'heading');
    assert.equal(blocks[0].attributes?.level, 2);
    assert.equal(blocks[1].name, 'paragraph');
    assert.equal(blocks[2].name, 'code');
    assert.equal(blocks[3].name, 'quote');
    assert.equal(blocks[3].innerBlocks?.length, 1);
    assert.equal(blocks[3].innerBlocks?.[0].name, 'paragraph');
    assert.equal(blocks[4].name, 'separator');
    assert.equal(blocks[5].name, 'list');
    assert.equal(blocks[5].attributes?.ordered, true);

    const fromJson = parseGutenbergCommentBlocks(
      JSON.stringify([{ name: 'core/paragraph', innerHTML: 'Hello JSON' }]),
    );
    assert.equal(fromJson.length, 1);
    assert.equal(fromJson[0].name, 'core/paragraph');
    assert.equal(fromJson[0].innerHTML, 'Hello JSON');

    assert.deepEqual(parseGutenbergCommentBlocks('   '), []);
  });

  it('compiles Gutenberg, Markdown, and B8G-HTML into dark-glass HTML5 with b8g-section', () => {
    const mdHtml = compilePageToHtml({
      title: 'Markdown Post',
      slug: 'md-post',
      format: 'markdown',
      domain: 'awesome-os.com',
      body: '# Hello\n\nA **bold** line with `code`.\n\n- Item A\n- Item B\n\n> Quoted',
    });
    assert.match(mdHtml, /^<!DOCTYPE html>/);
    assert.ok(
      mdHtml.includes(
        '<b8g-section data-kind="cms-page" data-surface="html-dom" data-liveness="static">',
      ),
    );
    assert.ok(mdHtml.includes('<h1>Hello</h1>'));
    assert.ok(mdHtml.includes('<strong>bold</strong>'));
    assert.ok(mdHtml.includes('<code>code</code>'));
    assert.ok(mdHtml.includes('<li>Item A</li>'));
    assert.ok(mdHtml.includes('<blockquote><p>Quoted</p></blockquote>'));

    const wpHtml = compilePageToHtml({
      title: 'Gutenberg Post',
      slug: 'wp-post',
      format: 'gutenberg-blocks',
      domain: 'b8g.app',
      body: '<!-- wp:heading {"level":3} -->Heading 3<!-- /wp:heading --><!-- wp:core/custom {"accent":"sky"} -->Custom<!-- /wp:core/custom -->',
    });
    assert.ok(
      wpHtml.includes(
        '<b8g-section data-kind="cms-page" data-surface="html-dom" data-liveness="static">',
      ),
    );
    assert.ok(wpHtml.includes('<h3>Heading 3</h3>'));
    assert.ok(wpHtml.includes('data-wp-block="core/custom"'));

    const b8gHtml = compilePageToHtml({
      title: 'Raw B8G',
      slug: 'raw-b8g',
      format: 'b8g-html',
      body: '<div class="custom-widget">Live</div>',
    });
    assert.ok(b8gHtml.includes('<div class="custom-widget">Live</div>'));
  });

  it('writes staging preview file atomically and prevents path traversal', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'b8g-wp-block-stage-'));
    try {
      const result = writeStagingPreview(
        { id: 'site_b8g_app', domain: 'b8g.app' },
        {
          slug: '../releases/v1',
          title: 'Release v1',
          format: 'markdown',
          body: '# Release v1\n\nStaged preview.',
        },
        dir,
      );
      assert.equal(result.relPath, 'b8g.app/releases/v1.html');
      assert.ok(result.filePath.startsWith(path.resolve(dir)));
      const written = readFileSync(result.filePath, 'utf8');
      assert.ok(written.includes('<title>Release v1 — b8g.app</title>'));
      assert.ok(
        written.includes(
          '<b8g-section data-kind="cms-page" data-surface="html-dom" data-liveness="static">',
        ),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
