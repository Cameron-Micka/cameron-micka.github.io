# Testing

Automated checks run in CI; GPU shaders and interaction also need manual browser checks.

## Continuous integration

[deploy.yml](../.github/workflows/deploy.yml) runs typecheck, lint, tests, and
the production build on every pull request and on pushes to `main`. Only
`main` (and a manual dispatch) deploys to GitHub Pages: pull-request runs never
receive the `pages`/`id-token` scopes and cannot publish. Deployment jobs are
serialized separately from pull-request builds.

## Browser checks

In addition to typecheck, lint, and the production build, exercise:

- Desktop, 320px/390px portrait, and short landscape layouts; no horizontal
  overflow, obscured actions, or inaccessible settings controls.
- Continuous window resizing with motion running, paused, and a story open;
  no black frames during resizing, including when crossing layout breakpoints.
- Wheel, keyboard, ribbon, and ruler navigation in both directions; form
  controls and dialog scrolling must not also move the timeline.
- Interaction-hint dismissal through wheel, mouse/pen, touch, keyboard,
  chapter buttons, and story opening; it stays hidden after closing a dialog
  or returning from another route, and reappears on a fresh page load.
- Direct story links, project switching, expansion, Esc, Tab wrapping, and
  return focus in both viewers.
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
