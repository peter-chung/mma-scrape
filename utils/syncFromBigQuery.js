const { BigQuery } = require("@google-cloud/bigquery");
const { JWT } = require("google-auth-library");
const { withTransaction, insertRows, table } = require("./db");

const BIGQUERY_PROJECT = process.env.BIGQUERY_PROJECT || "ufc-data-pipeline";
const BIGQUERY_DATASET = process.env.BIGQUERY_DATASET || "analytics";
const NIGHTLY_LOOKBACK_DAYS = 30;

// Per-fighter stat columns in fct_fights, prefixed fighter_1_ / fighter_2_.
// Unpivoted into one fight_stats row per fighter.
const FIGHT_STAT_COLUMNS = [
  "result",
  "knockdowns",
  "sig_str_landed",
  "sig_str_attempted",
  "sig_str_pct",
  "total_str_landed",
  "total_str_attempted",
  "td_landed",
  "td_attempted",
  "td_pct",
  "sub_attempts",
  "reversals",
  "control_time_seconds",
  "head_str_landed",
  "head_str_attempted",
  "body_str_landed",
  "body_str_attempted",
  "leg_str_landed",
  "leg_str_attempted",
  "distance_str_landed",
  "distance_str_attempted",
  "clinch_str_landed",
  "clinch_str_attempted",
  "ground_str_landed",
  "ground_str_attempted",
];

const FIGHTER_COLUMNS = [
  "fighter_id",
  "first_name",
  "last_name",
  "nickname",
  "link",
  "height_inches",
  "weight_lbs",
  "reach_inches",
  "stance",
  "date_of_birth",
  "career_sig_str_landed_per_min",
  "career_sig_str_acc_pct",
  "career_sig_str_absorbed_per_min",
  "career_sig_str_def_pct",
  "career_td_avg_per_15min",
  "career_td_acc_pct",
  "career_td_def_pct",
  "career_sub_avg_per_15min",
  "career_wins",
  "career_losses",
  "career_draws",
  "career_no_contests",
  "ufc_wins",
  "ufc_losses",
  "ufc_draws",
  "ufc_no_contests",
  "has_profile",
];

const EVENT_COLUMNS = [
  "event_id",
  "name",
  "event_date",
  "completed",
  "city",
  "state",
  "country",
  "link",
];

// card_segment / segment_start are deliberately absent: they belong to the
// ESPN segment-matching step and must survive a BigQuery re-sync.
const FIGHT_COLUMNS = [
  "fight_id",
  "event_id",
  "fight_order",
  "weight_class",
  "method",
  "method_category",
  "finish_round",
  "finish_time",
  "time_format",
  "referee",
  "details",
  "round_lengths_seconds",
  "fight_duration_seconds",
  "winner_fighter_id",
];

const FIGHT_STATS_COLUMNS = ["fight_id", "fighter_id", "corner", ...FIGHT_STAT_COLUMNS];

/**
 * Credentials: GCP_SA_KEY_B64 (base64 of the service account JSON key) when
 * set. Otherwise falls back to Application Default Credentials, which is handy
 * for local development (`gcloud auth application-default login`).
 */
function getBigQueryClient() {
  const keyB64 = process.env.GCP_SA_KEY_B64;

  if (!keyB64) {
    console.log("GCP_SA_KEY_B64 not set; using Application Default Credentials");
    return new BigQuery({ projectId: BIGQUERY_PROJECT });
  }

  const key = JSON.parse(Buffer.from(keyB64, "base64").toString("utf8"));

  // Build a service-account client explicitly rather than passing arbitrary
  // credential JSON (deprecated in google-auth-library; any credential type
  // would be accepted).
  if (key.type !== "service_account" || !key.client_email || !key.private_key) {
    throw new Error("GCP_SA_KEY_B64 must be a base64-encoded service account JSON key");
  }

  const authClient = new JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: ["https://www.googleapis.com/auth/bigquery"],
  });
  return new BigQuery({ projectId: BIGQUERY_PROJECT, authClient });
}

function bqTable(name) {
  return `\`${BIGQUERY_PROJECT}.${BIGQUERY_DATASET}.${name}\``;
}

// BigQuery returns DATE/TIMESTAMP columns as wrapper objects ({ value }).
function unwrap(value) {
  return value !== null && typeof value === "object" && "value" in value ? value.value : value;
}

function ufcstatsEventUrl(eventId) {
  return `http://ufcstats.com/event-details/${eventId}`;
}

function isoDateDaysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function queryFights(bigquery, since) {
  const [rows] = await bigquery.query({
    query: `select * from ${bqTable("fct_fights")} where @since is null or event_date >= @since`,
    // With types: DATE the client silently sends a plain string as NULL, so
    // wrap it in BigQuery.date(); null still needs the explicit type.
    params: { since: since === null ? null : BigQuery.date(since) },
    types: { since: "DATE" },
  });
  return rows;
}

async function queryFighters(bigquery, fighterIds) {
  const [rows] = fighterIds
    ? await bigquery.query({
        query: `select * from ${bqTable("dim_fighters")} where fighter_id in unnest(@ids)`,
        params: { ids: fighterIds },
        types: { ids: ["STRING"] },
      })
    : await bigquery.query({ query: `select * from ${bqTable("dim_fighters")}` });
  return rows;
}

function toFighterRow(row) {
  return {
    fighter_id: row.fighter_id,
    first_name: row.first_name,
    last_name: row.last_name,
    nickname: row.nickname,
    link: row.fighter_link,
    height_inches: row.height_inches,
    weight_lbs: row.weight_lbs,
    reach_inches: row.reach_inches,
    stance: row.stance,
    date_of_birth: unwrap(row.date_of_birth),
    career_sig_str_landed_per_min: row.career_sig_str_landed_per_min,
    career_sig_str_acc_pct: row.career_sig_str_acc_pct,
    career_sig_str_absorbed_per_min: row.career_sig_str_absorbed_per_min,
    career_sig_str_def_pct: row.career_sig_str_def_pct,
    career_td_avg_per_15min: row.career_td_avg_per_15min,
    career_td_acc_pct: row.career_td_acc_pct,
    career_td_def_pct: row.career_td_def_pct,
    career_sub_avg_per_15min: row.career_sub_avg_per_15min,
    career_wins: row.career_wins,
    career_losses: row.career_losses,
    career_draws: row.career_draws,
    career_no_contests: row.career_no_contests,
    ufc_wins: row.wins,
    ufc_losses: row.losses,
    ufc_draws: row.draws,
    ufc_no_contests: row.no_contests,
    has_profile: true,
  };
}

function toEventRow(row) {
  return {
    event_id: row.event_id,
    name: row.event_name,
    event_date: unwrap(row.event_date),
    completed: Boolean(row.event_completed),
    city: row.event_city,
    state: row.event_state,
    country: row.event_country,
    // event_link is new in fct_fights; fall back to the URL ufcstats uses.
    link: row.event_link || ufcstatsEventUrl(row.event_id),
  };
}

function toFightRow(row) {
  return {
    fight_id: row.fight_id,
    event_id: row.event_id,
    fight_order: row.fight_order,
    weight_class: row.weight_class,
    method: row.method,
    method_category: row.method_category,
    finish_round: row.finish_round,
    finish_time: row.finish_time,
    time_format: row.time_format,
    referee: row.referee,
    details: row.details,
    round_lengths_seconds: row.round_lengths_seconds ?? null,
    fight_duration_seconds: row.fight_duration_seconds,
    winner_fighter_id: row.winner_fighter_id,
  };
}

function toFightStatsRows(row) {
  return [1, 2].map((corner) => {
    const stats = { fight_id: row.fight_id, fighter_id: row[`fighter_${corner}_id`], corner };
    FIGHT_STAT_COLUMNS.forEach((column) => {
      stats[column] = row[`fighter_${corner}_${column}`];
    });
    return stats;
  });
}

/**
 * Pull fights + fighters from BigQuery and upsert them into Postgres.
 *
 * @param {object} options
 * @param {string|null} options.since  'YYYY-MM-DD' lower bound on event_date,
 *   or null for a full backfill. Defaults to 30 days ago (nightly window).
 */
async function syncFromBigQuery({ since = isoDateDaysAgo(NIGHTLY_LOOKBACK_DAYS) } = {}) {
  const bigquery = getBigQueryClient();
  const isBackfill = since === null;

  const fightRows = await queryFights(bigquery, since);

  if (!fightRows.length) {
    throw new Error(`BigQuery returned no fights since ${since ?? "the beginning"}`);
  }

  const referencedFighterIds = [
    ...new Set(
      fightRows
        .flatMap((row) => [row.fighter_1_id, row.fighter_2_id, row.winner_fighter_id])
        .filter(Boolean)
    ),
  ];
  const fighterRows = await queryFighters(bigquery, isBackfill ? null : referencedFighterIds);

  const fighters = fighterRows.map(toFighterRow);
  const knownFighterIds = new Set(fighters.map((fighter) => fighter.fighter_id));
  // Fighters a fight references but whose ufcstats profile isn't scraped yet.
  // Inserted as id-only stubs so foreign keys hold; never overwrite a real row.
  const stubFighters = referencedFighterIds
    .filter((id) => !knownFighterIds.has(id))
    .map((fighter_id) => ({ fighter_id, has_profile: false }));

  const events = [...new Map(fightRows.map((row) => [row.event_id, toEventRow(row)])).values()];
  const fights = fightRows.map(toFightRow);
  const fightStats = fightRows.flatMap(toFightStatsRows);

  const eventIds = events.map((event) => event.event_id);
  const fightIds = fights.map((fight) => fight.fight_id);

  const summary = await withTransaction(async (client) => {
    const upsert = { onConflict: { update: true } };

    await insertRows(client, "fighters", FIGHTER_COLUMNS, fighters, {
      conflictColumns: ["fighter_id"],
      ...upsert,
    });
    const stubsInserted = await insertRows(
      client,
      "fighters",
      ["fighter_id", "has_profile"],
      stubFighters,
      { conflictColumns: ["fighter_id"], onConflict: { nothing: true } }
    );
    await insertRows(client, "events", EVENT_COLUMNS, events, {
      conflictColumns: ["event_id"],
      ...upsert,
    });
    await insertRows(client, "fights", FIGHT_COLUMNS, fights, {
      conflictColumns: ["fight_id"],
      ...upsert,
    });

    // Fights dropped from a synced event's card (cancellations, rebooked
    // matchups) are removed; fight_stats cascades.
    const removed = await client.query(
      `delete from ${table("fights")} where event_id = any($1) and not (fight_id = any($2))`,
      [eventIds, fightIds]
    );

    // Replace participants/stats wholesale for synced fights, so a late
    // opponent swap can't leave a stale fighter row behind.
    await client.query(`delete from ${table("fight_stats")} where fight_id = any($1)`, [fightIds]);
    await insertRows(client, "fight_stats", FIGHT_STATS_COLUMNS, fightStats);

    return {
      since,
      events: events.length,
      fights: fights.length,
      fightStats: fightStats.length,
      fighters: fighters.length,
      stubFightersInserted: stubsInserted,
      fightsRemoved: removed.rowCount,
    };
  });

  return summary;
}

module.exports = { syncFromBigQuery, NIGHTLY_LOOKBACK_DAYS };
