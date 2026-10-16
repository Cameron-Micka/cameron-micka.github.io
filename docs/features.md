# Features & controls

How visitors navigate and interact with the site, plus accessibility and SEO behavior.

## Finding the work

On roomy viewports, the landing introduction explains the experience and
provides an explicit **Explore the work** action. Narrow screens (720px and
below) and short landscape windows hide that introduction so the canvas and
controls have room; the lower readout remains the primary chapter and story
entry point.

The POI dialog is a scrollable, snap-aligned feed of every story across the
career timeline. Its native project picker opens any story without requiring a
precise click on a 3D marker. The picker's visible "Jump to a story" label is
hidden at narrow widths, while its accessible name remains available.

The timeline reads newest to oldest: scroll down or press **Down** to move
toward older work; scroll up or press **Up** to return toward the present.
**Home / Page Up** go to the current role, and **End / Page Down** go to the
earliest chapter.
These shortcuts do not intercept links, form controls, editable content, or
dialogs. On touch screens, use the ribbon arrows or a two-finger drag to travel.

Drag a planet to rotate it; faster swipes carry more momentum and coast farther
after release. Grab again or hold still before releasing to stop the spin.
Reduced motion keeps direct rotation available without the coast.

The scroll/drag/tap hint disappears after the first scene interaction, chapter
button activation, or story opening. It stays dismissed across client-side
navigation until the page is reloaded.

The About page provides a conventional, newest-first career summary and direct
links to every story. Writing is currently a coming-soon page, and Photography
provides separate Nature and Automotive galleries with a native lightbox.
Sound effects are on by default (toggle them in Settings) and never start before a user gesture.

## Screenshots

On desktop browsers with a fine pointer, the unlisted **Ctrl+Alt+Shift+S**
shortcut turns the current page into a live 1920×1080 stage, scaled to fit the
window. Nothing reloads: the camera, selected chapter, open dialogs and scroll
position are kept, and viewport units and media queries resolve as on a 1080p
display. Press the shortcut again (or **Capture**) to save a lossless PNG: the
3D scene is re-rendered at the high quality preset with 2× supersampling and
downsampled in linear light, and the interface is rasterized at exactly one
pixel per CSS pixel, so the image stays sharp regardless of the window's size
or pixel density. **Save to Desktop** opens a save dialog that starts in the
Desktop folder (Chrome and Edge), or downloads the file where the File System
Access API is unavailable. The stage stays open for further shots; Esc or
**Exit** returns to the normal layout. Keep the window at least 981×501 so
the window-height media queries match 1080p.

## Free camera

Use the camera button to enter free camera. On desktop, WASD flies, Shift
boosts, and Space slows movement. Click and drag a planet or the sun to move
it across the view; drag empty space (or right-drag anywhere) to look around.
Entering free camera preserves the current viewing direction and position,
including portrait layouts and zoomed views.
Planet moons, satellites, and the flight path follow the moved planet.
Leaving free camera restores the original scene layout for timeline navigation.
On touch screens, drag a planet or the sun to move it. Drag empty space on
the left half to fly or the right half to look; these two camera gestures can
run simultaneously.

Planet drags mark the flight path dirty; its geometry is rebuilt at most once
per rendered frame, and only when the flight-path setting is enabled.

Body-selection outlines reuse 128 cached circle samples and scalar projection,
avoiding 512 temporary vectors and 256 trigonometric calls per computed outline
without changing its shape or six-pixel clearance.

## Moon launching

Moons have rocky surfaces with optional blue-white polar ice caps and no liquid
water. Each moon has a stable, individual terrain seed; ice covers crater relief
in both rendering backends.
A seeded subset also has thin, palette-tinted scattering atmospheres and no
meteor craters in either backend. These shells fade with orbiting moons and stay
attached during flight.

Click or tap a moon to knock it out of orbit, away from the camera along the
tap's direction. Flying moons bounce off planets and other moons, and are
destroyed on contact with the sun. Tap one again to redirect it.
This works in both timeline and free-camera modes. Detached moons no longer
follow their parent planet or its visibility; reload the page to restore them.
Paused motion and open POI dialogs also pause moon flight.

## Accessibility & SEO

- The landing page prerenders a readable, semantic résumé from the same
  company data. It remains usable without JavaScript or a working GPU. A GPU
  startup failure shows this content with a reload action and collapsible
  diagnostics, rather than blocking the entire portfolio.
- During the interactive experience, the duplicate résumé is print-only:
  it cannot create invisible keyboard stops or duplicate screen-reader content.
  Printing hides the canvas and controls and exposes the complete résumé.
- Every route has a main landmark and a visible-on-focus skip link. Route
  changes reset scroll/focus unless navigating to a section anchor.
- Settings controls have 44px hit targets. Narrow layouts hide the side ruler
  and landing introduction. Short landscape layouts also move Pause and Free
  Camera to the upper left; touch layouts retain the larger ribbon controls.
- `prefers-reduced-motion` and Paused motion freeze idle scene animation, skip
  the fly-in, and disable dialog entrance effects. Direct interaction remains
  available. Important company labels no longer animate or glitch.
- Story and photo viewers use native modal dialogs for background inertness,
  focus containment, and focus restoration. Esc / backdrop / Close dismiss
  story modals, while the photo viewer closes on Esc or a click anywhere
  outside the image; the story selector remains accessibly named when its visible narrow-
  screen label is hidden, and the lightbox adds ← / → paging and native touch
  swiping.
- All current photos have image-specific descriptions. The lightbox displays
  the caption, or the description when no separate caption is authored. Gallery
  tiles are real image links, so opening the original in a new tab or viewing it
  without JavaScript still works.
- POIs are deep-linkable via `#/{company}/{poi}`. Hash updates preserve router
  history state; malformed links cannot crash or freeze the experience.
  POI descriptions can link to related stories with `[label](#/company/poi)`;
  these links stay on the current page, while HTTP(S) links open in a new tab.
- Every prerendered route has its own title, description, canonical URL, and
  absolute social-image URL. `public/robots.txt` and `public/sitemap.xml` cover
  the public routes. The generated `404.html` is a real not-found page, not a
  redirect loop.
  If the domain changes, update `SITE.url`, the robots file, and the sitemap.
- `public/og.jpg` is the 1514×768 social card shared by every route.
