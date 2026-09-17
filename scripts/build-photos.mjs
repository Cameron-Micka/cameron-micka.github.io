import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';

const DEFAULT_ROOT = 'public/photos';
const DEFAULT_MANIFEST = 'src/content/photos.generated.ts';
const DEFAULT_WATERMARK = 'Cameron Micka';
const CATEGORIES = ['nature', 'automotive'];
const SOURCE_EXTENSIONS = new Set([
  '.heic',
  '.heif',
  '.jpeg',
  '.jpg',
  '.png',
  '.tif',
  '.tiff',
]);
const DERIVATIVES = [
  { name: 'full', maxEdge: 2000, quality: 80 },
  { name: 'thumb', maxEdge: 600, quality: 75 },
];

function usage() {
  console.log(`Usage: npm run photos:build -- [options]

Options:
  --name <text>  Watermark text (default: "${DEFAULT_WATERMARK}")
  --root <path>  Source/output root (default: ${DEFAULT_ROOT})
  --dry-run      Show planned output without writing files
  --manifest-only
                 Refresh the manifest from existing WebPs without converting
  --help         Show this help

Source images belong directly in <root>/nature and <root>/automotive.
Full WebP files are written beside them; thumbnails go in thumbs/.
Runs against the default root also refresh ${DEFAULT_MANIFEST}.`);
}

function parseArgs(args) {
  const options = {
    dryRun: false,
    manifestOnly: false,
    root: DEFAULT_ROOT,
    watermark: DEFAULT_WATERMARK,
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (argument === '--dry-run') {
      options.dryRun = true;
    } else if (argument === '--manifest-only') {
      options.manifestOnly = true;
    } else if (argument === '--help') {
      options.help = true;
    } else if (argument === '--name' || argument === '--root') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`${argument} requires a value.`);
      }
      if (argument === '--name') options.watermark = value.trim();
      else options.root = value;
      index += 1;
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }

  if (!options.watermark) {
    throw new Error('Watermark text cannot be empty.');
  }
  if (options.dryRun && options.manifestOnly) {
    throw new Error('--dry-run and --manifest-only cannot be used together.');
  }

  return options;
}

function slugify(filename) {
  return path
    .parse(filename)
    .name.normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function escapeXml(value) {
  return value.replace(/[&<>'"]/g, (character) => {
    const entities = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&apos;',
      '"': '&quot;',
    };
    return entities[character];
  });
}

function watermarkSvg(width, height, text) {
  const longEdge = Math.max(width, height);
  const fontSize = Math.max(12, Math.round(longEdge * 0.016));
  const margin = Math.max(10, Math.round(longEdge * 0.015));

  return Buffer.from(`
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <text
        x="${margin}"
        y="${height - margin}"
        fill="#ffffff"
        fill-opacity="0.34"
        stroke="#000000"
        stroke-opacity="0.24"
        stroke-width="${Math.max(1, fontSize * 0.06)}"
        paint-order="stroke fill"
        font-family="Helvetica Neue, Arial, sans-serif"
        font-size="${fontSize}"
        font-weight="500"
      >${escapeXml(text)}</text>
    </svg>
  `);
}

async function findSources(root) {
  const sources = [];

  for (const category of CATEGORIES) {
    const categoryDirectory = path.join(root, category);
    const entries = await readdir(categoryDirectory, { withFileTypes: true });

    for (const entry of entries) {
      const extension = path.extname(entry.name).toLowerCase();
      if (!entry.isFile() || !SOURCE_EXTENSIONS.has(extension)) continue;

      const id = slugify(entry.name);
      if (!id) throw new Error(`Could not create an id for ${entry.name}.`);

      sources.push({
        category,
        id,
        input: path.join(categoryDirectory, entry.name),
        sourceName: entry.name,
      });
    }
  }

  sources.sort((left, right) => left.input.localeCompare(right.input));

  const ids = new Map();
  for (const source of sources) {
    const previous = ids.get(source.id);
    if (previous) {
      throw new Error(
        `Duplicate generated id "${source.id}": ${previous} and ${source.input}`,
      );
    }
    ids.set(source.id, source.input);
  }

  return sources;
}

function outputPath(root, source, derivative) {
  const directory =
    derivative.name === 'thumb'
      ? path.join(root, source.category, 'thumbs')
      : path.join(root, source.category);
  return path.join(directory, `${source.id}.webp`);
}

async function renderDerivative(input, output, derivative, watermark) {
  const { data, info } = await sharp(input, { failOn: 'warning' })
    .rotate()
    .resize({
      width: derivative.maxEdge,
      height: derivative.maxEdge,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true });

  return sharp(data, {
    raw: {
      width: info.width,
      height: info.height,
      channels: info.channels,
    },
  })
    .composite([
      {
        input: watermarkSvg(info.width, info.height, watermark),
      },
    ])
    .webp({
      effort: 6,
      preset: 'photo',
      quality: derivative.quality,
      smartSubsample: true,
    })
    .toFile(output);
}

async function inspectDerivative(output, derivative) {
  const [metadata, file] = await Promise.all([
    sharp(output).metadata(),
    stat(output),
  ]);
  const width = metadata.width;
  const height = metadata.height;

  if (metadata.format !== 'webp' || !width || !height) {
    throw new Error(`Invalid WebP derivative: ${output}`);
  }
  if (Math.max(width, height) > derivative.maxEdge) {
    throw new Error(
      `${output} exceeds its ${derivative.maxEdge}px size limit.`,
    );
  }

  return { width, height, size: file.size };
}

function generatedManifestSource(photos) {
  const entries = photos
    .map(
      (photo) => `  {
    id: '${photo.id}',
    category: '${photo.category}',
    src: '${photo.src}',
    thumb: '${photo.thumb}',
    width: ${photo.width},
    height: ${photo.height},
  },`,
    )
    .join('\n');

  return `// Generated by npm run photos:build. Do not edit by hand.
export const generatedPhotos = [
${entries}
] as const;
`;
}

async function writeGeneratedManifest(photos) {
  const output = path.resolve(DEFAULT_MANIFEST);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, generatedManifestSource(photos));
  return output;
}

function formatBytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    usage();
    return;
  }

  const root = path.resolve(options.root);
  const writesDefaultManifest = root === path.resolve(DEFAULT_ROOT);
  const sources = await findSources(root);
  if (sources.length === 0) {
    throw new Error(`No source images found in ${root}.`);
  }

  if (options.dryRun) {
    for (const source of sources) {
      const full = path.relative(
        process.cwd(),
        outputPath(root, source, DERIVATIVES[0]),
      );
      const thumb = path.relative(
        process.cwd(),
        outputPath(root, source, DERIVATIVES[1]),
      );
      console.log(`${source.sourceName} -> ${full}, ${thumb}`);
    }
    console.log(
      `Would convert ${sources.length} photos with watermark "${options.watermark}".`,
    );
    if (writesDefaultManifest)
      console.log(`Would refresh ${DEFAULT_MANIFEST}.`);
    return;
  }

  const manifest = [];
  let sourceBytes = 0;
  let outputBytes = 0;

  for (let index = 0; index < sources.length; index += 1) {
    const source = sources[index];
    const results = await Promise.all(
      DERIVATIVES.map(async (derivative) => {
        const output = outputPath(root, source, derivative);
        if (options.manifestOnly) return inspectDerivative(output, derivative);

        await mkdir(path.dirname(output), { recursive: true });
        return renderDerivative(
          source.input,
          output,
          derivative,
          options.watermark,
        );
      }),
    );

    if (!options.manifestOnly) sourceBytes += (await stat(source.input)).size;

    outputBytes += results.reduce((total, result) => total + result.size, 0);
    manifest.push({
      id: source.id,
      category: source.category,
      src: `photos/${source.category}/${source.id}.webp`,
      thumb: `photos/${source.category}/thumbs/${source.id}.webp`,
      width: results[0].width,
      height: results[0].height,
    });
    const dimensions = results
      .map((result) => `${result.width}x${result.height}`)
      .join(' + ');
    console.log(
      `[${index + 1}/${sources.length}] ${source.category}/${source.sourceName} -> ${source.id}.webp (${dimensions})`,
    );
  }

  if (writesDefaultManifest) {
    const output = await writeGeneratedManifest(manifest);
    console.log(`Updated ${path.relative(process.cwd(), output)}.`);
  }

  if (options.manifestOnly) {
    console.log(
      `Indexed ${sources.length} photos (${formatBytes(outputBytes)} of WebP derivatives).`,
    );
    return;
  }

  console.log(
    `Converted ${sources.length} photos: ${formatBytes(sourceBytes)} of sources -> ${formatBytes(outputBytes)} of WebP derivatives.`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
