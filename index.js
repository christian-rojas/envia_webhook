const express = require("express");
const crypto = require("crypto");
const bodyParser = require("body-parser");
// import fetch from "node-fetch";
const fetch = (...args) => import("node-fetch").then(({ default: fetch }) => fetch(...args));
const { sendOrderConfirmationEmail } = require("./utils.js");

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
  return crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(calculatedHmac));
}

// Búsqueda de API de Código Postal para Chile

// Función para obtener código postal por comuna
async function getPostalCodeByCommune(address, commune) {
  try {
    //cortar string en 2 discriminando string y numero
    const addressArray = address.split(" ");
    const number = addressArray.pop();
    const street = addressArray.join(" ");
    console.log("street", street);
    console.log("number", number);
    const response = await fetch(
      `https://postal-code-api.kainext.cl/v1/postal-codes/search?commune=${commune}&street=${street}&number=${number}`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
    const data = await response.json();
    console.log(data);
    return data.postalCode || null; // Código postal por defecto si no se encuentra
  } catch (error) {
    console.error("Error obteniendo código postal:", error);
    return null; // Código postal por defecto en caso de error
  }
}

// Format order for Envia API
async function formatEnviaShipment(order) {
  // Obtener la comuna desde la dirección de envío
  const commune = order.shipping_address.city;

  // Get postal code asynchronously if needed
  let postalCode = order.shipping_address.zip;
  if (!postalCode) {
    postalCode = (await getPostalCodeByCommune(order.shipping_address.address1, commune)) || null;
  }

  const dimension = {
    length: 30,
    width: 30,
    height: 5,
  };
  const weight = 1;

  if (order.line_items.length > 1) {
    dimension.height = 10;
    weight = 1.5;
  }
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
      postalCode: "2920000",
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
      postalCode: postalCode,
      number: order.shipping_address.number || "000001",
    },
    packages: [
      {
        content: "MON" + JSON.stringify(order.order_number),
        amount: order.line_items.length,
        type: "envelope",
        dimensions: dimension,
        weight: weight,
        insurance: 0,
        declaredValue: 60000,
        weightUnit: "KG",
        lengthUnit: "CM",
      },
    ],
    settings: {
      printFormat: "PDF",
      printSize: "STOCK_4X6",
      labelFormat: "PDF",
      comments: "MON2010",
    },
    shipment: {
      carrier: "chilexpress",
      service: "express",
      type: 1,
    },
  };
}

// Create shipment in Envia
async function createEnviaShipment(shipment) {
  console.log("entra en el fetch");
  try {
    const response = await fetch("https://api.envia.com/ship/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ENVIA_API_KEY}`,
      },
      body: JSON.stringify(shipment),
    });
    console.log("termino el fetch");
    return await response;
  } catch (error) {
    console.log("error final", error);
  }
}

// Webhook handler
app.post("/webhook/shopify", async (req, res) => {
  if (!validateShopifyHmac(req)) {
    return res.status(401).send("Invalid HMAC");
  }

  const order = req.body;
  console.log(JSON.stringify(order, null, 2));

  try {
    // Now we need to await the formatEnviaShipment function
    const shipment = await formatEnviaShipment(order);
    console.log("el shipment", JSON.stringify(shipment));

    console.log("after shipment");
    // Send to Envia API
    const response = await createEnviaShipment(shipment);
    const data = await response.json();
    console.log(data);
    if (data.meta === "generate") {
      if (data.data[0].currentBalance < 20000) {
        try {
          await sendOrderConfirmationEmail(shipment.packages[0].content, data.data[0].currentBalance);
        } catch (emailError) {
          console.error("Error sending email:", emailError);
        }
      }
    }
    if (data.error) {
      console.error("Error creating shipment:", data.error?.message);
      try {
        await sendOrderConfirmationEmail(shipment.packages[0].content, data.error?.message ?? "error");
      } catch (emailError) {
        console.error("Error sending email:", emailError);
      }
      return res.status(500).send("Error creating shipment");
    }
    res.status(200).send("Shipment created");
  } catch (error) {
    console.log("error", error);
    res.status(500).send("Error creating shipment");
  }
});

module.exports = app;
