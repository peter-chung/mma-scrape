const test = require("node:test");
const assert = require("node:assert/strict");
const { matchEventSegments, normalizeName, segmentWarnings } = require("../utils/matchSegments");
const { parseEventSegments } = require("../utils/espnSegments");

const MAIN = "2026-12-13T03:00:00Z";
const PRELIMS = "2026-12-13T01:00:00Z";
const EARLY = "2026-12-12T23:00:00Z";

function competition(date, a, b) {
  return {
    date,
    competitors: [
      { order: 1, athlete: { fullName: a } },
      { order: 2, athlete: { fullName: b } },
    ],
  };
}

// Mirrors UFC 335 as checked in the master plan.
const espnEvent = parseEventSegments({
  id: "600001",
  name: "UFC 335",
  competitions: [
    competition(EARLY, "Joshua Pasley", "Tafa"),
    competition(PRELIMS, "Maycee Barber", "Judice"),
    competition(MAIN, "Brandon Moreno", "Johnson"),
    competition(MAIN, "Sergei Pavlovich", "Alex Pereira"),
    competition(MAIN, "Charles Oliveira", "Lopes"),
    competition(MAIN, "TBA", "Someone"),
  ],
});

const dbEvent = {
  eventId: "ufc335",
  eventDate: "2026-12-12",
  fights: [
    { fightId: "f0", names: ["Charles Oliveira", "Lopes"] },
    // reversed order + diacritics vs ESPN
    { fightId: "f1", names: ["Álex Pereira", "Sergei Pavlovich"] },
    { fightId: "f2", names: ["Brandon Moreno", "Johnson"] },
    // first-name spelling differs → last-name fallback
    { fightId: "f3", names: ["Macy Barber", "Judice"] },
    { fightId: "f4", names: ["Joshua Pasley", "Tafa"] },
    // not on ESPN yet → stays unassigned
    { fightId: "f5", names: ["New Guy", "Other Guy"] },
    // fighter profile not scraped yet → can't match
    { fightId: "f6", names: ["Somebody", null] },
  ],
};

test("normalizeName strips diacritics, punctuation and suffixes", () => {
  assert.equal(normalizeName("José Aldo Jr."), "jose aldo");
  assert.equal(normalizeName("Da'Mon  Blackshear"), "damon blackshear");
  assert.equal(normalizeName("Jan Błachowicz"), "jan blachowicz");
});

test("parseEventSegments groups by start time and skips TBA", () => {
  assert.equal(espnEvent.fights.length, 5);
  assert.deepEqual(espnEvent.segmentStarts, {
    main: new Date(MAIN).toISOString(),
    prelims: new Date(PRELIMS).toISOString(),
    early_prelims: new Date(EARLY).toISOString(),
  });
  assert.equal(espnEvent.date, new Date(EARLY).toISOString());
});

test("parseEventSegments keeps the earliest time when several groups are early prelims", () => {
  const event = parseEventSegments({
    id: "4",
    competitions: [
      competition("2026-12-12T22:00:00Z", "A One", "B One"),
      competition("2026-12-12T23:00:00Z", "A Two", "B Two"),
      competition(PRELIMS, "A Three", "B Three"),
      competition(MAIN, "A Four", "B Four"),
    ],
  });

  assert.equal(event.segmentStarts.early_prelims, new Date("2026-12-12T22:00:00Z").toISOString());
  assert.equal(event.segmentStarts.prelims, new Date(PRELIMS).toISOString());
  assert.equal(event.segmentStarts.main, new Date(MAIN).toISOString());
  assert.deepEqual(
    event.fights.map((fight) => fight.segment),
    ["early_prelims", "early_prelims", "prelims", "main"]
  );
});

test("parseEventSegments ignores a fight with no start time instead of shifting the card", () => {
  const event = parseEventSegments({
    id: "5",
    competitions: [
      competition(PRELIMS, "A One", "B One"),
      competition(MAIN, "A Two", "B Two"),
      competition(undefined, "A Three", "B Three"),
    ],
  });

  assert.deepEqual(
    event.fights.map((fight) => [fight.fighter1Name, fight.segment]),
    [
      ["A One", "prelims"],
      ["A Two", "main"],
      ["A Three", null],
    ]
  );
  assert.equal(event.segmentStarts.main, new Date(MAIN).toISOString());
  assert.equal(event.segmentStarts.prelims, new Date(PRELIMS).toISOString());
});

test("segmentWarnings flags an empty ESPN feed and zero matches, not a single missing card", () => {
  assert.equal(segmentWarnings(0, 8, 0).length, 1);
  assert.equal(segmentWarnings(8, 8, 0).length, 1);
  assert.deepEqual(segmentWarnings(8, 8, 7), []);
  assert.deepEqual(segmentWarnings(8, 0, 0), []);
});

test("matches fights by name pair, either order, leaving the rest unassigned", () => {
  const [result] = matchEventSegments([dbEvent], [espnEvent]);
  const segmentOf = Object.fromEntries(result.fightSegments.map((f) => [f.fightId, f.segment]));

  assert.deepEqual(segmentOf, {
    f0: "main",
    f1: "main",
    f2: "main",
    f3: "prelims",
    f4: "early_prelims",
  });
  assert.deepEqual(result.unmatchedFightIds.sort(), ["f5", "f6"]);
});

test("event dates match within ±1 day only", () => {
  const nextDay = matchEventSegments([{ ...dbEvent, eventDate: "2026-12-13" }], [espnEvent]);
  assert.equal(nextDay.length, 1);

  const tooFar = matchEventSegments([{ ...dbEvent, eventDate: "2026-12-10" }], [espnEvent]);
  assert.equal(tooFar.length, 0);
});

test("ambiguous last-name fallback does not match", () => {
  const espn = parseEventSegments({
    id: "2",
    competitions: [
      competition(MAIN, "John Smith", "Bob Jones"),
      competition(PRELIMS, "Jake Smith", "Bill Jones"),
    ],
  });
  const [result] = matchEventSegments(
    [
      {
        eventId: "e",
        eventDate: "2026-12-12",
        fights: [
          { fightId: "a", names: ["Jon Smith", "Rob Jones"] },
          { fightId: "b", names: ["John Smith", "Bob Jones"] },
        ],
      },
    ],
    [espn]
  );
  // "b" matches exactly; "a" has two possible last-name partners on ESPN's
  // side before the exact match consumes one, but after it, only one remains.
  const ids = result.fightSegments.map((f) => f.fightId).sort();
  assert.deepEqual(ids, ["a", "b"]);
  assert.equal(result.fightSegments.find((f) => f.fightId === "a").segment, "prelims");
});
