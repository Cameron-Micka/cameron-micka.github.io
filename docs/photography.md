# Photography assets

How to add photos to the `/photography` gallery.

The `/photography` gallery reads `src/content/photos.ts`, a zod-validated
manifest. Image files are committed to this repo and served straight from
GitHub Pages out of `public/`:

```
public/photos/<category>/<id>.webp          full size, ~2000px long edge
public/photos/<category>/thumbs/<id>.webp   grid thumbnail, ~600px long edge
```

`<category>` is `nature` or `automotive`; `<id>` is a url-safe slug
(`a-z`, `0-9`, `-`) and doubles as the manifest `id`.

**Export recipe** — commit web derivatives only, never RAWs or camera-original
JPEGs; git keeps every version of a binary forever.

1. Resize so the long edge is 2000px (full) and 600px (thumb). Keep the
   aspect ratio; the grid crops to 3:2 for layout only.
2. Encode as WebP at quality ~80 (full) and ~75 (thumb). Add a JPEG next to it
   only if you need a fallback for a specific target.
3. Strip metadata, including EXIF GPS.
4. Add a faint `Cameron Micka` watermark at the bottom left.

Place source images directly in `public/photos/nature/` or
`public/photos/automotive/`, then preview and run the batch converter:

```bash
npm run photos:build -- --dry-run
npm run photos:build
```

The converter preserves the source files, auto-orients and converts them to
sRGB, strips metadata, creates both derivatives, and turns camera filenames
into URL-safe ids (`IMG_298_No_Wires.jpeg` becomes
`img-298-no-wires.webp`). It also refreshes
`src/content/photos.generated.ts` with the paths and full-size intrinsic
dimensions used by the gallery. Source JPEG, PNG, TIFF, and HEIF files in
those folders are ignored by git. To use different watermark text, pass
`--name "Your Name"`; to rebuild only the manifest, pass `--manifest-only`.

`--manifest-only` reads the committed WebP derivatives rather than the ignored
originals, so it works in a fresh checkout. It verifies that each full-size
file has a matching thumbnail and that both are readable WebPs within their
size limits, then rewrites the manifest. Both modes order the manifest by the
generated `photos/<category>/<id>.webp` path, so a full conversion and a
manifest-only refresh always produce the same file. `npm test` covers this.

New generated entries receive a category-based fallback description. Add an
image-specific description to `photoDetails` in `src/content/photos.ts` before
publishing new photos; captions and locations are optional. These authored
details survive future batch conversions.

Keep the site comfortably under GitHub Pages' ~1 GB soft limit. If the gallery
ever outgrows that, the files can move to an external object store/CDN, but the
manifest paths are not currently portable: `assetUrl()` in
`src/content/schema.ts` joins them onto `BASE_URL`, so it would need to pass
absolute URLs through untouched, and `scripts/build-photos.mjs` would need to
emit them. Do not use Git LFS: Pages does not resolve LFS pointers, so the
images would 404.
