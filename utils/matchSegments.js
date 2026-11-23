const { fetchEspnSegments } = require("./espnSegments");
const { getPool, withTransaction, table } = require("./db");

const DAY_MS = 24 * 60 * 60 * 1000;
const NAME_SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv"]);
// Letters NFD doesn't decompose into base letter + diacritic (e.g. Błachowicz).
const SPECIAL_LETTERS = { ł: "l", ø: "o", đ: "d", ð: "d", ı: "i", ß: "ss", æ: "ae", œ: "oe", þ: "th" };

/** "José Aldo Jr." → "jose aldo" */
function normalizeName(name = "") {
  return String(name)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[łøđðıßæœþ]/g, (letter) => SPECIAL_LETTERS[letter])
    .replace(/['’.]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((token) => token && !NAME_SUFFIXES.has(token))
    .join(" ");
}

function lastName(normalized) {
  return normalized.split(" ").at(-1) || "";
}

function pairKey(a, b) {
  return [a, b].sort().join("|");
}

// ufcstats event_date is a bare local date; ESPN's date is UTC and US-evening
// cards roll into the next UTC day, so allow ±1 day.
function dayDistance(eventDate, espnIso) {
  const ufcDay = Date.parse(`${eventDate}T00:00:00Z`);
  const espnDay = Date.parse(`${espnIso.slice(0, 10)}T00:00:00Z`);
  return Math.abs(ufcDay - espnDay) / DAY_MS;
}

/**
 * Match one Postgres event's fights against one ESPN event's fights.
 * Exact normalized full-name pair first (either order); then, for fights still
 * unmatched, a last-name pair — only when it's unambiguous on both sides.
 *
 * @returns {Map<fightId, espnFight>}
 */
function matchFights(dbFights, espnFights) {
  const matches = new Map();
  const usedEspn = new Set();

  const fullKeyToEspn = new Map();
  espnFights.forEach((fight, index) => {
    fullKeyToEspn.set(
      pairKey(normalizeName(fight.fighter1Name), normalizeName(fight.fighter2Name)),
      index
    );
  });

  dbFights.forEach((fight) => {
    const index = fullKeyToEspn.get(pairKey(normalizeName(fight.names[0]), normalizeName(fight.names[1])));
    if (index !== undefined && !usedEspn.has(index)) {
      matches.set(fight.fightId, espnFights[index]);
      usedEspn.add(index);
    }
  });

  const countKeys = (keys) =>
    keys.reduce((counts, key) => counts.set(key, (counts.get(key) || 0) + 1), new Map());
  const lastKey = (a, b) => pairKey(lastName(normalizeName(a)), lastName(normalizeName(b)));

  const remainingEspn = espnFights
    .map((fight, index) => ({ index, key: lastKey(fight.fighter1Name, fight.fighter2Name) }))
    .filter(({ index }) => !usedEspn.has(index));
  const remainingDb = dbFights
    .filter((fight) => !matches.has(fight.fightId))
    .map((fight) => ({ fight, key: lastKey(fight.names[0], fight.names[1]) }));

  const espnCounts = countKeys(remainingEspn.map(({ key }) => key));
  const dbCounts = countKeys(remainingDb.map(({ key }) => key));

  remainingDb.forEach(({ fight, key }) => {
    if (espnCounts.get(key) !== 1 || dbCounts.get(key) !== 1) {
      return;
    }
    const { index } = remainingEspn.find((candidate) => candidate.key === key);
    matches.set(fight.fightId, espnFights[index]);
    usedEspn.add(index);
  });

  return matches;
}

/**
 * Pure matching step (no I/O).
 *
 * @param dbEvents   [{ eventId, eventDate: 'YYYY-MM-DD', fights: [{ fightId, names: [a, b] }] }]
 * @param espnEvents output of fetchEspnSegments()
 * @returns [{ eventId, espnEventId, segmentStarts, fightSegments: [{ fightId, segment, startTime }], unmatchedFightIds }]
 *   Only events that matched an ESPN event (≥1 fight in common) are returned.
 */
function matchEventSegments(dbEvents, espnEvents) {
  const results = [];

  dbEvents.forEach((dbEvent) => {
    const fightsWithNames = dbEvent.fights.filter((fight) => fight.names.every(Boolean));

    // Several ESPN events can fall within ±1 day; pick the one sharing the
    // most fights, then the closest date.
    let best = null;
    espnEvents
      .filter((espnEvent) => dayDistance(dbEvent.eventDate, espnEvent.date) <= 1)
      .forEach((espnEvent) => {
        const matches = matchFights(fightsWithNames, espnEvent.fights);
        const distance = dayDistance(dbEvent.eventDate, espnEvent.date);
        if (
          matches.size > 0 &&
          (!best ||
            matches.size > best.matches.size ||
            (matches.size === best.matches.size && distance < best.distance))
        ) {
          best = { espnEvent, matches, distance };
        }
      });

    if (!best) {
      return;
    }

    results.push({
      eventId: dbEvent.eventId,
      espnEventId: best.espnEvent.espnEventId,
      segmentStarts: best.espnEvent.segmentStarts,
      fightSegments: [...best.matches].map(([fightId, espnFight]) => ({
        fightId,
        segment: espnFight.segment,
        startTime: espnFight.startTime,
      })),
      unmatchedFightIds: dbEvent.fights
        .map((fight) => fight.fightId)
        .filter((fightId) => !best.matches.has(fightId)),
    });
  });

  return results;
}

async function loadUpcomingDbEvents(client) {
  const { rows } = await client.query(`
    select e.event_id, e.event_date, f.fight_id, fs.corner,
           trim(concat_ws(' ', fr.first_name, fr.last_name)) as full_name
    from ${table("events")} e
    join ${table("fights")} f on f.event_id = e.event_id
    left join ${table("fight_stats")} fs on fs.fight_id = f.fight_id
    left join ${table("fighters")} fr on fr.fighter_id = fs.fighter_id
    where not e.completed
      and e.event_date >= current_date - 1
    order by e.event_date, f.fight_order, fs.corner
  `);

  const events = new Map();
  rows.forEach((row) => {
    if (!events.has(row.event_id)) {
      events.set(row.event_id, { eventId: row.event_id, eventDate: row.event_date, fights: new Map() });
    }
    const fights = events.get(row.event_id).fights;
    if (!fights.has(row.fight_id)) {
      fights.set(row.fight_id, { fightId: row.fight_id, names: [null, null] });
    }
    if (row.corner) {
      fights.get(row.fight_id).names[row.corner - 1] = row.full_name || null;
    }
  });

  return [...events.values()].map((event) => ({ ...event, fights: [...event.fights.values()] }));
}

/**
 * Fetch ESPN segments and write them onto upcoming Postgres fights.
 * For each matched event, every fight's segment is recomputed: matched fights
 * get ESPN's segment/start, the rest are cleared to null ("Unassigned Fights"),
 * so a fight ESPN moves or drops self-heals on the next run. Events with no
 * ESPN counterpart are left untouched (avoids wiping data on an ESPN gap).
 */
async function syncEspnSegments() {
  const espnEvents = await fetchEspnSegments();
  const dbEvents = await loadUpcomingDbEvents(getPool());
  const results = matchEventSegments(dbEvents, espnEvents);

  await withTransaction(async (client) => {
    for (const result of results) {
      await client.query(
        `update ${table("events")}
           set main_card_start = $2, prelims_start = $3, early_prelims_start = $4,
               segments_synced_at = now()
         where event_id = $1`,
        [
          result.eventId,
          result.segmentStarts.main,
          result.segmentStarts.prelims,
          result.segmentStarts.early_prelims,
        ]
      );
      await client.query(
        `update ${table("fights")} set card_segment = null, segment_start = null where event_id = $1`,
        [result.eventId]
      );
      for (const fight of result.fightSegments) {
        await client.query(
          `update ${table("fights")} set card_segment = $2, segment_start = $3 where fight_id = $1`,
          [fight.fightId, fight.segment, fight.startTime]
        );
      }
    }
  });

  return {
    espnEvents: espnEvents.length,
    upcomingDbEvents: dbEvents.length,
    matchedEvents: results.length,
    matchedFights: results.reduce((sum, result) => sum + result.fightSegments.length, 0),
    unmatchedFights: results.reduce((sum, result) => sum + result.unmatchedFightIds.length, 0),
    unmatchedEvents: dbEvents
      .filter((event) => !results.some((result) => result.eventId === event.eventId))
      .map((event) => event.eventId),
  };
}

module.exports = { syncEspnSegments, matchEventSegments, normalizeName };
