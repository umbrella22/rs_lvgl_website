# Visual documentation diagrams

Four topics have Chinese and English candidates: data ownership, switch message
flow, the native build path and application capabilities. `catalog.json` connects
candidates, local generation paths, public HTML and the guide that embeds each
figure. `ArchifyDiagram` shows an animated overview and opens a reader in a dialog.
All readers use Classic and start live, follow the supplied document theme, and
omit the native top and bottom toolbars. Reduced motion remains respected.
Full-size links work independently of the documentation shell.

The checked HTML is an intentional static asset. Building the site requires no
Archify installation, external diagram service or browser compiler. Preserve the
renderer/font license notices embedded in these files.

## Source and artifact identity

`source-evidence.json` records inspected current-source ranges, excerpts and file
hashes. `claims` maps each diagram node to its evidence. This is working-tree
content provenance. It does not claim that the current API exists at a particular
Git commit. Archify's commit-bound repository links are deliberately omitted:
its repository gate cannot certify uncommitted inputs. The site checker validates
the explicit source evidence separately from Archify's layout/artifact checks.

`artifacts.json` records the original and published HTML identities. `archifyHtmlSha256` binds the pristine
reader to a successful Archify finalize receipt, including its browser gate.
`htmlSha256` binds the published HTML after the deterministic documentation adapter
adds content-hashed references to `reader.css` and `reader.js`. Removing that exact
addition must reproduce `normalizedArchifyHtmlSha256`. The synchronization step
removes whitespace-only lines inside style blocks before adding the reader;
the original finalized hash remains recorded separately. SVG content and native
runtime source remain intact.
Archify's receipt covers the pristine reader. Site checks and browser review cover
the adapted reader separately.

`diagrams:check` verifies sources, excerpts, semantic-node coverage, language parity,
candidates, HTML identities and the current adapter assets. It also verifies
side-midpoint attachments and perpendicular approaches in class/dataflow SVGs.
Tree diagrams retain their native curved branching and are reviewed visually.
`prebuild` fails on drift instead of regenerating diagrams silently.

## Regeneration

1. Inspect the changed implementation and update the diagram claims, both
   translations and the exact source evidence. Keep the same node identities
   across translations. Review relationship directions and failure conditions.
2. Set `ARCHIFY_CLI` to your installed Archify 3.1 `bin/archify.mjs`. Run `finalize`
   for each changed candidate, using its `diagram_type` and `meta.output`. If a
   previous run reached browser-check, give the next run a new `--out-dir` named
   `review-N` inside that output's folder. Set `ARCHIFY_CHROME` to an available
   Chrome/Chromium executable if automatic discovery fails.
3. Run `npm run diagrams:sync`, then `diagrams:check`. Synchronizing
   requires matching successful receipts for all candidates and validates source
   evidence and connection geometry before adapting and copying. It does not
   rewrite the source-evidence manifest. Reader-only CSS/JS changes need a new
   sync and integrated browser review; they do not change pristine Archify bytes.
4. Build the site and inspect the affected figures, their full readers, both
   themes and narrow layouts. Generated browser checks do not replace this visual
   review of the integrated documentation.

For example, from the repository root:

```sh
node "$ARCHIFY_CLI" finalize class \
  diagrams/zh/data-model.json \
  .archify/class-data-model-zh-20261026-163429/data-model.html \
  --quality showcase \
  --out-dir .archify/class-data-model-zh-20261026-163429/review-3 \
  --json
npm run diagrams:sync
npm run diagrams:check
npm run build
npm run check-docs -- --built
```

Generation receipts remain under ignored `.archify/`. Failed or skipped gates do
not authorize a new public diagram. Runtime motion illustrates authored
relationships; it is not a measured execution trace. The capability tree shows
responsibilities, not a complete Cargo dependency graph. Class members and
method signatures are selected and abbreviated for explanation.
