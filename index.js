const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const envPath = path.join(__dirname, ".env.local");

require("dotenv").config(
  fs.existsSync(envPath) ? { path: envPath } : undefined
);
const express = require("express");
const cors = require("cors");
const app = express();

const { getRequiredEnv } = require("./utils/db");
const runSync = require("./utils/runSync");
const getUpcomingEvents = require("./utils/upcomingEvents");

const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:5173",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:5173",
];

function sendServerError(res, err) {
  console.log(err.message);
  return res.status(500).json({ message: err.message });
}

function safeEqual(provided, expected) {
  if (!provided || !expected) {
    return false;
  }
  const a = Buffer.from(String(provided));
  const b = Buffer.from(String(expected));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function parseAllowedOrigins() {
  const configuredOrigins = process.env.CORS_ORIGIN
    ?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return configuredOrigins?.length ? configuredOrigins : DEFAULT_ALLOWED_ORIGINS;
}

function corsOriginValidator(origin, callback) {
  const allowedOrigins = parseAllowedOrigins();

  if (!origin || allowedOrigins.includes(origin)) {
    return callback(null, true);
  }

  return callback(new Error("CORS origin not allowed"));
}

function requireApiKey(req, res, next) {
  const apiKey = req.get("x-api-key") || req.body?.key;

  if (!safeEqual(apiKey, process.env.ADMIN_API_KEY)) {
    return res.status(401).json({ message: "invalid API key" });
  }

  return next();
}

async function handleSync(req, res) {
  try {
    console.log("sync started");
    const summary = await runSync();
    console.log("sync finished", JSON.stringify(summary));
    return res.status(200).json(summary);
  } catch (err) {
    return sendServerError(res, err);
  }
}

getRequiredEnv("SUPABASE_DB_URL");
process.env.ADMIN_API_KEY = process.env.ADMIN_API_KEY || getRequiredEnv("SCRAPER_KEY");

app.disable("x-powered-by");
app.use(cors({ origin: corsOriginValidator }));
app.use(express.json({ limit: "100kb" }));

// Nightly sync: BigQuery (last 30 days + upcoming) → Postgres, then ESPN
// segment times. Triggered daily by cron-job.org (POST with x-api-key), which
// also alerts on failure; can be run by hand the same way.
app.post("/sync", requireApiKey, handleSync);

// Upcoming events in the legacy snapshot shape fyte-center reads today.
app.get("/events", async (req, res) => {
  try {
    return res.status(200).json(await getUpcomingEvents());
  } catch (err) {
    return sendServerError(res, err);
  }
});

app.listen(3000, () => {
  console.log("Node API app is running on port 3000");
});

module.exports = app;
