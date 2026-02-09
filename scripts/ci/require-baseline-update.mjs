import { execSync } from 'node:child_process';

function sh(cmd) {
  return execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'] }).toString('utf8').trim();
}

const baseRef = process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : 'origin/main';

let changed = [];
try {
  const out = sh(`git diff --name-only ${baseRef}...HEAD`);
  changed = out ? out.split('\n').filter(Boolean) : [];
} catch (e) {
  // If base ref doesn't exist (e.g., local run), just skip.
  process.exit(0);
}

const UI_PATTERNS = [
  /^styles\.css$/,
  /^src\/(editor|preview|views)\//,
];

const BASELINE_PATTERN = /^tests\/visual\/baselines\//;

const uiChanged = changed.some((f) => UI_PATTERNS.some((re) => re.test(f)));
if (!uiChanged) process.exit(0);

const baselineChanged = changed.some((f) => BASELINE_PATTERN.test(f));
if (baselineChanged) process.exit(0);

console.error('\n[CI] UI-affecting files changed without updating visual baselines.');
console.error('Run locally on macOS:');
console.error('  npm run build');
console.error('  npm run visual:capture');
console.error('  npm run visual:compare');
console.error('  npm run visual:baseline   # if intended\n');
process.exit(1);
