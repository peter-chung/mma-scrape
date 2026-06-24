const requestHeaders = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
  Accept: "application/json,text/plain;q=0.9,*/*;q=0.8",
};

const scoreboardApiUrl = "https://site.api.espn.com/apis/site/v2/sports/mma/ufc/scoreboard";
const fighterProfileBaseUrl = "https://www.espn.com/mma/fighter/_/id";
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
  return Number.isNaN(date.getTime()) ? normalizedValue : date.toISOString();
}

function slugifyName(name = "") {
  return normalizeText(name)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
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

function buildFighter(competitor = {}) {
  const athlete = competitor.athlete || {};
  const id = competitor.id;
  const name = normalizeText(athlete.fullName || athlete.displayName || "");

  if (!id || !name || /^(opponent\s+)?tba$/i.test(name)) {
    return null;
  }

  return {
    name,
    link: `${fighterProfileBaseUrl}/${id}/${slugifyName(name)}`,
  };
}

function buildFight(competition = {}, cardSection) {
  const fighters = [...(competition.competitors || [])]
    .sort((left, right) => (left.order ?? 99) - (right.order ?? 99))
    .map(buildFighter)
    .filter(Boolean);

  if (fighters.length < 2) {
    return null;
  }

  return {
    cardSection,
    sourceCardSegment: null,
    fighter1: fighters[0],
    fighter2: fighters[1],
  };
}

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

function parseEventFights(competitions = []) {
  const groupIndexByStartTime = getStartTimeGroupIndexes(competitions);
  const groupCount = groupIndexByStartTime.size;

  const fights = competitions
    .map((competition) =>
      buildFight(
        competition,
        getCardSectionForGroup(groupIndexByStartTime.get(competition.date), groupCount)
      )
    )
    .filter(Boolean);

  const startIsoBySection = {};
  groupIndexByStartTime.forEach((groupIndex, startTime) => {
    startIsoBySection[getCardSectionForGroup(groupIndex, groupCount)] = toIsoString(startTime) || "";
  });

  return {
    fights,
    mainCardStartIso: startIsoBySection[mainCardSection] || "",
    prelimsStartIso: startIsoBySection[prelimsSection] || "",
    earlyPrelimsStartIso: startIsoBySection[earlyPrelimsSection] || "",
  };
}

function parseEventLocation(event = {}) {
  const venue = event.venues?.[0] || {};

  return {
    venue: normalizeText(venue.fullName),
    city: normalizeText(venue.address?.city),
    state: normalizeText(venue.address?.state),
    country: normalizeText(venue.address?.country),
  };
}

function isUpcomingEvent(event = {}) {
  return event.status?.type?.state === "pre";
}

function parseEvent(event = {}) {
  const title = normalizeText(event.name);
  const link = event.links?.[0]?.href || "";

  if (!title || !link) {
    return null;
  }

  const { fights, mainCardStartIso, prelimsStartIso, earlyPrelimsStartIso } = parseEventFights(
    event.competitions
  );

  return {
    title,
    mainCardStartIso,
    prelimsStartIso,
    earlyPrelimsStartIso,
    link,
    ...parseEventLocation(event),
    fights,
  };
}

async function scrape() {
  const url = `${scoreboardApiUrl}?dates=${getUpcomingDateRange(upcomingWindowDays)}&limit=${scoreboardEventLimit}`;
  const payload = await fetchJson(url);
  const events = (payload.events || [])
    .filter(isUpcomingEvent)
    .map(parseEvent)
    .filter(Boolean);

  if (!events.length) {
    throw new Error("event scrape produced no data");
  }

  return { data: events };
}

module.exports = scrape;
