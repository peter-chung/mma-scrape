# MMA Events API

MMA Events API scrapes ufc.com for UFC events along with the specific event information such as fights, venue, city, state, country, and start times. The API is intended to be used for a website to display this information in an easily digestible manner.

The API can be found at https://mma-events-api.vercel.app/events  
My accompanying website can be found at https://fyte-center.vercel.app/

## Technology

The following technologies are used:

- Cheerio - web scraping
- MongoDB - NoSQL data storage
- Mongoose - object data modeling
- Express - back-end framework

## Endpoint

#### /events

The /events endpoint contains an array of MMA events with examples of some of the data that could be found below:

- title
- mainCardStartIso
- prelimsStartIso
- earlyPrelimsStartIso
- venue
- city
- state
- country
- array of fights

Each fight may include:

- cardSection (`main`, `prelims`, `early_prelims`, or `null`)
- sourceCardSegment (raw source value such as `Main`, `Prelims1`, or `Prelims2`)
