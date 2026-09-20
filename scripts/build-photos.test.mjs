// Regression checks for the photo pipeline. Run with `npm test`.
//
// The gallery manifest is a tracked, generated file, so the behaviour that
// matters is: a fresh checkout (derivatives only, originals gitignored) must
// rebuild it byte-for-byte, and malformed input must fail loudly.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';

import {
  collectManifest,
  findDerivatives,
  findSources,
  generatedManifestSource,
} from './build-photos.mjs';

const run = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const cli = path.join(here, 'build-photos.mjs');
const quiet = { log: () => {} };

async function makeRoot(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'photos-'));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
    assert.equal(existsSync(root), false, 'fixture directory is removed');
  });
  for (const category of ['nature', 'automotive']) {
    await mkdir(path.join(root, category, 'thumbs'), { recursive: true });
  }
  return root;
}

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

// Content hash + size + mtime for every file, so a rewrite is detectable even
// if a tool happens to reproduce byte-identical output.
async function snapshotTree(dir) {
  const snapshot = new Map();
  for (const file of (await walk(dir)).sort()) {
    const [bytes, info] = await Promise.all([readFile(file), stat(file)]);
    snapshot.set(path.relative(dir, file), {
      sha256: createHash('sha256').update(bytes).digest('hex'),
      size: info.size,
      mtimeMs: info.mtimeMs,
    });
  }
  return snapshot;
}

async function writeSource(root, category, name, width = 300, height = 200) {
  const file = path.join(root, category, name);
  await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 90, g: 120, b: 160 },
    },
  })
    .jpeg()
    .toFile(file);
  return file;
}

test('converts sources into both derivatives', async (t) => {
  const root = await makeRoot(t);

  await writeSource(root, 'nature', 'IMG_0042_Ridge.jpeg');
  const sources = await findSources(root);
  assert.equal(sources.length, 1);
  assert.equal(sources[0].id, 'img-0042-ridge', 'camera names are slugified');

  const { manifest } = await collectManifest(root, sources, {
    watermark: 'Test Name',
    ...quiet,
  });
  assert.deepEqual(manifest, [
    {
      id: 'img-0042-ridge',
      category: 'nature',
      src: 'photos/nature/img-0042-ridge.webp',
      thumb: 'photos/nature/thumbs/img-0042-ridge.webp',
      width: 300,
      height: 200,
    },
  ]);

  for (const relative of [manifest[0].src, manifest[0].thumb]) {
    const written = path.join(root, relative.replace('photos/', ''));
    const meta = await sharp(written).metadata();
    assert.equal(meta.format, 'webp', `${relative} is a WebP`);
  }
});

test('--manifest-only rebuilds from derivatives with no originals present', async (t) => {
  const root = await makeRoot(t);

  const original = await writeSource(root, 'nature', 'DSC_1.jpg');
  const converted = await collectManifest(root, await findSources(root), {
    watermark: 'Test Name',
    ...quiet,
  });

  // Simulate a fresh checkout: the gitignored original is gone.
  await rm(original);
  assert.equal((await findSources(root)).length, 0);

  const derivatives = await findDerivatives(root);
  assert.equal(derivatives.length, 1);
  const rebuilt = await collectManifest(root, derivatives, {
    manifestOnly: true,
    ...quiet,
  });
  assert.deepEqual(
    rebuilt.manifest,
    converted.manifest,
    'manifest-only matches a full conversion',
  );

  const { stdout } = await run(process.execPath, [
    cli,
    '--manifest-only',
    '--root',
    root,
  ]);
  assert.match(stdout, /Indexed 1 photos/);
});

test('reproduces the committed manifest from the committed derivatives', async () => {
  const root = path.join(repoRoot, 'public', 'photos');
  const derivatives = await findDerivatives(root);
  assert.ok(
    derivatives.length > 0,
    'committed photos are discoverable from derivatives alone',
  );

  const { manifest } = await collectManifest(root, derivatives, {
    manifestOnly: true,
    ...quiet,
  });
  assert.equal(manifest.length, derivatives.length);
  const committed = await readFile(
    path.join(repoRoot, 'src', 'content', 'photos.generated.ts'),
    'utf8',
  );
  assert.equal(
    generatedManifestSource(manifest),
    committed,
    'regenerating the manifest must not produce a diff',
  );
});

test('manifest-only rewrites no bytes under public/photos', async () => {
  const root = path.join(repoRoot, 'public', 'photos');
  const before = await snapshotTree(root);

  // Originals are gitignored, so a fresh checkout has none. Whatever is
  // present locally must survive completely untouched.
  const originalsBefore = [...before.keys()].filter((f) =>
    /\.(jpe?g|png|tiff?|hei[cf])$/i.test(f),
  );

  await collectManifest(root, await findDerivatives(root), {
    manifestOnly: true,
    ...quiet,
  });

  const after = await snapshotTree(root);
  assert.deepEqual(
    [...after.keys()].sort(),
    [...before.keys()].sort(),
    'no file added or removed',
  );
  for (const [file, meta] of before) {
    assert.deepEqual(
      after.get(file),
      meta,
      `${file} must keep identical bytes, size and mtime`,
    );
  }

  const originalsAfter = [...after.keys()].filter((f) =>
    /\.(jpe?g|png|tiff?|hei[cf])$/i.test(f),
  );
  assert.deepEqual(
    originalsAfter,
    originalsBefore,
    'ignored source originals are never edited or deleted',
  );
});

test('reports a missing thumbnail clearly', async (t) => {
  const root = await makeRoot(t);

  await writeSource(root, 'nature', 'DSC_2.jpg');
  await collectManifest(root, await findSources(root), {
    watermark: 'Test Name',
    ...quiet,
  });
  await rm(path.join(root, 'nature', 'thumbs', 'dsc-2.webp'));

  await assert.rejects(
    collectManifest(root, await findDerivatives(root), {
      manifestOnly: true,
      ...quiet,
    }),
    /Missing thumb derivative/,
  );
});

test('rejects duplicate ids across categories', async (t) => {
  const root = await makeRoot(t);

  // Different original filenames that slugify to the same id.
  await writeSource(root, 'nature', 'sunrise.jpg');
  await writeSource(root, 'automotive', 'Sunrise.JPG');
  await assert.rejects(findSources(root), /Duplicate generated id "sunrise"/);

  // Same collision, but between committed derivatives.
  await writeFile(path.join(root, 'nature', 'shared.webp'), '');
  await writeFile(path.join(root, 'automotive', 'shared.webp'), '');
  await assert.rejects(
    findDerivatives(root),
    /Duplicate generated id "shared"/,
  );
});

test('rejects a malformed derivative', async (t) => {
  const root = await makeRoot(t);

  await writeFile(path.join(root, 'nature', 'broken.webp'), 'not an image');
  await mkdir(path.join(root, 'nature', 'thumbs'), { recursive: true });
  await writeFile(path.join(root, 'nature', 'thumbs', 'broken.webp'), 'nope');

  await assert.rejects(
    collectManifest(root, await findDerivatives(root), {
      manifestOnly: true,
      ...quiet,
    }),
    /Could not read .*broken\.webp/,
  );
});

test('rejects a derivative that is not named with a url-safe id', async (t) => {
  const root = await makeRoot(t);

  await writeFile(path.join(root, 'nature', 'Not Safe.webp'), '');
  await assert.rejects(findDerivatives(root), /not named with a url-safe id/);
});

test('CLI exits non-zero when a derivative-only run finds nothing', async (t) => {
  const root = await makeRoot(t);

  const result = await run(process.execPath, [
    cli,
    '--manifest-only',
    '--root',
    root,
  ]).catch((error) => error);

  assert.equal(result.code, 1, 'exits non-zero');
  assert.match(result.stderr, /No WebP derivatives found/);
});

test('CLI --dry-run reports planned output without writing', async (t) => {
  const root = await makeRoot(t);

  await writeSource(root, 'automotive', 'IMG_7.jpeg');
  const { stdout } = await run(process.execPath, [
    cli,
    '--dry-run',
    '--root',
    root,
  ]);

  assert.match(stdout, /IMG_7\.jpeg -> /);
  assert.match(stdout, /Would convert 1 photos/);
  assert.equal(
    (await findDerivatives(root)).length,
    0,
    'dry run writes no derivatives',
  );
});
