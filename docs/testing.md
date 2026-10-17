# Testing

Automated checks run in CI; GPU shaders and interaction also need manual browser checks.

## Continuous integration

[deploy.yml](../.github/workflows/deploy.yml) runs typecheck, lint, tests, and
the production build on every pull request and on pushes to `main`. Only
`main` (and a manual dispatch) deploys to GitHub Pages: pull-request runs never
receive the `pages`/`id-token` scopes and cannot publish. Deployment jobs are
serialized separately from pull-request builds.

`scripts/ui-theme.test.mjs` checks text and focus contrast against the shared
surface tokens, composited mica button states, and matching boot/browser theme
colors, the shared pill-shaped button radius with its chapter-readout exception,
and border-inclusive toggle sizing. It does not replace the responsive and
visual browser checks below.

## Browser checks

`scripts/regeneration-sound.test.mjs` also checks that scrolling between stories
and companies is silent while direct story actions and timeline cues remain.

In addition to typecheck, lint, and the production build, exercise:

- Desktop, 320px/390px portrait, and short landscape layouts; no horizontal
  overflow, obscured actions, or inaccessible settings controls. Include
  768x501, 768x600, and the 720px/721px height boundary to check floating-control
  clearance from the header.
- Brand-mark strokes remain inset within their circular container on both sides
  of the 980px compact-header breakpoint, including 320px-wide screens.
- Light surfaces on every route, inset and raised control states, keyboard
  focus, and forced-colors mode. Settings switches retain a 44px hit height;
  their thumbs stay centered vertically with equal end clearance when on or off.
  Labels and primary actions meet WCAG AA text contrast.
- Mica buttons keep their sheen on hover and selection, remain legible over
  dark and bright scenes, and become opaque with reduced transparency.
  Nested controls reuse panel blur rather than adding a filter per button.
- Text buttons have semicircular ends and square icon controls remain circular.
  The chapter readout is the exception and keeps its rounded-rectangle shape.
  Check multiline readouts at 320px and 390px widths for text clearance,
  without rounding panels or media previews.
- Continuous window resizing with motion running, paused, and a story open;
  no black frames during resizing, including when crossing layout breakpoints.
- Wheel, keyboard, ribbon, and ruler navigation in both directions; form
  controls and dialog scrolling must not also move the timeline.
- Interaction-hint dismissal through wheel, mouse/pen, touch, keyboard,
  chapter buttons, and story opening; it stays hidden after closing a dialog
  or returning from another route, and reappears on a fresh page load.
- Direct story links, project switching, expansion, Esc, Tab wrapping, and
  return focus in both viewers.
- Story scrollbars remain in the outer right mica gutter in normal and
  expanded layouts, including narrow screens; wheel, keyboard, and native thumb
  scrolling still update the story picker and deep link.
- Live system-motion changes, paused interaction, quality switches, and both
  rendering backends. A settled paused scene should submit **zero GPU draws**.
- Auto quality can reach Medium/High on both fine- and coarse-pointer devices
  when frame times permit; manual tiers stay selected, and switching back to
  Auto restarts adaptive quality at Medium.
- Navigation away while shaders initialize; renderer failure and JavaScript
  disabled; prerendered metadata and printing.

A local 1440×900 WebGL2 check counted 7,950 indexed draw calls over two seconds
with motion paused before on-demand rendering, and zero after. This measures
eliminated idle submissions, not an improvement to the cost of an animated frame.
