import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const css = readFileSync(
  new URL('../src/ui/styles.css', import.meta.url),
  'utf8',
);
const colors = new Map(
  [...css.matchAll(/^\s*(--[\w-]+):\s*(#[\da-f]{6}(?:[\da-f]{2})?);/gim)].map(
    (match) => [match[1], match[2]],
  ),
);

function color(token) {
  const value = colors.get(token);
  assert.ok(value, `Missing theme color: ${token}`);
  return value;
}

function rgb(hex) {
  return hex
    .slice(1, 7)
    .match(/../g)
    .map((channel) => parseInt(channel, 16));
}

function composite(foreground, background) {
  const alpha =
    foreground.length === 9 ? parseInt(foreground.slice(7), 16) / 255 : 1;
  const backdrop = rgb(background);
  return (
    '#' +
    rgb(foreground)
      .map((channel, index) =>
        Math.floor(channel * alpha + backdrop[index] * (1 - alpha))
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}

function luminance(hex) {
  const channels = rgb(hex)
    .map((channel) => channel / 255)
    .map((channel) =>
      channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
    );
  return channels.reduce(
    (sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index],
    0,
  );
}

function contrastColors(foreground, background) {
  const values = [foreground, background].map(luminance).sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

function contrast(foreground, background) {
  return contrastColors(color(foreground), color(background));
}

const surfaces = [
  '--bg',
  '--panel',
  '--panel-light',
  '--screen',
  '--glass',
  '--key-top',
  '--key-bottom',
];

test('primary and secondary text meet AA contrast on every soft surface', () => {
  for (const foreground of ['--fg', '--muted']) {
    for (const background of surfaces) {
      const ratio = contrast(foreground, background);
      assert.ok(
        ratio >= 4.5,
        `${foreground} on ${background}: ${ratio.toFixed(2)}:1, expected 4.5:1`,
      );
    }
  }
});

test('coral actions keep readable text at rest and on hover', () => {
  for (const background of ['--accent', '--accent-hover']) {
    const ratio = contrast('--on-accent', background);
    assert.ok(
      ratio >= 4.5,
      `${background} action contrast: ${ratio.toFixed(2)}`,
    );
  }
});

test('accent labels and focus rings remain visible in selected states', () => {
  for (const background of [...surfaces, '--accent-soft']) {
    const ratio = contrast('--accent-ink', background);
    assert.ok(
      ratio >= 4.5,
      `${background} accent contrast: ${ratio.toFixed(2)}`,
    );
  }
  assert.match(css, /--focus:\s*var\(--accent-ink\)/);
});

test('mica backplates stay translucent with AA text over dark and light scenes', () => {
  const tint = color('--backplate-tint');
  assert.match(tint, /^#[\da-f]{8}$/i);
  const alpha = parseInt(tint.slice(7), 16) / 255;
  assert.ok(
    alpha >= 0.8 && alpha <= 0.95,
    'Backplates should be lightly translucent',
  );

  for (const background of [
    '#000000',
    '#ffffff',
    '#141b2b',
    '#185561',
    '#68283a',
  ]) {
    const surface = composite(tint, background);
    for (const foreground of [
      '--fg',
      '--backplate-muted',
      '--backplate-accent',
    ]) {
      const ratio = contrastColors(color(foreground), surface);
      assert.ok(
        ratio >= 4.5,
        `${foreground} on mica over ${background}: ${ratio.toFixed(2)}:1`,
      );
    }
  }
});

test('mica buttons preserve AA contrast in standalone and nested interaction states', () => {
  const insetTint = color('--control-inset-tint');
  const insetAlpha = parseInt(insetTint.slice(7), 16) / 255;
  assert.ok(
    insetAlpha >= 0.1 && insetAlpha <= 0.3,
    'Nested buttons should reveal the mica plate rather than form opaque caps',
  );
  assert.match(css, /--control-tint:\s*var\(--backplate-tint\)/);
  for (const backdrop of ['#000000', '#ffffff', '#141b2b', '#185561']) {
    const plate = composite(color('--backplate-tint'), backdrop);
    const surfaces = [plate, composite(insetTint, plate)];
    for (const surface of surfaces) {
      for (const state of [
        '#ffffff00',
        color('--control-highlight'),
        color('--control-selected'),
      ]) {
        for (const foreground of [
          '--fg',
          '--backplate-muted',
          '--backplate-accent',
        ]) {
          const ratio = contrastColors(
            color(foreground),
            composite(state, surface),
          );
          assert.ok(
            ratio >= 4.5,
            `${foreground} with ${state} over ${backdrop}: ${ratio.toFixed(2)}:1`,
          );
        }
      }
    }
  }
});

test('the pearlescent sheen only lightens the minimum-contrast backplate', () => {
  const tint = color('--backplate-tint');
  const alpha = parseInt(tint.slice(7), 16) / 255;
  const minimum = rgb(tint).map((channel) => channel * alpha);
  const sheen = css.match(/--backplate-sheen:([\s\S]*?);/)?.[1];
  assert.ok(sheen, 'Missing pearlescent backplate sheen');
  const stops = [...sheen.matchAll(/#[\da-f]{8}/gi)];
  assert.ok(stops.length > 0);
  for (const [stop] of stops) {
    assert.ok(
      rgb(stop).every((channel, index) => channel >= minimum[index]),
      `${stop} would darken the tested contrast bound`,
    );
  }
});

test('boot surface and browser theme match the light page surface', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const layout = readFileSync(
    new URL('../src/routes/RootLayout.tsx', import.meta.url),
    'utf8',
  );
  const boot = html.match(/#boot-skeleton\s*\{([^}]+)\}/)?.[1];
  assert.ok(boot, 'The boot skeleton must define its initial surface');
  assert.match(boot, new RegExp(`background:\\s*${color('--bg')};`));
  assert.equal(
    layout.match(/<meta\s+name="theme-color"\s+content="([^"]+)"/)?.[1],
    color('--bg'),
  );
  assert.match(css, /color-scheme:\s*light/);
});

test('button surfaces use fully rounded ends without rounding whole panels', () => {
  const radius = Number(css.match(/--radius-button:\s*(\d+)px;/)?.[1]);
  assert.ok(radius >= 999, 'Button ends must remain round on multiline labels');
  for (const selector of [
    '.action-link',
    '.navlink',
    '.icon-btn',
    '.story-links a',
    '.social-list a',
    '.photo-jump a',
    '.screenshot-btn',
    '.project-jump select',
    '.settings select',
  ]) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rule = css.match(new RegExp(`^${escaped} \\{([^}]+)\\}`, 'm'))?.[1];
    assert.ok(rule, `Missing button style: ${selector}`);
    assert.match(
      rule,
      /border-radius:\s*var\(--radius-button\)/,
      `${selector} must use the shared pill radius`,
    );
  }
  assert.match(css, /--radius-control:\s*14px;/);
  assert.match(css, /--radius-window:\s*32px;/);
});

test('the chapter readout keeps its rounded-rectangle shape', () => {
  const rule = css.match(/^\.ribbon-readout \{([^}]+)\}/m)?.[1];
  assert.ok(rule, 'Missing chapter readout style');
  assert.match(rule, /border-radius:\s*var\(--radius-screen\);/);
  assert.match(rule, /padding:\s*12px 16px;/);
});

test('gallery frames stay thin with matching inner image corners', () => {
  const frame = css.match(/^\.photo-tile,\s*\.profile-photo \{([^}]+)\}/m)?.[1];
  const image = css.match(
    /^\.photo-tile img,\s*\.profile-photo img \{([^}]+)\}/m,
  )?.[1];
  assert.ok(frame, 'Missing photo frame style');
  assert.ok(image, 'Missing photo image style');
  assert.match(frame, /padding:\s*2px;/);
  assert.match(frame, /border:\s*1px solid/);
  assert.match(frame, /border-radius:\s*var\(--radius-screen\);/);
  assert.match(image, /border-radius:\s*calc\(var\(--radius-screen\) - 3px\);/);
  assert.doesNotMatch(frame, /var\(--shadow-raised\)/);
});

test('expanded photos have no drop shadow', () => {
  const image = css.match(/^\.lightbox-figure img \{([^}]+)\}/m)?.[1];
  assert.ok(image, 'Missing expanded photo style');
  assert.doesNotMatch(image, /(?:box-shadow|filter):/);
});

test('toggle tracks and thumbs include borders in their declared size', () => {
  for (const pseudo of ['before', 'after']) {
    const rule = css.match(
      new RegExp(
        `^\\.settings input\\[type='checkbox'\\]::${pseudo} \\{([^}]+)\\}`,
        'm',
      ),
    )?.[1];
    assert.ok(rule, `Missing toggle ::${pseudo} style`);
    assert.match(rule, /box-sizing:\s*border-box;/);
  }
});
