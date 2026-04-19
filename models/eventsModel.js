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

const validCardSections = ["main", "prelims", "early_prelims"];

const fightSchema = new mongoose.Schema(
  {
    cardSection: {
      type: String,
      default: null,
      trim: true,
      validate: {
        validator: (value) => value === null || validCardSections.includes(value),
        message: "invalid cardSection value",
      },
    },
    sourceCardSegment: {
      type: String,
      default: null,
      trim: true,
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
    earlyPrelimsStartIso: {
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
    city: {
      type: String,
      default: "",
      trim: true,
    },
    state: {
      type: String,
      default: "",
      trim: true,
    },
    country: {
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
