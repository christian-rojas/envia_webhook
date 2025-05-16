const express = require("express");
const crypto = require("crypto");
const bodyParser = require("body-parser");
// import fetch from "node-fetch";
const fetch = (...args) => import("node-fetch").then(({ default: fetch }) => fetch(...args));

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
function validateShopifyHmac(req) {
  const hmac = req.headers["x-shopify-hmac-sha256"];

  const calculatedHmac = crypto.createHmac("sha256", SHOPIFY_SECRET).update(req.rawBody).digest("base64");
  console.log("Calculated HMAC:", calculatedHmac);
  console.log("Received HMAC:", hmac);
  return crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(calculatedHmac));
}

// Format order for Envia API
function formatEnviaShipment(order) {
  return {
    origin: {
      address_id: 1587507,
      type: "origin",
      name: "Mondano Limitada",
      company: "Diseñadora y Comercializadora Mondano Limitada",
      email: "contacto@mondano.cl",
      phone: "986891362",
      phone_code: "CL",
      street: "Lote 2, La Isla sin número, Olivar",
      number: "000000",
      district: "Cachapoal",
      interior_number: null,
      city: "Olivar",
      state: "LI",
      country: "CL",
      postal_code: "",
      identification_number: "76.915.142-7",
      reference: "",
      latitude: null,
      longitude: null,
      state_registration: null,
      return_address: 0,
      description: "Residential",
      branches: [],
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
      weight: 750,
      height: 10,
      width: 30,
      length: 30,
      type: "box",
    })),
  };
}

// Create shipment in Envia
async function createEnviaShipment(shipment) {
  console.log("entra en el fetch");
  try {
    const response = await fetch("https://ship-test.envia.com/ship/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ENVIA_API_KEY}`,
      },
      body: JSON.stringify(shipment),
    });
    console.log("termino el fetch");
    console.log(await response.json());
    return response;
  } catch (error) {
    console.log("error final", error);
  }
}

// Webhook handler
app.post("/webhook/shopify", (req, res) => {
  console.log("holi");
  if (!validateShopifyHmac(req)) {
    return res.status(401).send("Invalid HMAC");
  }

  const order = req.body;
  const shipment = formatEnviaShipment(order);

  console.log("casi");
  console.log(shipment);
  console.log("after shipment");
  // Send to Envia API
  try {
    createEnviaShipment(shipment)
      .then((response) => res.status(200).send(response))
      .catch((error) => res.status(500).send(error));
  } catch (error) {
    console.log("error", error);
    res.status(500).send("Error creating shipment");
  }
});

module.exports = app;
