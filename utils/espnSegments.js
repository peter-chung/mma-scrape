// ESPN's only job now: for each upcoming UFC event, say which broadcast
// segment (main / prelims / early_prelims) each fight is on and when that
// segment starts. Events, matchups and stats all come from BigQuery.

const requestHeaders = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
  Accept: "application/json,text/plain;q=0.9,*/*;q=0.8",
};

const scoreboardApiUrl = "https://site.api.espn.com/apis/site/v2/sports/mma/ufc/scoreboard";
const upcomingWindowDays = 365;
const scoreboardEventLimit = 300;
const mainCardSection = "main";
const prelimsSection = "prelims";
const earlyPrelimsSection = "early_prelims";

function normalizeText(value = "") {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function toIsoString(value = "") {
  const normalizedValue = normalizeText(value);

  if (!normalizedValue) {
    return null;
  }

  const date = new Date(normalizedValue);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function getUpcomingDateRange(days) {
  const start = new Date();
  const end = new Date(start.getTime() + days * 24 * 60 * 60 * 1000);
  const format = (date) => date.toISOString().slice(0, 10).replace(/-/g, "");

  return `${format(start)}-${format(end)}`;
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: requestHeaders });
  const contentType = response.headers.get("content-type") || "";

  if (!response.ok) {
    throw new Error(
      `request failed for ${url}: ${response.status} ${response.statusText}; contentType=${contentType}`
    );
  }

  if (!contentType.includes("application/json")) {
    const snippet = normalizeText(await response.text()).slice(0, 300);
    throw new Error(
      `unexpected content-type for ${url}; contentType=${contentType}; snippet="${snippet}"`
    );
  }

  return response.json();
}

function getFighterName(competitor = {}) {
  const athlete = competitor.athlete || {};
  const name = normalizeText(athlete.fullName || athlete.displayName || "");

  return !name || /^(opponent\s+)?tba$/i.test(name) ? null : name;
}

// ESPN has no explicit segment field; fights on the same segment share a
// start time. The latest start time is the main card, the one before it the
// prelims, and anything earlier the early prelims.
function getStartTimeGroupIndexes(competitions = []) {
  const startTimes = [...new Set(competitions.map((competition) => competition.date))].sort();
  return new Map(startTimes.map((startTime, index) => [startTime, index]));
}

function getCardSectionForGroup(groupIndex, groupCount) {
  const distanceFromMainCard = groupCount - 1 - groupIndex;

  if (distanceFromMainCard <= 0) return mainCardSection;
  if (distanceFromMainCard === 1) return prelimsSection;
  return earlyPrelimsSection;
}

function parseEventSegments(event = {}) {
  const competitions = event.competitions || [];
  const groupIndexByStartTime = getStartTimeGroupIndexes(competitions);
  const groupCount = groupIndexByStartTime.size;

  const fights = competitions
    .map((competition) => {
      const names = [...(competition.competitors || [])]
        .sort((left, right) => (left.order ?? 99) - (right.order ?? 99))
        .map(getFighterName)
        .filter(Boolean);

      if (names.length < 2) {
        return null;
      }

      return {
        fighter1Name: names[0],
        fighter2Name: names[1],
        segment: getCardSectionForGroup(groupIndexByStartTime.get(competition.date), groupCount),
        startTime: toIsoString(competition.date),
      };
    })
    .filter(Boolean);

  // Start times are iterated earliest first; keep the first (earliest) time per
  // section, so if several groups ever map to early_prelims it starts when the
  // first of them does.
  const segmentStarts = {};
  groupIndexByStartTime.forEach((groupIndex, startTime) => {
    segmentStarts[getCardSectionForGroup(groupIndex, groupCount)] ??= toIsoString(startTime);
  });

  const earliestStart = [...groupIndexByStartTime.keys()][0];

  return {
    espnEventId: event.id,
    name: normalizeText(event.name),
    // Earliest fight start (UTC); used for ±1-day date matching.
    date: toIsoString(earliestStart || event.date),
    segmentStarts: {
      main: segmentStarts[mainCardSection] ?? null,
      prelims: segmentStarts[prelimsSection] ?? null,
      early_prelims: segmentStarts[earlyPrelimsSection] ?? null,
    },
    fights,
  };
}

function isUpcomingEvent(event = {}) {
  return event.status?.type?.state === "pre";
}

/**
 * @returns {Promise<Array<{espnEventId, name, date, segmentStarts, fights: Array<{fighter1Name, fighter2Name, segment, startTime}>}>>}
 */
async function fetchEspnSegments() {
  const url = `${scoreboardApiUrl}?dates=${getUpcomingDateRange(upcomingWindowDays)}&limit=${scoreboardEventLimit}`;
  const payload = await fetchJson(url);

  return (payload.events || [])
    .filter(isUpcomingEvent)
    .map(parseEventSegments)
    .filter((event) => event.date && event.fights.length);
}

module.exports = { fetchEspnSegments, parseEventSegments };
