const fs = require("fs");
const path = require("path");
const envPath = path.join(__dirname, ".env.local");

require("dotenv").config(
  fs.existsSync(envPath) ? { path: envPath } : undefined
);
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const app = express();

const Events = require("./models/eventsModel");
const scrape = require("./utils/scrape");

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

function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

function getRequiredEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }

  return value;
}

function getApiKey(req) {
  return req.get("x-api-key") || req.body?.key;
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
  const apiKey = getApiKey(req);

  if (!apiKey || apiKey !== process.env.ADMIN_API_KEY) {
    return res.status(401).json({ message: "invalid API key" });
  }

  return next();
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidFighter(fighter) {
  return (
    isPlainObject(fighter) &&
    isValidNonEmptyString(fighter.name) &&
    isValidNonEmptyString(fighter.link)
  );
}

function isValidFight(fight) {
  return (
    isPlainObject(fight) &&
    typeof fight.isMainCard === "boolean" &&
    isValidFighter(fight.fighter1) &&
    isValidFighter(fight.fighter2)
  );
}

function isValidEvent(event) {
  if (!isPlainObject(event)) {
    return false;
  }

  const locationFields = [event.venue, event.city, event.country];

  return (
    isValidNonEmptyString(event.title) &&
    isValidNonEmptyString(event.link) &&
    typeof event.mainCardStartIso === "string" &&
    typeof event.prelimsStartIso === "string" &&
    locationFields.every((field) => typeof field === "string") &&
    Array.isArray(event.fights) &&
    event.fights.every(isValidFight)
  );
}

function validateEventsPayload(req, res, next) {
  const { data } = req.body;

  if (!Array.isArray(data) || !data.every(isValidEvent)) {
    return res.status(400).json({
      message:
        "invalid events payload; expected { data: [event] } with typed event objects",
    });
  }

  return next();
}

getRequiredEnv("DATABASE_URL");
process.env.ADMIN_API_KEY = process.env.ADMIN_API_KEY || getRequiredEnv("SCRAPER_KEY");

// middleware to configure cors
app.disable("x-powered-by");
app.use(
  cors({
    origin: corsOriginValidator,
  })
);

// middleware for app to use json
app.use(express.json({ limit: "100kb" }));

// post endpoint to trigger mmaEventsScrape
app.post("/scrape", requireApiKey, async (req, res) => {
  // scrape and update DB
  try {
    console.log("scraper called");
    const scrapedData = await scrape();
    console.log("scraper successful");
    const response = await Events.findOneAndUpdate({}, scrapedData, {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
    });
    res.status(200).json(response);
  } catch (err) {
    return sendServerError(res, err);
  }
});

// create events entry
app.post("/events", requireApiKey, validateEventsPayload, async (req, res) => {
  try {
    const events = await Events.create(req.body);
    return res.status(201).json(events);
  } catch (err) {
    return sendServerError(res, err);
  }
});

// update an event
app.put(
  "/events/:id",
  requireApiKey,
  validateEventsPayload,
  async (req, res) => {
    try {
      const { id } = req.params;

      if (!isValidObjectId(id)) {
        return res.status(400).json({ message: `invalid event ID ${id}` });
      }

      const updatedEvent = await Events.findByIdAndUpdate(id, req.body, {
        new: true,
        runValidators: true,
      });

      // cannot find event in database
      if (!updatedEvent) {
        return res
          .status(404)
          .json({ message: `cannot find any events with ID ${id}` });
      }

      return res.status(200).json(updatedEvent);
    } catch (err) {
      return sendServerError(res, err);
    }
  }
);

// delete an event
app.delete("/events/:id", requireApiKey, async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ message: `invalid event ID ${id}` });
    }

    const event = await Events.findByIdAndDelete(id);

    // cannot find event in database
    if (!event) {
      return res
        .status(404)
        .json({ message: `cannot find any events with ID ${id}` });
    }

    return res.status(200).json(event);
  } catch (err) {
    return sendServerError(res, err);
  }
});

// get all events
app.get("/events", async (req, res) => {
  try {
    const events = await Events.find({});
    return res.status(200).json(events);
  } catch (err) {
    return sendServerError(res, err);
  }
});

// get event by id
app.get("/events/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ message: `invalid event ID ${id}` });
    }

    const event = await Events.findById(id);

    if (!event) {
      return res
        .status(404)
        .json({ message: `cannot find any events with ID ${id}` });
    }

    return res.status(200).json(event);
  } catch (err) {
    return sendServerError(res, err);
  }
});

mongoose
  .connect(process.env.DATABASE_URL)
  .then(() => {
    app.listen(3000, () => {
      console.log("Node API app is running on port 3000");
    });
    console.log("connected to MongoDB");
  })
  .catch((err) => {
    console.log(err);
  });
