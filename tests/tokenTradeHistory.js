// save as testTradeHistory.js
const axios = require('axios')

async function run() {
  const url = "http://localhost:3000/tl_tokenTradeHistoryForAddress";

  const params = {
    propertyId1: 0,
    propertyId2: 1,
    address: "tltc1q89kkgaslk0lt8l90jkl3cgwg7dkkszn73u4d2t"
  };

  try {
    const res = await axios.get(url, { params });
    console.log("Response:", res.data);
  } catch (err) {
    console.error("Error calling API:");
    if (err.response) {
      console.error("Status:", err.response.status);
      console.error("Headers:", err.response.headers);
      console.error("Body:", err.response.data);
    }
    console.error("Stack trace:", err.stack);
  }
}

run();