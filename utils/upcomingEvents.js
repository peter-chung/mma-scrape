const { getPool, table } = require("./db");

// Transitional read path: rebuilds the JSON shape the old MongoDB snapshot
// served (`[{ data: [event] }]`), so fyte-center's normalizeMmaEvents.js keeps
// working unchanged. Retire once fyte-center queries Supabase directly.

function ufcstatsFighterUrl(fighterId) {
  return `http://ufcstats.com/fighter-details/${fighterId}`;
}

function toIso(value) {
  return value ? new Date(value).toISOString() : null;
}

// fyte-center falls back to `dateTime` only when mainCardStartIso is null,
// and formats "Saturday, December 12, 2026" as "Dec 12".
function longDate(eventDate) {
  return new Date(`${eventDate}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function toFighter(fighter) {
  if (!fighter) {
    return { name: "TBD", link: "", fighterId: null };
  }
  return {
    name: fighter.name || "TBD",
    link: fighter.link || ufcstatsFighterUrl(fighter.fighterId),
    fighterId: fighter.fighterId,
  };
}

async function getUpcomingEvents() {
  const { rows } = await getPool().query(`
    select e.event_id, e.name as event_name, e.event_date, e.link as event_link,
           e.city, e.state, e.country,
           e.main_card_start, e.prelims_start, e.early_prelims_start,
           f.fight_id, f.fight_order, f.weight_class, f.card_segment,
           fs.corner, fr.fighter_id, fr.link as fighter_link,
           nullif(trim(concat_ws(' ', fr.first_name, fr.last_name)), '') as fighter_name
    from ${table("events")} e
    left join ${table("fights")} f on f.event_id = e.event_id
    left join ${table("fight_stats")} fs on fs.fight_id = f.fight_id
    left join ${table("fighters")} fr on fr.fighter_id = fs.fighter_id
    where not e.completed
      and e.event_date >= current_date - 1
    order by e.event_date, e.event_id, f.fight_order, fs.corner
  `);

  const events = new Map();

  rows.forEach((row) => {
    if (!events.has(row.event_id)) {
      const mainCardStartIso = toIso(row.main_card_start);
      events.set(row.event_id, {
        eventId: row.event_id,
        title: row.event_name,
        eventDate: row.event_date,
        dateTime: mainCardStartIso || longDate(row.event_date),
        mainCardStartIso,
        prelimsStartIso: toIso(row.prelims_start),
        earlyPrelimsStartIso: toIso(row.early_prelims_start),
        link: row.event_link,
        venue: "",
        city: row.city || "",
        state: row.state || "",
        country: row.country || "",
        fightsById: new Map(),
      });
    }

    if (!row.fight_id) {
      return;
    }

    const fightsById = events.get(row.event_id).fightsById;
    if (!fightsById.has(row.fight_id)) {
      fightsById.set(row.fight_id, {
        fightId: row.fight_id,
        weightClass: row.weight_class,
        cardSection: row.card_segment,
        sourceCardSegment: null,
        corners: [null, null],
      });
    }

    if (row.corner) {
      fightsById.get(row.fight_id).corners[row.corner - 1] = {
        fighterId: row.fighter_id,
        name: row.fighter_name,
        link: row.fighter_link,
      };
    }
  });

  const data = [...events.values()].map(({ fightsById, ...event }) => ({
    ...event,
    fights: [...fightsById.values()].map(({ corners, ...fight }) => ({
      ...fight,
      fighter1: toFighter(corners[0]),
      fighter2: toFighter(corners[1]),
    })),
  }));

  return [{ data }];
}

module.exports = getUpcomingEvents;
