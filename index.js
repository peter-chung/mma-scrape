require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const app = express();

const Events = require("./models/eventsModel");
const scrape = require("./utils/scrape");

// middleware for app to use json
app.use(express.json());

// post endpoint to trigger mmaEventsScrape
app.post("/scrape", async (req, res) => {
  const { key } = req.body;

  // check for invalid key
  if (!key || key !== process.env.SCRAPER_KEY) {
    return res.status(401).send({
      message: "invalid key",
    });
  }

  // scrape and update DB
  try {
    console.log("scraper called");
    const scrapedData = await scrape();
    console.log("scraper successful");
    const response = await Events.create(scrapedData);
    res.status(200).json(response);
  } catch (err) {
    console.log(err.message);
    res.status(500).json({ message: err.message });
  }
});

// create events entry
app.post("/events", async (req, res) => {
  try {
    const events = await Events.create(req.body);
    res.status(200).json(events);
  } catch (err) {
    console.log(err.message);
    res.status(500).json({ message: err.message });
  }
});

// update an event
app.put("/events/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const event = await Events.findByIdAndUpdate(id, req.body);

    // cannot find event in database
    if (!event) {
      return res
        .status(404)
        .json({ message: `cannot find any events with ID ${id}` });
    }
    const updatedEvent = await Events.findById(id);
    res.status(200).json(event);
  } catch (err) {
    console.log(err.message);
    res.status(500).json({ message: err.message });
  }
});

// delete an event
app.delete("/events/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const event = await Events.findByIdAndDelete(id);

    // cannot find event in database
    if (!event) {
      return res
        .status(404)
        .json({ message: `cannot find any events with ID ${id}` });
    }
    res.status(200).json(event);
  } catch (err) {
    console.log(err.message);
    res.status(500).json({ message: err.message });
  }
});

// get all events
app.get("/events", async (req, res) => {
  try {
    const events = await Events.find({});
    res.status(200).json(events);
  } catch (err) {
    console.log(err.message);
    res.status(500).json({ message: err.message });
  }
});

// get event by id
app.get("/events/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const event = await Events.findById(id);
    res.status(200).json(event);
  } catch (err) {
    console.log(err.message);
    res.status(500).json({ message: err.message });
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
