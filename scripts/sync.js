// Run the sync from the command line.
//   node scripts/sync.js              nightly window (last 30 days + upcoming)
//   node scripts/sync.js --backfill   all history (run once, locally — too long for Vercel)
//   node scripts/sync.js --since 2025-01-01
//   node scripts/sync.js --segments-only   just re-match ESPN segment times
const fs = require("fs");
const path = require("path");
const envPath = path.join(__dirname, "..", ".env.local");
require("dotenv").config(fs.existsSync(envPath) ? { path: envPath } : undefined);

const runSync = require("../utils/runSync");
const { syncEspnSegments } = require("../utils/matchSegments");
const { closePool } = require("../utils/db");

function parseArgs(argv) {
  if (argv.includes("--segments-only")) {
    return { segmentsOnly: true };
  }
  if (argv.includes("--backfill")) {
    return { since: null };
  }
  const sinceIndex = argv.indexOf("--since");
  if (sinceIndex !== -1) {
    const since = argv[sinceIndex + 1];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(since || "")) {
      throw new Error("--since expects YYYY-MM-DD");
    }
    return { since };
  }
  return {};
}

async function main() {
  const { segmentsOnly, ...options } = parseArgs(process.argv.slice(2));
  const summary = segmentsOnly ? await syncEspnSegments() : await runSync(options);
  console.log(JSON.stringify(summary, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(closePool);
