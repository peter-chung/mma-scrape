const mongoose = require("mongoose");

const fighterSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    link: {
      type: String,
      required: true,
      trim: true,
    },
  },
  { _id: false }
);

const fightSchema = new mongoose.Schema(
  {
    isMainCard: {
      type: Boolean,
      required: true,
    },
    fighter1: {
      type: fighterSchema,
      required: true,
    },
    fighter2: {
      type: fighterSchema,
      required: true,
    },
  },
  { _id: false }
);

const eventSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    mainCardStartIso: {
      type: String,
      default: "",
      trim: true,
    },
    prelimsStartIso: {
      type: String,
      default: "",
      trim: true,
    },
    link: {
      type: String,
      required: true,
      trim: true,
    },
    venue: {
      type: String,
      default: "",
      trim: true,
    },
    location: {
      type: String,
      default: "",
      trim: true,
    },
    fights: {
      type: [fightSchema],
      default: [],
    },
  },
  { _id: false }
);

const eventsSchema = mongoose.Schema(
  {
    data: {
      type: [eventSchema],
      default: [],
    },
  },
  {
    capped: { size: 1024, max: 1 },
    timestamps: true,
  }
);

const Events = mongoose.model("Events", eventsSchema);

module.exports = Events;
