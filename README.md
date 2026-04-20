# HomeKeep

Household maintenance that is visible, evenly distributed, and nothing falls through the cracks — without anxiety or guilt.

**Status:** Phase 1 — Scaffold in progress. See `.planning/ROADMAP.md`.

## Quickstart

Coming in Plan 01-07. For now:

```bash
npm install
npm run dev  # starts Next.js on :3001 and PocketBase on :8090 (dev-pb.js auto-downloads PB)
```

## Version Pins

All runtime and dev dependencies are exact-pinned (no semver carets) for reproducibility.
The pins in `package.json` track the matrix documented in
`.planning/phases/01-scaffold-infrastructure/01-RESEARCH.md` §Standard Stack, with these
deltas applied during the 01-01 scaffold because the originally planned versions were
unavailable on npm or incompatible with the rest of the chain:

| Package | Planned | Actual | Reason |
|---------|---------|--------|--------|
| `@types/node` | `22.10.5` | `22.19.17` | `22.10.5` conflicts with `vite@7`'s `@types/node >=22.12.0` peer; `22.19.17` is the latest `22.x` patch |
| `@types/react-dom` | `19.2.5` | `19.2.3` | `19.2.5` not published on npm; `19.2.3` is the latest available `19.2.x` |
| `date-fns` | `4.3.6` | `4.1.0` | `4.3.6` not published; `4.1.0` is the latest `4.x` release |
| `eslint` | `10.2.1` | `9.39.4` | `eslint-plugin-react@7.37.x` (transitive of `eslint-config-next@16.2.4`) is incompatible with ESLint 10's rule-context API; downgrading to the latest 9.x (`9.39.4`) is the only working combo |

`@eslint/eslintrc@3.2.0` was also added as a devDependency per the 01-01 plan note.
`npm run lint` uses `eslint .` directly (Next 16 removed the `next lint` subcommand).

## License

MIT — see [LICENSE](./LICENSE).
