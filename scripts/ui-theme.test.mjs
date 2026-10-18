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
    alpha >= 0.69 && alpha <= 0.71,
    'Backplate base tint should stay near 70% opacity',
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

test('surface grains average to their surface colors', () => {
  for (const [grain, surface] of [
    ['--bg-grain', '--bg'],
    ['--panel-light-grain', '--panel-light'],
  ]) {
    const value = css.match(new RegExp(`${grain}:\\s*url\\(([^;]+)\\);`))?.[1];
    assert.ok(value, `Missing ${grain}`);
    const matrix = value
      .match(/feColorMatrix values='([^']+)'/)?.[1]
      ?.split(/\s+/)
      .map(Number);
    assert.ok(matrix?.length === 20, `Missing ${grain} color matrix`);
    // fractalNoise averages 0.5, so each channel averages gain * 0.5 + offset.
    const mean = [0, 1, 2].map(
      (row) => (matrix[row * 5] * 0.5 + matrix[row * 5 + 4]) * 255,
    );
    rgb(color(surface)).forEach((channel, index) =>
      assert.ok(
        Math.abs(mean[index] - channel) <= 1,
        `${grain} channel ${index} averages ${mean[index].toFixed(1)}, not ${channel}`,
      ),
    );
    assert.equal(matrix[19], 1, `${grain} must be opaque`);
  }
  assert.match(
    css,
    /^html \{\s*background:\s*var\(--bg-grain\)[^;]*var\(--bg\);/m,
  );
  const poiSurfaces = [
    ...css.matchAll(
      /background:\s*var\(--panel-light-grain\)[^;]*,\s*(#[\da-f]{6});/g,
    ),
  ];
  assert.equal(poiSurfaces.length, 2, 'Both POI content surfaces need grain');
  for (const [, hex] of poiSurfaces) assert.equal(hex, color('--panel-light'));
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

test('timeline dots stay circular without a stretched native tap highlight', () => {
  const button = css.match(/^\.ruler button \{([^}]+)\}/m)?.[1];
  const tick = css.match(/^\.ruler button \.tick \{([^}]+)\}/m)?.[1];
  assert.ok(button, 'Missing timeline button style');
  assert.ok(tick, 'Missing timeline dot style');
  assert.match(button, /-webkit-tap-highlight-color:\s*transparent;/);
  assert.match(tick, /width:\s*14px;/);
  assert.match(tick, /height:\s*14px;/);
  assert.match(tick, /border-radius:\s*50%;/);
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

test('gallery tiles stay atomic across masonry columns', () => {
  const item = css.match(/^\.photo-grid > li \{([^}]+)\}/m)?.[1];
  assert.ok(item, 'Missing gallery item style');
  assert.match(item, /display:\s*inline-block;/);
  assert.match(item, /width:\s*100%;/);
  assert.match(item, /vertical-align:\s*top;/);
  assert.match(item, /break-inside:\s*avoid;/);
});

test('intro shadow reaches the top and left viewport edges', () => {
  const intro = css.match(/^\.scene-intro \{([^}]+)\}/m)?.[1];
  const shadow = css.match(/^\.scene-intro::before \{([^}]+)\}/m)?.[1];
  assert.ok(intro, 'Missing introduction style');
  assert.ok(shadow, 'Missing introduction shadow');
  assert.match(intro, /top:\s*var\(--intro-top\);/);
  assert.match(intro, /left:\s*var\(--intro-left\);/);
  assert.match(
    shadow,
    /inset:\s*calc\(0px - var\(--intro-top\)\) -32px -24px\s+calc\(0px - var\(--intro-left\)\);/,
  );
  assert.match(shadow, /pointer-events:\s*none;/);
});

test('navigation headers have no surrounding glow or shadow', () => {
  const header = css.match(/^\.topnav \{([^}]+)\}/m)?.[1];
  assert.ok(header, 'Missing navigation header style');
  assert.match(header, /box-shadow:\s*none;/);
  assert.doesNotMatch(css, /^\.topnav\.[\w-]+ \{[^}]*box-shadow:/m);
});

test('expanded photos have no drop shadow', () => {
  const image = css.match(/^\.lightbox-figure img \{([^}]+)\}/m)?.[1];
  assert.ok(image, 'Missing expanded photo style');
  assert.doesNotMatch(image, /(?:box-shadow|filter):/);
});

test('the story scrollbar has a gutter outside the inset reading surface', () => {
  const frame = css.match(
    /^\.modal\.poi-modal \.poi-content-frame \{([^}]+)\}/m,
  )?.[1];
  const surface = css.match(
    /^\.modal\.poi-modal \.poi-content-frame::before \{([^}]+)\}/m,
  )?.[1];
  const scroll = css.match(
    /^\.modal\.poi-modal \.modal-content \{([^}]+)\}/m,
  )?.[1];
  assert.ok(surface, 'Missing inset story surface');
  assert.ok(frame, 'Missing story frame');
  assert.doesNotMatch(frame, /border-radius:|clip-path:|mask:/);
  assert.match(surface, /border-radius:\s*var\(--poi-content-radius\);/);
  assert.doesNotMatch(surface, /(?:border|box-shadow):/);
  assert.ok(scroll, 'Missing story scroll container');
  assert.match(surface, /inset:\s*0 var\(--poi-scrollbar-gutter\) 0 0;/);
  assert.match(surface, /pointer-events:\s*none;/);
  assert.match(scroll, /scrollbar-gutter:\s*stable;/);
  assert.match(
    scroll,
    /padding:\s*0 calc\(var\(--modal-pad\) \+ var\(--poi-scrollbar-gutter\)\)/,
  );
  assert.doesNotMatch(scroll, /margin-right:/);
});

test('mobile story sheets reclaim the scrollbar gutter and keep usable spacing', () => {
  const mobile = css.slice(
    css.indexOf('@media (max-width: 720px) {'),
    css.indexOf('@media (max-width: 380px) {'),
  );
  assert.match(mobile, /--poi-scrollbar-gutter:\s*0px;/);
  assert.match(mobile, /--modal-pad:\s*16px;/);
  assert.match(mobile, /\.poi-content-frame::before \{\s*display:\s*none;/);
  assert.match(mobile, /padding-inline:\s*var\(--modal-pad\);/);
  assert.match(
    mobile,
    /padding-bottom:\s*max\(16px, env\(safe-area-inset-bottom\)\);/,
  );
  assert.match(mobile, /grid-template-columns:\s*minmax\(0, 1fr\) auto;/);
});

test('enabled toggles match the translucent logo coral with a contrasting thumb outline', () => {
  const on = color('--toggle-on');
  assert.equal(on.slice(0, 7), color('--accent'));
  assert.ok(Math.abs(parseInt(on.slice(7), 16) / 255 - 0.65) < 0.005);
  assert.match(
    css,
    /\.settings input\[type='checkbox'\]:checked::before \{\s*--control-overlay:\s*var\(--toggle-on\);/,
  );
  assert.match(
    css,
    /\.settings input\[type='checkbox'\]::after \{\s*--control-tint:\s*var\(--panel\);/,
  );
  assert.match(
    css,
    /\.settings input\[type='checkbox'\]:checked::after \{\s*border-color:\s*var\(--fg\);/,
  );
  for (const backdrop of ['#000000', '#ffffff']) {
    const plate = composite(color('--backplate-tint'), backdrop);
    for (const base of [plate, '#ffffff']) {
      const track = composite(on, base);
      const thumb = color('--panel');
      const outline = color('--fg');
      assert.ok(
        contrastColors(outline, track) >= 3 &&
          contrastColors(outline, thumb) >= 3,
        'Enabled thumb outline must stand out against the track and knob',
      );
    }
  }
});

test('Settings dropdown chevrons have a consistent inset and text clearance', () => {
  const select = css.match(/^\.settings select \{([^}]+)\}/m)?.[1];
  const caret = css.match(
    /^\.project-jump-caret,\s*\.settings-select-caret \{([^}]+)\}/m,
  )?.[1];
  assert.ok(select, 'Missing Settings select style');
  assert.ok(caret, 'Missing shared dropdown caret style');
  assert.match(select, /appearance:\s*none;/);
  assert.match(select, /padding:\s*8px 40px 8px 12px;/);
  assert.match(caret, /right:\s*12px;/);
  assert.match(caret, /pointer-events:\s*none;/);
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
