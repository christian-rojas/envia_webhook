const express = require("express");
const crypto = require("crypto");
const bodyParser = require("body-parser");

const app = express();
// Use raw body parser for webhook validation
app.use(
  bodyParser.json({
    verify: (req, res, buf) => {
      req.rawBody = buf.toString();
    },
  })
);

const SHOPIFY_SECRET = process.env.SHOPIFY_SECRET;
const ENVIA_API_KEY = process.env.ENVIA_API_KEY;

// Validate Shopify HMAC
// function validateShopifyHmac(req) {
//   const hmac = req.get("X-Shopify-Hmac-Sha256");
//   const body = req.rawBody; // Use raw body instead of JSON.stringify

//   // const calculatedHmac = crypto.createHmac("sha256", SHOPIFY_SECRET).update(body, "utf8").digest("base64");
//   console.log("Calculated HMAC:", calculatedHmac);
//   console.log("Received HMAC:", hmac);
//   return hmac === calculatedHmac;
// }

function validateShopifyHmac(req) {
  const hmac = req.get("X-Shopify-Hmac-Sha256");
  const body = req.rawBody;
  console.log(SHOPIFY_SECRET);
  console.log(hmac);
  const generatedHmac = crypto.createHmac("sha256", SHOPIFY_SECRET).update(body, "utf8").digest("hex");
}

// Webhook handler
app.post("/webhook/shopify", (req, res) => {
  console.log("holi");
  console.log(req);
  if (!validateShopifyHmac(req)) {
    return res.status(401).send("Invalid HMAC");
  }

  const order = req.body;
  const shipment = formatEnviaShipment(order);

  console.log("casi");

  // Send to Envia API
  createEnviaShipment(shipment)
    .then((response) => res.status(200).send(response))
    .catch((error) => res.status(500).send(error));
});

// Format order for Envia API
function formatEnviaShipment(order) {
  return {
    origin: {
      // Your warehouse details
    },
    destination: {
      name: order.customer.first_name + " " + order.customer.last_name,
      phone: order.customer.phone,
      email: order.customer.email,
      street: order.shipping_address.address1,
      city: order.shipping_address.city,
      state: order.shipping_address.province_code,
      country: order.shipping_address.country_code,
      postalCode: order.shipping_address.zip,
    },
    packages: order.line_items.map((item) => ({
      weight: item.grams / 1000,
      height: 10,
      width: 10,
      length: 10,
      type: "box",
    })),
    carrier: "DHL",
  };
}

// Create shipment in Envia
async function createEnviaShipment(shipment) {
  const response = await fetch("https://api.envia.com/shipments", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ENVIA_API_KEY}`,
    },
    body: JSON.stringify(shipment),
  });
  return response.json();
}

module.exports = app;
