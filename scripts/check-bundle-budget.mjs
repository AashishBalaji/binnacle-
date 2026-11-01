#!/usr/bin/env node
/**
 * check-bundle-budget.mjs -- a real, enforced performance budget for
 * the production build, not an aspirational comment in a README.
 *
 * Sums the gzip size of every built JS file and every built CSS file
 * under dist/assets, and fails (non-zero exit) if either exceeds its
 * budget. Budgets are set well above today's actual size (see the
 * numbers logged below) so routine feature growth doesn't trip CI,
 * but tight enough to catch an accidental heavy dependency (e.g. a
 * whole date-formatting library pulled in for one call) before it
 * ships. Run via `npm run build` first -- this script only reads the
 * already-built dist/ directory, it doesn't build anything itself.
 */

import { gzipSync } from "node:zlib";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join } from "node:path";

const DIST_ASSETS_DIR = join(process.cwd(), "dist", "assets");

// Gzip KB. Today's actual build is ~77 KB JS / ~1 KB CSS (see the
// README's scope section for why: no heavy UI framework beyond React
// itself, no icon font, no bundled date library). These budgets give
// roughly 2.5x headroom for stage 2/3 growth while still catching a
// genuine regression.
const BUDGETS_KB = {
  js: 200,
  css: 20,
};

function gzipKb(filePath) {
  const bytes = readFileSync(filePath);
  return gzipSync(bytes).length / 1024;
}

function sumByExtension(dir) {
  const totals = { js: 0, css: 0 };
  let entries;
  try {
    entries = readdirSync(dir);
  } catch (error) {
    console.error(`Could not read ${dir} -- did you run "npm run build" first?`);
    console.error(String(error));
    process.exit(1);
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    if (!statSync(fullPath).isFile()) continue;
    const ext = extname(entry).slice(1);
    if (ext === "js" || ext === "css") {
      totals[ext] += gzipKb(fullPath);
    }
  }
  return totals;
}

const totals = sumByExtension(DIST_ASSETS_DIR);
let failed = false;

for (const [kind, budgetKb] of Object.entries(BUDGETS_KB)) {
  const actualKb = totals[kind];
  const status = actualKb <= budgetKb ? "OK" : "OVER BUDGET";
  console.log(`${kind.toUpperCase()}: ${actualKb.toFixed(1)} KB gzip (budget ${budgetKb} KB) -- ${status}`);
  if (actualKb > budgetKb) failed = true;
}

if (failed) {
  console.error("\nBundle size budget exceeded. Investigate what grew before raising the budget.");
  process.exit(1);
}
