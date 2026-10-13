import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createModuleTestServer } from './lib/vite-test-server.mjs';

let server;
let Markdown;

before(async () => {
  server = await createModuleTestServer();
  ({ Markdown } = await server.ssrLoadModule('/src/ui/Markdown.tsx'));
});

after(async () => {
  await server?.close();
});

function render(text) {
  return renderToStaticMarkup(createElement(Markdown, { text }));
}

test('POI links stay on the current page', () => {
  assert.equal(
    render(
      'Explore [Graphics Tools](#/microsoft/graphics-tools-unity) and ' +
        '[Performance Tooling](#/microsoft/visual-profiler).',
    ),
    '<p>Explore <a href="#/microsoft/graphics-tools-unity">Graphics Tools</a> ' +
      'and <a href="#/microsoft/visual-profiler">Performance Tooling</a>.</p>',
  );
});

test('external links and inline formatting keep their existing behavior', () => {
  assert.equal(
    render(
      '**Impact.** Build *together*.\n\n' +
        '[HTTPS](https://example.com) and [HTTP](http://example.com).',
    ),
    '<p><strong>Impact.</strong> Build <em>together</em>.</p>' +
      '<p><a href="https://example.com" target="_blank" rel="noreferrer">HTTPS</a> ' +
      'and <a href="http://example.com" target="_blank" rel="noreferrer">HTTP</a>.</p>',
  );
});

test('unsupported URLs and malformed story links remain plain text', () => {
  for (const url of [
    'javascript:alert',
    'data:text/html,content',
    '//example.com',
    '/microsoft/mesh',
    '#/microsoft',
    '#/microsoft/mesh/extra',
    '#/microsoft/mesh?redirect=example.com',
  ]) {
    const text = `[Link](${url})`;
    assert.equal(render(text), `<p>${text}</p>`);
  }
});

test('raw HTML and link labels are escaped', () => {
  assert.equal(
    render('<script>alert(1)</script> [<b>Tools</b>](#/microsoft/mesh-toolkit)'),
    '<p>&lt;script&gt;alert(1)&lt;/script&gt; ' +
      '<a href="#/microsoft/mesh-toolkit">&lt;b&gt;Tools&lt;/b&gt;</a></p>',
  );
});
