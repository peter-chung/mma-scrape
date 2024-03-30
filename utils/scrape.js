const cheerio = require("cheerio");

async function scrape() {
  const baseUrl = "https://www.tapology.com";

  // fetch page from url
  const response = await fetch(`${baseUrl}/fightcenter?group=ufc`);

  // convert response into text
  const text = await response.text();

  // load body data
  const $ = cheerio.load(text);

  // store events in array of objects
  let events = $(".text-left")
    .map((index, el) => {
      const title = $(el).find("span:nth-child(1) a").text().trim();
      const dateTime = $(el).find(".promotion span:nth-child(3)").text().trim();
      const link = baseUrl + $(el).find(".promotion span a").attr("href");
      // ***BUG 1st index of map is undefined
      if (title || dateTime) return { title, dateTime, link };
    })
    .get();
  // keep only 1 results....
  // .slice(0, 1);

  // loop through array of events
  for (const event of events) {
    const eventResponse = await fetch(event.link);
    const eventText = await eventResponse.text();
    const $event = cheerio.load(eventText);

    // get fights in events
    const fights = $event("#sectionFightCard li")
      .map((index, el) => {
        const isMainCard = $(el)
          .find("span")
          .text()
          .trim()
          .toLowerCase()
          .includes("main");

        const fighter1 = {
          name: $(el).find("[id$=_leftBio] a.link-primary-red").text().trim(),
          link:
            baseUrl +
            $(el).find("[id$=_leftBio] a.link-primary-red").attr("href"),
        };

        const fighter2 = {
          name: $(el).find("[id$=_rightBio] a.link-primary-red").text().trim(),
          link:
            baseUrl +
            $(el).find("[id$=_rightBio] a.link-primary-red").attr("href"),
        };

        return { isMainCard, fighter1, fighter2 };
      })
      .get();

    //add fight to event
    event.fights = fights;
  }

  return { data: events };
}

module.exports = scrape;
