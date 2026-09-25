# flag-icons (vendored)

Country-flag CSS + per-country SVG assets, vendored from the
[flag-icons](https://github.com/lipis/flag-icons) project (v7.5.0, MIT — see
`LICENSE`) instead of carried as an npm dependency. The layout mirrors the
package (`css/flag-icons.min.css` + `flags/4x3/*.svg` + `flags/1x1/*.svg`) so the
CSS `url(../flags/…)` references resolve unchanged; Vite emits each referenced
SVG as its own hashed, on-demand asset (no JS vendor chunk).

`CountryFlag` / `FlagBlock` consume it via the `.fi fi-<alpha2>` classes
(`.fis` selects the 1x1 square asset).

## Local modifications

- Every flag using the French tricolor blue `#000091` is recoloured to the
  US-flag canton blue `#192f5d`. That covers `fr` plus the French overseas
  territories that reuse the tricolor: `bl`, `cp`, `gf`, `gp`, `mf`, `pm`, `re`,
  `wf`, `yt` (whichever of the `4x3` / `1x1` variants carried `#000091`).

To refresh the artwork from upstream, re-copy the package files and re-apply the
modifications above.
