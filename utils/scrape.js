const cheerio = require("cheerio");

const baseUrl = "https://www.ufc.com";
const liveEventApiBaseUrl = "https://d29dxerjsp82wz.cloudfront.net/api/v3/event/live";
const mainCardSourceSegment = "Main";
const prelimsSourceSegment = "Prelims1";
const earlyPrelimsSourceSegment = "Prelims2";
const mainCardSection = "main";
const prelimsSection = "prelims";
const earlyPrelimsSection = "early_prelims";
const requestHeaders = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};
const botProtectionPatterns = [
  /captcha/i,
  /cloudflare/i,
  /attention required/i,
  /verify you are human/i,
  /are you human/i,
  /bot detection/i,
  /access denied/i,
  /challenge-platform/i,
];

function normalizeText(value = "") {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeMatchText(value = "") {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();
}

function normalizeSourceCardSegment(value = "") {
  const segment = normalizeText(value);

  if (
    segment === mainCardSourceSegment ||
    segment === prelimsSourceSegment ||
    segment === earlyPrelimsSourceSegment
  ) {
    return segment;
  }

  return "";
}

function normalizeCardSection(value = null) {
  const section = normalizeText(value).toLowerCase().replace(/\s+/g, "_");

  if (
    section === mainCardSection ||
    section === prelimsSection ||
    section === earlyPrelimsSection
  ) {
    return section;
  }

  return null;
}

function getCardSection(sourceCardSegment = "") {
  switch (normalizeSourceCardSegment(sourceCardSegment)) {
    case mainCardSourceSegment:
      return mainCardSection;
    case prelimsSourceSegment:
      return prelimsSection;
    case earlyPrelimsSourceSegment:
      return earlyPrelimsSection;
    default:
      return null;
  }
}

function toIsoString(value = "") {
  const normalizedValue = normalizeText(value);

  if (!normalizedValue) {
    return null;
  }

  const date = new Date(normalizedValue);
  return Number.isNaN(date.getTime()) ? normalizedValue : date.toISOString();
}

function getDateTimeInfo($, containerSelector, timeSelector = containerSelector) {
  const timeNode = $(timeSelector).first();
  const unixTimestamp = timeNode.attr("data-timestamp");

  if (unixTimestamp) {
    return {
      iso: new Date(Number(unixTimestamp) * 1000).toISOString(),
    };
  }

  return {
    iso: timeNode.attr("datetime") || "",
  };
}

function getViewingOptionTime($, label) {
  let iso = "";

  $(".c-listing-viewing-option").each((index, el) => {
    if (iso) {
      return;
    }

    const option = $(el);
    const fightCardLabel = normalizeText(
      option.find(".c-listing-viewing-option__fight-card").first().text()
    ).toLowerCase();

    if (fightCardLabel !== label.toLowerCase()) {
      return;
    }

    iso = getDateTimeInfo($, "", option.find(".c-listing-viewing-option__time").first()).iso;
  });

  return {
    iso,
  };
}

function getEventTimes($) {
  const legacyMainCard = getDateTimeInfo(
    $,
    ".hero-fixed-bar__date.tz-change-inner",
    ".field--name-fight-card-time-main time"
  );
  const legacyPrelims = getDateTimeInfo(
    $,
    ".field--name-fight-card-time-prelims",
    ".field--name-fight-card-time-prelims time"
  );
  const legacyEarlyPrelims = getDateTimeInfo(
    $,
    ".field--name-fight-card-time-early",
    ".field--name-fight-card-time-early time"
  );
  const viewingOptionMainCard = getViewingOptionTime($, "Main Card");
  const viewingOptionPrelims = getViewingOptionTime($, "Prelims");
  const viewingOptionEarlyPrelims = getViewingOptionTime($, "Early Prelims");

  return {
    mainCard: viewingOptionMainCard.iso ? viewingOptionMainCard : legacyMainCard,
    prelims: viewingOptionPrelims.iso ? viewingOptionPrelims : legacyPrelims,
    earlyPrelims: viewingOptionEarlyPrelims.iso
      ? viewingOptionEarlyPrelims
      : legacyEarlyPrelims,
  };
}

function getHtmlSnippet(html = "", maxLength = 300) {
  return normalizeText(html).slice(0, maxLength);
}

function detectBotProtection(html = "") {
  return botProtectionPatterns.find((pattern) => pattern.test(html)) || null;
}

async function fetchHtml(url) {
  const response = await fetch(url, { headers: requestHeaders });
  const contentType = response.headers.get("content-type") || "";
  const finalUrl = response.url || url;

  if (!response.ok) {
    throw new Error(
      `request failed for ${url}: ${response.status} ${response.statusText}; finalUrl=${finalUrl}; contentType=${contentType}`
    );
  }

  const html = await response.text();
  const botProtectionPattern = detectBotProtection(html);

  if (botProtectionPattern) {
    throw new Error(
      `likely bot protection for ${url}; matched=${botProtectionPattern}; status=${response.status}; finalUrl=${finalUrl}; contentType=${contentType}; snippet="${getHtmlSnippet(html)}"`
    );
  }

  return html;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      ...requestHeaders,
      Accept: "application/json,text/plain;q=0.9,*/*;q=0.8",
    },
  });
  const contentType = response.headers.get("content-type") || "";
  const finalUrl = response.url || url;

  if (!response.ok) {
    throw new Error(
      `request failed for ${url}: ${response.status} ${response.statusText}; finalUrl=${finalUrl}; contentType=${contentType}`
    );
  }

  return response.json();
}

function toAbsoluteUrl(url = "") {
  if (!url) return "";
  if (url.startsWith("http")) return url.replace(/^http:\/\//i, "https://");
  return `${baseUrl}${url}`;
}

function parseLocation(locationText = "") {
  const lines = locationText
    .split(/\r?\n/)
    .map((part) => normalizeText(part))
    .filter(Boolean);

  if (lines.length > 1) {
    const venue = lines[0].replace(/,\s*$/, "");
    const remainder = lines
      .slice(1)
      .flatMap((part) => part.split(","))
      .map((part) => normalizeText(part))
      .filter(Boolean);

    if (remainder.length >= 3) {
      return {
        venue,
        city: remainder[0],
        country: remainder[remainder.length - 1],
      };
    }

    if (remainder.length === 2) {
      return {
        venue,
        city: remainder[0],
        country: remainder[1],
      };
    }

    if (remainder.length === 1) {
      return {
        venue,
        city: remainder[0],
        country: "",
      };
    }
  }

  const parts = normalizeText(locationText)
    .split(",")
    .map((part) => normalizeText(part))
    .filter(Boolean);

  if (parts.length >= 4) {
    return {
      venue: parts[0],
      city: parts[1],
      country: parts[parts.length - 1],
    };
  }

  if (parts.length === 3) {
    return {
      venue: parts[0],
      city: parts[1],
      country: parts[2],
    };
  }

  if (parts.length === 2) {
    return {
      venue: parts[0],
      city: parts[1],
      country: "",
    };
  }

  return {
    venue: normalizeText(locationText),
    city: "",
    country: "",
  };
}

function buildFight(fighters, cardMetadata = {}) {
  if (fighters.length < 2) {
    return null;
  }

  const normalizedSourceCardSegment = normalizeSourceCardSegment(
    cardMetadata?.sourceCardSegment || ""
  );
  const normalizedCardSection =
    normalizeCardSection(cardMetadata?.cardSection) || getCardSection(normalizedSourceCardSegment);

  return {
    cardSection: normalizedCardSection,
    sourceCardSegment: normalizedSourceCardSegment || null,
    fighter1: fighters[0],
    fighter2: fighters[1],
  };
}

function parseFight($fight, cardMetadata = {}) {
  const fighterLinks = [];

  $fight.find('a[href*="/athlete/"]').each((index, el) => {
    const href = toAbsoluteUrl($fight.find(el).attr("href"));

    if (!href || fighterLinks.some((fighter) => fighter.link === href)) {
      return;
    }

    const name = normalizeText($fight.find(el).text());

    if (!name) {
      return;
    }

    fighterLinks.push({ name, link: href });
  });

  if (fighterLinks.length < 2) {
    return null;
  }

  return buildFight(fighterLinks, cardMetadata);
}

function parseFightCollection($, selector, cardMetadata) {
  const fights = [];

  $(selector).each((index, el) => {
    const fight = parseFight($(el), cardMetadata);
    if (fight) fights.push(fight);
  });

  return fights;
}

function parseLiveEventFighter(fighter = {}) {
  const fullName = normalizeText(
    [fighter.Name?.FirstName, fighter.Name?.LastName].filter(Boolean).join(" ")
  );
  const link = toAbsoluteUrl(fighter.UFCLink || "");

  if (!fullName || !link) {
    return null;
  }

  return {
    name: fullName,
    link,
  };
}

function parseLiveEventFight(fight = {}) {
  const fighters = Array.isArray(fight.Fighters)
    ? [...fight.Fighters]
        .sort((left, right) => {
          const cornerOrder = {
            Red: 0,
            Blue: 1,
          };

          return (cornerOrder[left?.Corner] ?? 99) - (cornerOrder[right?.Corner] ?? 99);
        })
        .map((fighter) => parseLiveEventFighter(fighter))
        .filter(Boolean)
    : [];

  return buildFight(fighters, { sourceCardSegment: fight.CardSegment });
}

function getCardSegmentStartIso(fightCard = [], sourceCardSegment) {
  const fight = fightCard.find(
    (fightCardEntry) =>
      normalizeSourceCardSegment(fightCardEntry?.CardSegment) === sourceCardSegment
  );

  return toIsoString(fight?.CardSegmentStartTime || "");
}

function parseLiveEventFightCard(payload = {}) {
  const fightCard = Array.isArray(payload.LiveEventDetail?.FightCard)
    ? [...payload.LiveEventDetail.FightCard].sort(
        (left, right) => (left?.FightOrder ?? Number.MAX_SAFE_INTEGER) - (right?.FightOrder ?? Number.MAX_SAFE_INTEGER)
      )
    : [];

  const fights = fightCard.map((fight) => parseLiveEventFight(fight)).filter(Boolean);

  return {
    fights,
    mainCardStartIso: getCardSegmentStartIso(fightCard, mainCardSourceSegment) || "",
    prelimsStartIso: getCardSegmentStartIso(fightCard, prelimsSourceSegment) || "",
    earlyPrelimsStartIso:
      getCardSegmentStartIso(fightCard, earlyPrelimsSourceSegment) || "",
  };
}

function getFightLinkMatchKey(fight = {}) {
  const links = [fight.fighter1?.link || "", fight.fighter2?.link || ""]
    .filter(Boolean)
    .map((link) => link.replace(/\/+$/, "").toLowerCase())
    .sort();

  return links.length === 2 ? links.join("|") : "";
}

function getFightNameMatchKey(fight = {}) {
  const names = [fight.fighter1?.name || "", fight.fighter2?.name || ""]
    .map((name) => normalizeMatchText(name))
    .filter(Boolean)
    .sort();

  return names.length === 2 ? names.join("|") : "";
}

function getFightMatchKeys(fight = {}) {
  return [getFightLinkMatchKey(fight), getFightNameMatchKey(fight)].filter(Boolean);
}

function createFightLookup(fights = []) {
  const lookup = new Map();

  fights.forEach((fight) => {
    getFightMatchKeys(fight).forEach((key) => {
      if (!lookup.has(key)) {
        lookup.set(key, fight);
      }
    });
  });

  return lookup;
}

function mergeFightMetadata(baseFight = {}, metadataFight = null) {
  if (!metadataFight) {
    return baseFight;
  }

  return {
    ...baseFight,
    cardSection: baseFight.cardSection ?? metadataFight.cardSection,
    sourceCardSegment: baseFight.sourceCardSegment ?? metadataFight.sourceCardSegment,
  };
}

function mergeHtmlOrderedFightsWithLiveEventFights(htmlFights = [], liveEventFights = []) {
  const liveEventFightLookup = createFightLookup(liveEventFights);

  return htmlFights.map((fight) => {
    const matchedLiveEventFight = getFightMatchKeys(fight)
      .map((key) => liveEventFightLookup.get(key))
      .find(Boolean);

    return mergeFightMetadata(fight, matchedLiveEventFight);
  });
}

function parseFlatHtmlEventFights($) {
  const fights = parseFightCollection($, ".view-event-fights .c-listing-fight", {});

  if (!fights.length) {
    return null;
  }

  return {
    fights,
    mainCardStartIso: "",
    prelimsStartIso: "",
    earlyPrelimsStartIso: "",
  };
}

function inferMissingCardSections(link, fights = []) {
  const inferredFights = inferCardBreakdown(link, fights);

  return fights.map((fight, index) => {
    if (fight.cardSection) {
      return fight;
    }

    return inferredFights[index];
  });
}

function inferCardBreakdown(link, fights) {
  if (!fights.length) {
    return fights;
  }

  const inferredMainCardCount = /\/event\/ufc-\d+/i.test(link) ? 5 : fights.length;

  return fights.map((fight, index) => ({
    ...fight,
    cardSection: index < inferredMainCardCount ? mainCardSection : prelimsSection,
    sourceCardSegment: fight.sourceCardSegment ?? null,
  }));
}

function getLiveEventId($) {
  const eventId = normalizeText($("#c-listing-ticker").first().attr("data-fmid") || "");
  return /^\d+$/.test(eventId) ? eventId : "";
}

function parseSegmentedHtmlEventFights($) {
  const mainCardFights = parseFightCollection($, ".main-card .c-listing-fight", {
    cardSection: mainCardSection,
    sourceCardSegment: mainCardSourceSegment,
  });
  const prelimFights = parseFightCollection(
    $,
    ".fight-card-prelims .c-listing-fight",
    {
      cardSection: prelimsSection,
      sourceCardSegment: prelimsSourceSegment,
    }
  );
  const earlyPrelimFights = parseFightCollection(
    $,
    ".fight-card-prelims-early .c-listing-fight",
    {
      cardSection: earlyPrelimsSection,
      sourceCardSegment: earlyPrelimsSourceSegment,
    }
  );

  if (mainCardFights.length || prelimFights.length || earlyPrelimFights.length) {
    return {
      fights: [...mainCardFights, ...prelimFights, ...earlyPrelimFights],
      mainCardStartIso: "",
      prelimsStartIso: "",
      earlyPrelimsStartIso: "",
    };
  }

  return null;
}

async function parseEventFights($, link) {
  const segmentedHtmlEventFights = parseSegmentedHtmlEventFights($);
  const flatHtmlEventFights = parseFlatHtmlEventFights($);
  const liveEventId = getLiveEventId($);

  if (liveEventId) {
    try {
      const liveEventPayload = await fetchJson(`${liveEventApiBaseUrl}/${liveEventId}.json`);
      const liveEventFightCard = parseLiveEventFightCard(liveEventPayload);

      if (liveEventFightCard.fights.length) {
        if (segmentedHtmlEventFights?.fights.length) {
          return {
            ...liveEventFightCard,
            fights: mergeHtmlOrderedFightsWithLiveEventFights(
              segmentedHtmlEventFights.fights,
              liveEventFightCard.fights
            ),
          };
        }

        if (flatHtmlEventFights?.fights.length) {
          return {
            ...liveEventFightCard,
            fights: mergeHtmlOrderedFightsWithLiveEventFights(
              flatHtmlEventFights.fights,
              liveEventFightCard.fights
            ),
          };
        }

        return {
          ...liveEventFightCard,
          fights: liveEventFightCard.fights,
        };
      }
    } catch (error) {
      console.warn(
        `failed to load live event fight card for ${link}; eventId=${liveEventId}; ${error.message}`
      );
    }
  }

  if (segmentedHtmlEventFights) {
    return segmentedHtmlEventFights;
  }

  if (flatHtmlEventFights) {
    return {
      ...flatHtmlEventFights,
      fights: inferMissingCardSections(link, flatHtmlEventFights.fights),
    };
  }

  const fallbackFights = parseFightCollection($, ".view-event-fights .c-listing-fight", {});
  return {
    fights: inferCardBreakdown(link, fallbackFights),
    mainCardStartIso: "",
    prelimsStartIso: "",
    earlyPrelimsStartIso: "",
  };
}

async function scrapeEvent(url, locationDetails = {}) {
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);

  const promotion = normalizeText($(".field--name-node-title").first().text());
  const headline = normalizeText($(".c-hero__headline").first().text());
  const { mainCard, prelims, earlyPrelims } = getEventTimes($);
  const venueText = $(".hero-fixed-bar__place").first().text();
  const parsedLocation = parseLocation(venueText);
  const venue = locationDetails.venue || parsedLocation.venue;
  const city = locationDetails.city || parsedLocation.city;
  const state = locationDetails.state || "";
  const country = locationDetails.country || parsedLocation.country;

  const title =
    promotion && headline ? `${promotion}: ${headline}` : promotion || headline;
  const parsedEventFights = await parseEventFights($, url);

  return {
    title,
    mainCardStartIso: parsedEventFights.mainCardStartIso || mainCard.iso,
    prelimsStartIso: parsedEventFights.prelimsStartIso || prelims.iso,
    earlyPrelimsStartIso:
      parsedEventFights.earlyPrelimsStartIso || earlyPrelims.iso,
    link: url,
    venue,
    city,
    state,
    country,
    fights: parsedEventFights.fights,
  };
}

function extractUpcomingEvents($) {
  const events = [];

  $("#events-list-upcoming .c-card-event--result").each((index, el) => {
    const card = $(el);
    const relativeUrl = card.find('a[href*="/event/"]').first().attr("href");
    const link = toAbsoluteUrl(relativeUrl);
    const venue = normalizeText(
      card.find(".field--name-taxonomy-term-title").first().text()
    );
    const city = normalizeText(card.find(".field--name-location .locality").first().text());
    const state = normalizeText(
      card.find(".field--name-location .administrative-area").first().text()
    );
    const country = normalizeText(
      card.find(".field--name-location .country").first().text()
    );

    if (!link || events.some((event) => event.link === link)) {
      return;
    }

    events.push({
      link,
      venue,
      city,
      state,
      country,
    });
  });

  return events;
}

async function scrape() {
  const eventsFromListing = [];
  let page = 0;

  while (true) {
    const url = page === 0 ? `${baseUrl}/events` : `${baseUrl}/events?page=${page}`;
    const text = await fetchHtml(url);
    const $ = cheerio.load(text);
    const pageEvents = extractUpcomingEvents($);
    const newEvents = pageEvents.filter(
      (event) => !eventsFromListing.some((existingEvent) => existingEvent.link === event.link)
    );

    if (!newEvents.length) {
      const title = normalizeText($("title").first().text());
      const bodySnippet = getHtmlSnippet($("body").text() || text);

      if (!eventsFromListing.length) {
        throw new Error(
          `no UFC events found on listing page; url=${url}; title="${title}"; snippet="${bodySnippet}"`
        );
      }

      break;
    }

    eventsFromListing.push(...newEvents);

    const hasMorePages = $("#events-list-upcoming .pager a[rel='next']").length > 0;

    if (!hasMorePages) {
      break;
    }

    page += 1;
  }

  const events = [];

  for (const listingEvent of eventsFromListing) {
    const event = await scrapeEvent(listingEvent.link, listingEvent);
    events.push(event);
  }

  if (!events.length) {
    throw new Error("event scrape produced no data");
  }

  return { data: events };
}

module.exports = scrape;
