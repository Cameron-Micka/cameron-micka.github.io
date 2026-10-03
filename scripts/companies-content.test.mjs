import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createModuleTestServer } from './lib/vite-test-server.mjs';

let server;
let companies;

before(async () => {
  server = await createModuleTestServer();
  ({ companies } = await server.ssrLoadModule('/src/content/companies.ts'));
});

after(async () => {
  await server?.close();
});

test('Microsoft has separate Graphics Tools stories for Unity and Unreal', () => {
  const microsoft = companies.find((company) => company.slug === 'microsoft');
  const unity = microsoft.pois.find(
    (poi) => poi.slug === 'graphics-tools-unity',
  );
  const unreal = microsoft.pois.find(
    (poi) => poi.slug === 'graphics-tools-unreal',
  );

  assert.equal(unity.title, 'Graphics Tools for Unity');
  assert.match(unity.body, /MixedReality-GraphicsTools-Unity/);
  assert.deepEqual(
    unity.media.map((media) => media.src),
    [
      'https://youtu.be/rXbkJRhaBqE',
      '/media/graphics-tools/lighting.webp',
      '/media/graphics-tools/spatial-perception.webp',
      '/media/graphics-tools/ui-tooling.webp',
      '/media/graphics-tools/clipping-primitives.webp',
    ],
  );

  assert.equal(unreal.title, 'Graphics Tools for Unreal');
  assert.match(unreal.body, /MixedReality-GraphicsTools-Unreal/);
  assert.deepEqual(
    unreal.media.map((media) => media.src),
    ['https://youtu.be/GfeG_ZFzL1g'],
  );
  assert.equal(
    microsoft.pois.some((poi) => poi.slug === 'graphics-tools'),
    false,
  );
});
