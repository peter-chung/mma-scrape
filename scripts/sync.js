// Run the sync from the command line.
//   node scripts/sync.js              nightly window (last 30 days + upcoming)
//   node scripts/sync.js --backfill   all history (run once, locally — too long for Vercel)
//   node scripts/sync.js --since 2025-01-01
//   node scripts/sync.js --segments-only   just re-match ESPN segment times
//   node scripts/sync.js --segments-backfill [--since 2015-01-01] [--dry-run]
//       one-time: ESPN card sections for past events that have none
//       (--dry-run matches and reports without writing)
const fs = require("fs");
const path = require("path");
const envPath = path.join(__dirname, "..", ".env.local");
require("dotenv").config(fs.existsSync(envPath) ? { path: envPath } : undefined);

const runSync = require("../utils/runSync");
const { syncEspnSegments, backfillEspnSegments } = require("../utils/matchSegments");
const { closePool } = require("../utils/db");

function parseSince(argv) {
  const sinceIndex = argv.indexOf("--since");
  if (sinceIndex === -1) {
    return undefined;
  }
  const since = argv[sinceIndex + 1];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since || "")) {
    throw new Error("--since expects YYYY-MM-DD");
  }
  return since;
}

function parseArgs(argv) {
  if (argv.includes("--segments-only")) {
    return { mode: "segments" };
  }
  if (argv.includes("--segments-backfill")) {
    const since = parseSince(argv);
    const dryRun = argv.includes("--dry-run");
    return since
      ? { mode: "segments-backfill", since, dryRun }
      : { mode: "segments-backfill", dryRun };
  }
  if (argv.includes("--backfill")) {
    return { mode: "sync", since: null };
  }
  const since = parseSince(argv);
  return since ? { mode: "sync", since } : { mode: "sync" };
}

async function main() {
  const { mode, ...options } = parseArgs(process.argv.slice(2));
  const summary =
    mode === "segments"
      ? await syncEspnSegments()
      : mode === "segments-backfill"
        ? await backfillEspnSegments(options)
        : await runSync(options);
  console.log(JSON.stringify(summary, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(closePool);
