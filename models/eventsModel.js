const mongoose = require("mongoose");

const eventsSchema = mongoose.Schema(
  { data: { type: Array, required: false, default: [] } },
  {
    capped: { size: 1024, max: 1 },
    strict: false,
    timestamps: true,
  }
);

const Events = mongoose.model("Events", eventsSchema);

module.exports = Events;
