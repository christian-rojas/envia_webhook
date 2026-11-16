const dotenv = require("dotenv");
const { Client } = require("@googlemaps/google-maps-services-js");
dotenv.config();

// Nota: ya no se manda ningun email desde el webhook (ni de error ni de
// saldo bajo), asi que se elimino el transporter de nodemailer/Zoho que
// vivia en este archivo.

const client = new Client({});

async function reverseGeocode(lat, lng) {
  try {
    const response = await client.reverseGeocode({
      params: {
        latlng: { latitude: lat, longitude: lng },
        key: process.env.PLACES_API, // Make sure to replace this with your actual API key
      },
      timeout: 1000, // milliseconds
    });

    if (response.data.results && response.data.results.length > 0) {
      console.log("Reverse Geocoding Results:", response.data.results[0].formatted_address);
      return response.data.results[0].formatted_address;
    } else {
      console.log("No results found for the given coordinates.");
      return null;
    }
  } catch (e) {
    console.error("Error during reverse geocoding:", e.response ? e.response.data.error_message : e.message);
    return null;
  }
}

module.exports = {
  reverseGeocode,
};
