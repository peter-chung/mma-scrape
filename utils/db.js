const { Pool, types } = require("pg");

// Return Postgres DATE columns as 'YYYY-MM-DD' strings instead of JS Dates at
// local midnight, which would shift the day depending on the server timezone.
const DATE_OID = 1082;
types.setTypeParser(DATE_OID, (value) => value);

// Stay well under Postgres' 65535 bind-parameter limit per statement.
const MAX_PARAMS_PER_STATEMENT = 30000;
const MAX_ROWS_PER_STATEMENT = 1000;

// FightCenter's tables live in their own schema inside a shared Supabase
// project. Queries schema-qualify every table instead of relying on
// search_path, which isn't dependable through a transaction-mode pooler.
const DB_SCHEMA = process.env.DB_SCHEMA || "fightcenter";

if (!/^[a-z_][a-z0-9_]*$/.test(DB_SCHEMA)) {
  throw new Error(`invalid DB_SCHEMA ${JSON.stringify(DB_SCHEMA)}`);
}

/** table("events") → "fightcenter.events" */
function table(name) {
  return `${DB_SCHEMA}.${name}`;
}

let pool;

function getRequiredEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }

  return value;
}

// Supabase's server certificate chains to Supabase's own root CA, which Node
// doesn't trust by default. Provide that CA (downloadable from the Supabase
// dashboard → Database settings) base64-encoded in SUPABASE_DB_CA_B64 to get
// full verification; without it the connection is still TLS-encrypted, just
// without certificate verification.
// `sslmode=disable` in the URL turns TLS off, for a local Postgres only.
function buildSslConfig(connectionString) {
  if (new URL(connectionString).searchParams.get("sslmode") === "disable") {
    return false;
  }

  const caB64 = process.env.SUPABASE_DB_CA_B64;

  if (caB64) {
    return { ca: Buffer.from(caB64, "base64").toString("utf8"), rejectUnauthorized: true };
  }

  return { rejectUnauthorized: false };
}

// An sslmode query param in the URL would override the ssl config above.
function stripSslMode(connectionString) {
  const url = new URL(connectionString);
  url.searchParams.delete("sslmode");
  return url.toString();
}

function getPool() {
  if (!pool) {
    const connectionString = getRequiredEnv("SUPABASE_DB_URL");
    pool = new Pool({
      connectionString: stripSslMode(connectionString),
      ssl: buildSslConfig(connectionString),
      max: 3,
    });
  }

  return pool;
}

async function withTransaction(callback) {
  const client = await getPool().connect();

  try {
    await client.query("begin");
    const result = await callback(client);
    await client.query("commit");
    return result;
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Batched multi-row INSERT. `rows` are objects keyed by column name.
 *
 * onConflict:
 *   - { update: true }  → ON CONFLICT (conflictColumns) DO UPDATE every
 *                          non-key column, and bump synced_at
 *   - { nothing: true } → ON CONFLICT (conflictColumns) DO NOTHING
 *   - omitted           → plain INSERT
 */
async function insertRows(client, tableName, columns, rows, { conflictColumns, onConflict } = {}) {
  if (!rows.length) {
    return 0;
  }

  const batchSize = Math.max(
    1,
    Math.min(MAX_ROWS_PER_STATEMENT, Math.floor(MAX_PARAMS_PER_STATEMENT / columns.length))
  );

  let conflictClause = "";

  if (onConflict?.update) {
    const updates = columns
      .filter((column) => !conflictColumns.includes(column))
      .map((column) => `${column} = excluded.${column}`)
      .concat("synced_at = now()");
    conflictClause = ` on conflict (${conflictColumns.join(", ")}) do update set ${updates.join(", ")}`;
  } else if (onConflict?.nothing) {
    conflictClause = ` on conflict (${conflictColumns.join(", ")}) do nothing`;
  }

  let affected = 0;

  for (let start = 0; start < rows.length; start += batchSize) {
    const batch = rows.slice(start, start + batchSize);
    const values = [];
    const tuples = batch.map((row) => {
      const placeholders = columns.map((column) => {
        values.push(row[column] ?? null);
        return `$${values.length}`;
      });
      return `(${placeholders.join(", ")})`;
    });

    const result = await client.query(
      `insert into ${table(tableName)} (${columns.join(", ")}) values ${tuples.join(", ")}${conflictClause}`,
      values
    );
    affected += result.rowCount;
  }

  return affected;
}

async function closePool() {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}

module.exports = { getPool, withTransaction, insertRows, closePool, getRequiredEnv, table };
