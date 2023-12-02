// import * as cheerio from "cheerio";
const cheerio = require("cheerio");

// const fs = require("fs");

async function mmaEventScrape() {
  const baseUrl = "https://www.tapology.com";

  // fetch page from url
  const response = await fetch(`${baseUrl}/fightcenter?group=ufc`);
  // convert response into text
  const text = await response.text();
  // load body data
  const $ = cheerio.load(text);

  // store events in array of objects
  let events = $(".left")
    .map((index, el) => {
      const title = $(el).find(".name").text().trim();
      const dateTime = $(el).find(".datetime").text().trim();
      const link = baseUrl + $(el).find(".name a").attr("href");

      // ***BUG 1st index of map is undefined
      if (title || dateTime) return { title, dateTime, link };
    })
    .get()
    .slice(0, 1); // keep only 2 results....

  // loop through array of events
  for (const event of events) {
    const eventResponse = await fetch(event.link);
    const eventText = await eventResponse.text();
    const $event = cheerio.load(eventText);

    // get fights in events
    const fights = $event("li.fightCard:not(.picks)")
      .map((index, el) => {
        const isMainCard = $(el)
          .find(".billing")
          .text()
          .trim()
          .toLowerCase()
          .includes("main");

        const fighter1 = {
          name: $(el).find(".fightCardFighterName.left a").text().trim(),
          link:
            baseUrl + $(el).find(".fightCardFighterName.left a").attr("href"),
        };

        const fighter2 = {
          name: $(el).find(".fightCardFighterName.right a").text().trim(),
          link:
            baseUrl + $(el).find(".fightCardFighterName.right a").attr("href"),
        };

        return { isMainCard, fighter1, fighter2 };
      })
      .get();

    //add fight to event
    event.fights = fights;
  }

  return { data: events };

  // save data to JSON file
  // fs.writeFile("events.json", JSON.stringify(events), (err) => {
  //   if (err) throw err;
  //   console.log("FILE SAVED");
  // });
}

// mmaEventScrape();
module.exports = mmaEventScrape;
