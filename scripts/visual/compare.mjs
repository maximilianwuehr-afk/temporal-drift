import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

const ROOT = process.cwd();
const BASE = path.join(ROOT, 'tests/visual/baselines');
const CURR = path.join(ROOT, 'tests/visual/current');

function listPngs(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.png')).sort();
}

function readPng(p) {
  return PNG.sync.read(fs.readFileSync(p));
}

const baseFiles = listPngs(BASE);
const currFiles = listPngs(CURR);

if (baseFiles.length === 0) {
  console.error(`[visual:compare] No baselines found in ${BASE}. Run visual:baseline first.`);
  process.exit(1);
}

const missing = baseFiles.filter((f) => !currFiles.includes(f));
if (missing.length) {
  console.error('[visual:compare] Missing current screenshots for:', missing.join(', '));
  console.error('Run: npm run visual:capture');
  process.exit(1);
}

let totalDiff = 0;
for (const f of baseFiles) {
  const a = readPng(path.join(BASE, f));
  const b = readPng(path.join(CURR, f));

  if (a.width !== b.width || a.height !== b.height) {
    console.error(`[visual:compare] Size mismatch for ${f}: baseline ${a.width}x${a.height} vs current ${b.width}x${b.height}`);
    process.exit(1);
  }

  const diff = new PNG({ width: a.width, height: a.height });
  const diffPixels = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.1 });
  totalDiff += diffPixels;

  if (diffPixels > 0) {
    const outDir = path.join(ROOT, 'tests/visual/diffs');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, f), PNG.sync.write(diff));
    console.error(`[visual:compare] ${f}: ${diffPixels} pixels differ (diff written to tests/visual/diffs/${f})`);
  }
}

if (totalDiff > 0) {
  process.exit(1);
}

console.log('[visual:compare] OK');
