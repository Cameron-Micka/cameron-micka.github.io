import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
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

test('Microsoft has separate Graphics Tools stories for Unity and Unreal', async () => {
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
      '/media/graphics-tools/unity-showcase.webp',
      '/media/graphics-tools/clipping-primitives.webp',
      '/media/graphics-tools/unity-ui-tooling.webp',
    ],
  );

  const uiTooling = unity.media.find(
    (media) => media.src === '/media/graphics-tools/unity-ui-tooling.webp',
  );
  assert.equal(uiTooling.type, 'image');
  assert.ok(uiTooling.alt?.trim());
  await access(new URL(`../public${uiTooling.src}`, import.meta.url));

  assert.equal(unreal.title, 'Graphics Tools for Unreal');
  assert.match(unreal.body, /MixedReality-GraphicsTools-Unreal/);
  assert.deepEqual(
    unreal.media.map((media) => media.src),
    [
      'https://youtu.be/GfeG_ZFzL1g',
      '/media/graphics-tools/unreal-lighting.webp',
      '/media/graphics-tools/unreal-effects.webp',
      '/media/graphics-tools/unreal-profiling.webp',
    ],
  );
  assert.equal(
    microsoft.pois.some((poi) => poi.slug === 'graphics-tools'),
    false,
  );
});

test('Mesh overview uses plain product text and links to its supporting stories', () => {
  const microsoft = companies.find((company) => company.slug === 'microsoft');
  const mesh = microsoft.pois.find((poi) => poi.slug === 'mesh');
  const targets = [...mesh.body.matchAll(/\]\(#\/([^/]+)\/([a-z0-9-]+)\)/g)].map(
    ([, company, poi]) => ({ company, poi }),
  );

  assert.match(mesh.body, /AltspaceVR, Microsoft Mesh, and immersive events in Teams/);
  assert.doesNotMatch(mesh.body, /\[Microsoft Mesh\]\(/);
  assert.deepEqual(targets, [
    { company: 'microsoft', poi: 'mesh-toolkit' },
    { company: 'microsoft', poi: 'visual-profiler' },
  ]);
  for (const target of targets) {
    assert.ok(
      companies
        .find((company) => company.slug === target.company)
        ?.pois.some((poi) => poi.slug === target.poi),
      `Missing story: ${target.company}/${target.poi}`,
    );
  }
});

test('Mesh overview covers the browser transition and custom environment imports', () => {
  const microsoft = companies.find((company) => company.slug === 'microsoft');
  const mesh = microsoft.pois.find((poi) => poi.slug === 'mesh');

  assert.match(mesh.body, /\bnative app\b/);
  assert.match(mesh.body, /\bWebGL-based\b/);
  assert.match(mesh.body, /\bglTF files\b/);
  assert.match(mesh.body, /\bmultidisciplinary, multinational teams\b/);
});

test('Mesh overview preserves its videos and includes both team photos', async () => {
  const microsoft = companies.find((company) => company.slug === 'microsoft');
  const mesh = microsoft.pois.find((poi) => poi.slug === 'mesh');

  assert.deepEqual(
    mesh.media.map(({ type, src }) => ({ type, src })),
    [
      { type: 'video', src: 'https://youtu.be/_0InCXA13L8?is=vflFpiEVH0-lb9qE' },
      { type: 'video', src: 'https://youtu.be/esBzumV_59Q?is=q3QIkV73tt1w8-zA' },
      { type: 'image', src: '/media/microsoft/mesh-womens-day-team.webp' },
      { type: 'image', src: '/media/microsoft/mesh-demo-team.webp' },
    ],
  );
  for (const media of mesh.media) {
    assert.ok(media.alt?.trim(), `Missing media description: ${media.src}`);
    if (media.type === 'image') {
      await access(new URL(`../public${media.src}`, import.meta.url));
    }
  }
});

test('DigiPen internship is dated 2009-2010', () => {
  const digipen = companies.find((company) => company.slug === 'digipen');
  const internship = digipen.pois.find(
    (poi) => poi.slug === 'corporate-partnerships-intern',
  );

  assert.equal(internship.dates, '2009 \u2013 2010');
});

test('Screen Actors Guild is the oldest planet with its four POIs', () => {
  assert.equal(companies[0].slug, 'screen-actors-guild');
  const sag = companies[0];
  assert.equal(sag.name, 'Screen Actors Guild');
  assert.equal(sag.start, '1988');
  assert.equal(sag.end, '2004');
  assert.deepEqual(
    sag.pois.map((poi) => poi.title),
    [
      'The Sixth Sense',
      'Beloved',
      'Broadway Brawler',
      'TV Commercials & Print Work',
    ],
  );

  const sixthSense = sag.pois.find((poi) => poi.slug === 'the-sixth-sense');
  const broadwayBrawler = sag.pois.find(
    (poi) => poi.slug === 'broadway-brawler',
  );
  const commercialsAndPrint = sag.pois.find(
    (poi) => poi.slug === 'tv-commercials',
  );

  assert.equal(commercialsAndPrint.dates, '1988 \u2013 2000');
  assert.deepEqual(
    sixthSense.media.map((media) => media.src),
    ['/media/screen-actors-guild/the-sixth-sense-set.webp'],
  );
  assert.deepEqual(
    broadwayBrawler.media.map((media) => media.src),
    ['/media/screen-actors-guild/broadway-brawler-set.webp'],
  );
  assert.deepEqual(
    commercialsAndPrint.media.map((media) => media.src),
    [
      '/media/screen-actors-guild/child-actor-headshots.webp',
      '/media/screen-actors-guild/fisher-price-nursery-monitor.webp',
      '/media/screen-actors-guild/sesame-street-parents.webp',
      '/media/screen-actors-guild/neshaminy-mall-columbus-day.webp',
    ],
  );
});

test('career highlights flag exactly the headline stories', () => {
  const highlighted = companies
    .flatMap((company) => company.pois)
    .filter((poi) => poi.highlight)
    .map((poi) => poi.slug)
    .sort();
  assert.deepEqual(highlighted, [
    'fat-princess-adventures',
    'force-unleashed-ii',
    'graphics-tools-unity',
    'hairball',
    'hololens-2-isvs',
    'mesh',
    'student-games',
  ]);
});
