import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createModuleTestServer } from './lib/vite-test-server.mjs';

let server;
let companies;
let initialPlanetIndex;

before(async () => {
  server = await createModuleTestServer();
  ({ companies } = await server.ssrLoadModule('/src/content/companies.ts'));
  ({ initialPlanetIndex } = await server.ssrLoadModule(
    '/src/engine/Engine.ts',
  ));
});

after(async () => {
  await server?.close();
});

test('timeline opens focused on Microsoft', () => {
  assert.equal(companies[initialPlanetIndex(companies)].slug, 'microsoft');
});

test('initial planet is the ongoing role closest to Now', () => {
  assert.equal(
    initialPlanetIndex([
      { end: '2004' },
      { end: null },
      { end: null },
      { end: '2010' },
    ]),
    2,
  );
  assert.equal(initialPlanetIndex([{ end: '2004' }, { end: '2010' }]), 0);
  assert.equal(initialPlanetIndex([]), 0);
});
