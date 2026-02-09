# Visual baselines

These screenshots are used as the visual regression baseline.

Workflow (macOS only):
1) `npm run build`
2) `npm run visual:capture` (writes to `tests/visual/current/`)
3) `npm run visual:compare`
4) If the change is intended: `npm run visual:baseline` to update baselines
