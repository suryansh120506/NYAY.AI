# Bundled fonts

Copied from `@fontsource-variable/inter@5.3.0` (latin subset) and
`@fontsource-variable/noto-sans-devanagari@5.3.0` (devanagari subset), both SIL Open Font License 1.1 (see the
LICENSE files). They are bundled so `next build` and `next dev` never need the network (docs/ASSUMPTIONS.md A5).
To update: bump the packages in `apps/web/package.json` and re-copy the `*-wght-normal.woff2` files.
