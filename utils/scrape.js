const cheerio = require("cheerio");

const baseUrl = "https://www.ufc.com";
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
  return value.replace(/\s+/g, " ").trim();
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
  const viewingOptionMainCard = getViewingOptionTime($, "Main Card");
  const viewingOptionPrelims = getViewingOptionTime($, "Prelims");

  return {
    mainCard: viewingOptionMainCard.iso ? viewingOptionMainCard : legacyMainCard,
    prelims: viewingOptionPrelims.iso ? viewingOptionPrelims : legacyPrelims,
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

function toAbsoluteUrl(url = "") {
  if (!url) return "";
  if (url.startsWith("http")) return url;
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

function parseFight($fight, isMainCard) {
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

  return {
    isMainCard,
    fighter1: fighterLinks[0],
    fighter2: fighterLinks[1],
  };
}

function parseFightCollection($, selector, isMainCard) {
  const fights = [];

  $(selector).each((index, el) => {
    const fight = parseFight($(el), isMainCard);
    if (fight) fights.push(fight);
  });

  return fights;
}

function inferCardBreakdown(link, fights) {
  if (!fights.length) {
    return fights;
  }

  const inferredMainCardCount = /\/event\/ufc-\d+/i.test(link) ? 5 : fights.length;

  return fights.map((fight, index) => ({
    ...fight,
    isMainCard: index < inferredMainCardCount,
  }));
}

function parseEventFights($, link) {
  const mainCardFights = parseFightCollection($, ".main-card .c-listing-fight", true);
  const prelimFights = parseFightCollection(
    $,
    ".fight-card-prelims .c-listing-fight, .fight-card-early-prelims .c-listing-fight",
    false
  );

  if (mainCardFights.length || prelimFights.length) {
    return [...mainCardFights, ...prelimFights];
  }

  const fallbackFights = parseFightCollection($, ".view-event-fights .c-listing-fight", false);
  return inferCardBreakdown(link, fallbackFights);
}

async function scrapeEvent(url) {
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);

  const promotion = normalizeText($(".field--name-node-title").first().text());
  const headline = normalizeText($(".c-hero__headline").first().text());
  const { mainCard, prelims } = getEventTimes($);
  const venueText = $(".hero-fixed-bar__place").first().text();
  const { venue, city, country } = parseLocation(venueText);

  const title =
    promotion && headline ? `${promotion}: ${headline}` : promotion || headline;

  const fights = parseEventFights($, url);

  return {
    title,
    mainCardStartIso: mainCard.iso,
    prelimsStartIso: prelims.iso,
    link: url,
    venue,
    city,
    country,
    fights,
  };
}

function extractUpcomingEventLinks($) {
  const eventLinks = [];

  $("#events-list-upcoming .c-card-event--result").each((index, el) => {
    const card = $(el);
    const relativeUrl = card.find('a[href*="/event/"]').first().attr("href");
    const link = toAbsoluteUrl(relativeUrl);

    if (!link || eventLinks.includes(link)) {
      return;
    }

    eventLinks.push(link);
  });

  return eventLinks;
}

async function scrape() {
  const eventLinks = [];
  let page = 0;

  while (true) {
    const url = page === 0 ? `${baseUrl}/events` : `${baseUrl}/events?page=${page}`;
    const text = await fetchHtml(url);
    const $ = cheerio.load(text);
    const pageLinks = extractUpcomingEventLinks($);
    const newLinks = pageLinks.filter((link) => !eventLinks.includes(link));

    if (!newLinks.length) {
      const title = normalizeText($("title").first().text());
      const bodySnippet = getHtmlSnippet($("body").text() || text);

      if (!eventLinks.length) {
        throw new Error(
          `no UFC events found on listing page; url=${url}; title="${title}"; snippet="${bodySnippet}"`
        );
      }

      break;
    }

    eventLinks.push(...newLinks);

    const hasMorePages = $("#events-list-upcoming .pager a[rel='next']").length > 0;

    if (!hasMorePages) {
      break;
    }

    page += 1;
  }

  const events = [];

  for (const link of eventLinks) {
    const event = await scrapeEvent(link);
    events.push(event);
  }

  if (!events.length) {
    throw new Error("event scrape produced no data");
  }

  return { data: events };
}

module.exports = scrape;
