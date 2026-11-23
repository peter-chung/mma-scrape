const test = require("node:test");
const assert = require("node:assert/strict");
const { toFightStatsRows, splitCancelledEvents } = require("../utils/syncFromBigQuery");

test("splitCancelledEvents drops cancelled events' fights and lists their ids", () => {
  const { fightRows, cancelledEventIds } = splitCancelledEvents([
    { fight_id: "a1", event_id: "a", event_status: "upcoming" },
    { fight_id: "b1", event_id: "b", event_status: "cancelled" },
    { fight_id: "b2", event_id: "b", event_status: "cancelled" },
    { fight_id: "c1", event_id: "c", event_status: "completed" },
  ]);

  assert.deepEqual(fightRows.map((row) => row.fight_id), ["a1", "c1"]);
  assert.deepEqual(cancelledEventIds, ["b"]);
});

test("splitCancelledEvents fails clearly when fct_fights predates event_status", () => {
  assert.throws(() => splitCancelledEvents([{ fight_id: "a1", event_id: "a" }]), /dbt run/);
});

test("toFightStatsRows builds one row per corner", () => {
  const rows = toFightStatsRows({
    fight_id: "f1",
    fighter_1_id: "a",
    fighter_2_id: "b",
    fighter_1_result: "W",
    fighter_2_result: "L",
    fighter_1_knockdowns: 1,
  });

  assert.deepEqual(
    rows.map(({ fighter_id, corner, result }) => ({ fighter_id, corner, result })),
    [
      { fighter_id: "a", corner: 1, result: "W" },
      { fighter_id: "b", corner: 2, result: "L" },
    ]
  );
  assert.equal(rows[0].knockdowns, 1);
});

test("toFightStatsRows skips a corner with no fighter (opponent TBD)", () => {
  assert.deepEqual(
    toFightStatsRows({ fight_id: "f2", fighter_1_id: "a", fighter_2_id: null }).map(
      ({ fighter_id, corner }) => ({ fighter_id, corner })
    ),
    [{ fighter_id: "a", corner: 1 }]
  );
  assert.deepEqual(
    toFightStatsRows({ fight_id: "f3", fighter_1_id: null, fighter_2_id: "b" }).map(
      ({ fighter_id, corner }) => ({ fighter_id, corner })
    ),
    [{ fighter_id: "b", corner: 2 }]
  );
});
