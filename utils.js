// Add this near the top of your file, after the other requires
const nodemailer = require("nodemailer");
const dotenv = require("dotenv");
const { Client } = require("@googlemaps/google-maps-services-js");
dotenv.config();

// Add these constants with your other environment variables
const ZOHO_EMAIL = process.env.ZOHO_EMAIL;
const ZOHO_PASSWORD = process.env.ZOHO_PASSWORD;

// Create the transporter
// Tiempos de conexion explicitos: sin ellos, nodemailer puede quedarse
// esperando minutos a smtp.zoho.com. Ese await estaba en el camino CRITICO
// del webhook de Shopify, asi que un SMTP lento colgaba la request entera
// (y Shopify la reintentaba, generando envios duplicados).
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.zoho.com",
  port: Number(process.env.SMTP_PORT || 465),
  secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE !== "false" : true,
  auth: {
    user: ZOHO_EMAIL,
    pass: ZOHO_PASSWORD,
  },
  connectionTimeout: Number(process.env.SMTP_CONNECTION_TIMEOUT_MS || 10000),
  greetingTimeout: Number(process.env.SMTP_GREETING_TIMEOUT_MS || 10000),
  socketTimeout: Number(process.env.SMTP_SOCKET_TIMEOUT_MS || 20000),
});

// Add this function to send emails
async function sendOrderConfirmationEmail(order, data) {
  try {
    const mailOptions = {
      from: ZOHO_EMAIL,
      to: "christian.ici17@gmail.com",
      subject: `creacion de envio fallo - Order #${order}`,
      html: `
        <h1>${data}</h1>
      `,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log("Email sent successfully:", info.messageId);
    return info;
  } catch (error) {
    console.error("Error sending email:", error);
    throw error;
  }
}

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
  sendOrderConfirmationEmail,
  reverseGeocode,
};

const order = {
  order_number: "123456",
  customer: {
    first_name: "John",
    email: "christian.ici17@gmail.com",
  },
};

const trackingInfo = {
  tracking_number: "ABC123456789",
};

// call sendOrderConfirmationEmail
// sendOrderConfirmationEmail(order, trackingInfo)
//   .then(() => {
//     console.log("Email sent successfully");
//   })
//   .catch((error) => {
//     console.error("Error sending email:", error);
//   });
