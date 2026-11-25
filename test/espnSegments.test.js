const test = require("node:test");
const assert = require("node:assert/strict");
const { parseEventSegments, hasDistinctSegments, monthWindows } = require("../utils/espnSegments");

function competition(date, a, b) {
  return {
    date,
    competitors: [
      { order: 1, athlete: { fullName: a } },
      { order: 2, athlete: { fullName: b } },
    ],
  };
}

test("hasDistinctSegments needs at least two start-time groups", () => {
  // e.g. UFC 189 (2015): every bout listed at one time → can't tell sections apart
  const oneTime = parseEventSegments({
    competitions: [
      competition("2015-07-12T02:00Z", "A One", "B One"),
      competition("2015-07-12T02:00Z", "A Two", "B Two"),
    ],
  });
  assert.equal(hasDistinctSegments(oneTime), false);

  const twoTimes = parseEventSegments({
    competitions: [
      competition("2025-07-12T22:00Z", "A One", "B One"),
      competition("2025-07-13T01:00Z", "A Two", "B Two"),
    ],
  });
  assert.equal(hasDistinctSegments(twoTimes), true);
  assert.deepEqual(
    twoTimes.fights.map((fight) => fight.segment),
    ["prelims", "main"]
  );
});

test("monthWindows covers whole calendar months through the current one", () => {
  const windows = monthWindows("2024-01-15", new Date("2024-03-10T00:00:00Z"));
  const iso = (date) => date.toISOString().slice(0, 10);

  assert.deepEqual(
    windows.map(({ start, end }) => [iso(start), iso(end)]),
    [
      ["2024-01-01", "2024-01-31"],
      ["2024-02-01", "2024-02-29"],
      ["2024-03-01", "2024-03-31"],
    ]
  );
});
