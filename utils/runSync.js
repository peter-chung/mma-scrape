const { syncFromBigQuery } = require("./syncFromBigQuery");
const { syncEspnSegments } = require("./matchSegments");

/**
 * BigQuery (primary) first, then ESPN segment times layered on top.
 * A failed ESPN step doesn't undo the BigQuery sync: segments are a nice-to-have,
 * and unmatched fights already render as "Unassigned Fights".
 *
 * @param {{ since?: string|null }} options  see syncFromBigQuery; null = full backfill
 */
async function runSync(options = {}) {
  const startedAt = Date.now();
  const bigquery = await syncFromBigQuery(options);

  let segments;
  try {
    segments = await syncEspnSegments();
  } catch (err) {
    console.error("ESPN segment sync failed:", err.message);
    segments = { error: err.message };
  }

  return { bigquery, segments, durationMs: Date.now() - startedAt };
}

module.exports = runSync;
