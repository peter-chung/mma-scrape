var axios = require("axios").default;

require("dotenv").config();

var options = {
  method: "POST",
  url: "https://mma-events-api.vercel.app/scrape",
  headers: {
    "Content-Type": "application/json",
    "User-Agent": "insomnia/8.4.5",
  },
  data: { key: process.env.SCRAPER_KEY },
};

axios
  .request(options)
  .then(function (response) {
    console.log(response.data);
  })
  .catch(function (error) {
    console.error(error);
  });
