# Temporal Drift Testing

## Quick commands

```bash
npm run build
npm run test:unit
npm run verify
```

## Unit tests (fast, cross-platform)

Runs `node:test` against our TypeScript unit tests (via `tsx`).

```bash
npm run test:unit
```

## Visual regression (macOS only)

Visual captures rely on:
- Obsidian desktop app
- `open` + `peekaboo`

The fixture vault lives at:
- `tests/fixtures/vault/`

### Capture current

```bash
npm run build
npm run visual:capture
```

Screenshots are written to:
- `tests/visual/current/*.png`

### Compare vs baseline

```bash
npm run visual:compare
```

If there are diffs, they’re written to:
- `tests/visual/diffs/*.png`

### Update baseline (when diffs are intended)

```bash
npm run visual:baseline
```

Baselines are tracked in git:
- `tests/visual/baselines/*.png`

## Smoke test (macOS only)

Runs a small integration assertion + a window capture.

```bash
npm run build
scripts/e2e/smoke.sh
```
