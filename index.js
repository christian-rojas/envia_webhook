const express = require("express");
const crypto = require("crypto");
const bodyParser = require("body-parser");
const cors = require("cors");
const twilio = require("twilio");
// import fetch from "node-fetch";
const fetch = (...args) => import("node-fetch").then(({ default: fetch }) => fetch(...args));
const { sendOrderConfirmationEmail, reverseGeocode } = require("./utils.js");
const { createClient } = require("@supabase/supabase-js");
const dotenv = require("dotenv");
const { saveShipmentData, saveShipmentDataWithEnvia } = require("./supa.js");
dotenv.config();

const { injectSpeedInsights } = require("@vercel/speed-insights");
injectSpeedInsights();
const { inject } = require("@vercel/analytics");
inject();

// Permitir todas las solicitudes (modo abierto)

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

const app = express();
// app.use(express.json());
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
// // Manejar preflight requests (OPTIONS)

// app.use(cors(corsHeaders));
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
// app.options("*", cors(corsHeaders));
// Middleware para manejar las solicitudes OPTIONS
app.use((req, res, next) => {
  if (req.method === "OPTIONS") {
    res.set(corsHeaders);
    return res.status(204).send("");
  }
  next();
});
// Servir archivos estáticos como proxy.html
// Use raw body parser for webhook validation
app.use(
  bodyParser.json({
    verify: (req, res, buf) => {
      req.rawBody = buf ? buf.toString() : "";
    },
  })
);

// app use public images folder
// app.use("/images", express.static("public/images"));
// app use public folder

const SHOPIFY_SECRET = process.env.SHOPIFY_SECRET;
const ENVIA_API_KEY = process.env.ENVIA_API_KEY;

// Validate Shopify HMAC
function validateShopifyHmac(req) {
  const hmac = req.headers["x-shopify-hmac-sha256"];
  if (!req.rawBody) return false; // Prevents undefined error

  const calculatedHmac = crypto.createHmac("sha256", SHOPIFY_SECRET).update(req.rawBody).digest("base64");
  return crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(calculatedHmac));
}

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
  let address = order.shipping_address.address1;
  // add google geocoding API to get the address

  if (address.includes("#")) {
    address = address.split("#")[0] + address.split("#")[1];
  }
  if (!postalCode) {
    postalCode = (await getPostalCodeByCommune(address, commune)) || null;
    if (!postalCode) {
      reverseGeocode(order.shipping_address.latitude, order.shipping_address.longitude)
        .then((data) => {
          if (data && data.length > 0) {
            const zipCode = data[0].address_components.find((component) => component.types.includes("postal_code"));
            order.shipping_address.zip = zipCode.short_name;
            postalCode = zipCode.short_name;
          }
        })
        .catch((error) => {
          console.error("Error in reverse geocoding:", error);
        });
    }
  }

  let dimension = {
    length: 30,
    width: 30,
    height: 5,
  };
  let weight = 1;
  let quantityPackages = 1;

  if (order.line_items.length > 3) {
    dimension.height = 10;
    weight = 1.5;
    quantityPackages = 2;
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
      street:
        order.shipping_address.address1 +
        (order.shipping_address.address2 ? " depto " + order.shipping_address.address2 : ""),
      city: order.shipping_address.city,
      state: order.shipping_address.province_code,
      country: order.shipping_address.country_code,
      postalCode: postalCode,
      number: order.shipping_address.number || "000001",
    },
    packages: [
      {
        content: "MON" + JSON.stringify(order.order_number),
        amount: quantityPackages,
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
  const { data, error } = await supabase.from("shipments").select("shopify_order_id").eq("status", "generated");
  if (data.length > 0) {
    const found = data.filter((item) => {
      console.log("item", item.shopify_order_id);
      console.log("shipment", shipment.packages[0].content);
      if (item.shopify_order_id === shipment.packages[0].content) {
        console.log("Ya existe un envío con este ID de pedido");
        // throw new Error("Shipment already exists for this order ID");
        return true;
      }
      return false;
    });
    if (found.length > 0) {
      return {
        error: {
          message: "Ya existe un envío con este ID de pedido",
        },
      };
    }
  }
  console.log("found false");

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
    return await response.json();
  } catch (error) {
    console.log("error final", error);
  }
}

async function sendMessage(order) {
  //   const order = req.body;
  const customerName = order.customer.first_name;
  let phone = order.shipping_address.phone;
  phone = phone.replace(/\s+/g, ""); // Remove all spaces from the phone number

  console.log("phone", phone);

  // check if the phone variable has prefix == +56 if not add it
  if (!phone.startsWith("+56")) {
    phone = "+56" + phone;
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const client = twilio(accountSid, authToken);

  console.log("Enviando mensaje a:", customerName, order.order_number);

  const whatsappTemplate = process.env.WHATSAPP_TEMPLATE_SID; // Add this to your .env file
  console.log("whatsappTemplate", whatsappTemplate);

  const message = await client.messages.create({
    contentSid: whatsappTemplate, // Add this to your .env file
    contentVariables: JSON.stringify({
      1: customerName,
      2: order.order_number,
    }),
    to: `whatsapp:${phone}`,
    from: "whatsapp:+15557634616",
  });
  return message;
}

// Webhook handler
app.post("/webhook/shopify", async (req, res) => {
  if (!validateShopifyHmac(req)) {
    return res.status(401).send("Invalid HMAC");
  }

  const order = req.body;
  console.log(JSON.stringify(order, null, 2));

  try {
    await sendMessage(order);
    console.log(JSON.stringify("Mensaje enviado exitosamente"));
  } catch (error) {
    console.error("error on sending message by twillio:", error);
  }

  try {
    // Now we need to await the formatEnviaShipment function
    const shipment = await formatEnviaShipment(order);
    console.log("el shipment", JSON.stringify(shipment));

    console.log("after shipment");
    // Send to Envia API
    const response = await createEnviaShipment(shipment);

    if (response.error) {
      res.status(500).send(response.error.message);
    }

    const data = response;
    console.log(data);
    if (data.meta === "generate") {
      try {
        await saveShipmentData(order, shipment, data);
      } catch (error) {
        console.error("Error saving to Supabase:", error);
      }

      if (data.data[0].currentBalance < 20000) {
        try {
          await sendOrderConfirmationEmail(shipment.packages[0].content, data.data[0].currentBalance);
        } catch (emailError) {
          console.error("Error sending email:", emailError);
        }
      }
      reverseGeocode(order.shipping_address.latitude, order.shipping_address.longitude)
        .then((data) => {
          if (data && data.length > 0) {
            const addressGeo = data.split(",")[0];
            const zipGeo = data.split(",")[1];
            order.shipping_address.zip = zipGeo;
            order.shipping_address.address1 = addressGeo;
            saveShipmentDataWithEnvia(order);
          }
        })
        .catch((error) => {
          console.error("Error in reverse geocoding:", error);
        });
      res.status(200).send("Shipment created");
    }
    if (data.error) {
      console.error("Error creating shipment:", data.error?.message);
      try {
        await sendOrderConfirmationEmail(shipment.packages[0].content, data.error?.message ?? "error");
        shipment.shipment.service = "extended";
        const responseExtended = await createEnviaShipment(shipment);
        if (responseExtended.meta === "generate") {
          try {
            await saveShipmentData(order, shipment, responseExtended);
          } catch (error) {
            console.error("Error saving to Supabase:", error);
          }
          res.status(200).send("Shipment created");
        } else {
          res.status(500).send("Error creating shipment");
        }
      } catch (emailError) {
        console.error("Error sending email:", emailError);
      }
    }
  } catch (error) {
    console.log("error final", error);
    res.status(500).send("Error creating shipment");
  }
});

app.get("/tracking/:order_id", async (req, res) => {
  const order_id = req.params.order_id;
  console.log("order_id del tracking", order_id);

  try {
    const { data, error } = await supabase.from("order_tracking").select("tracking_id").eq("order_id", order_id);
    if (error) {
      console.error(error);
      res.status(500).send("No se encontró el número de seguimiento");
    } else {
      res.status(200).send(data);
    }
  } catch (error) {
    console.error(error);
    res.status(500).send("Ocurrió un error al procesar la solicitud");
  }
});

app.get("/envia/:tracking_id", async (req, res) => {
  const tracking_id = req.params.tracking_id;
  console.log("tracking_id del envia", tracking_id);

  try {
    const response = await fetch(`https://api.envia.com/ship/generaltrack`, {
      method: "POST",
      body: JSON.stringify({ trackingNumbers: [tracking_id] }),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ENVIA_API_KEY}`,
      },
    });

    const data = await response.json();
    console.log("data envia", data);
    if (data.error) {
      console.error(data.error);
      res.status(500).send("No se encontró el número de seguimiento");
    } else {
      res.status(200).send(data);
    }
  } catch (error) {
    console.error(error);
    res.status(500).send("Ocurrió un error al procesar la solicitud");
  }
});

// app.get("/", async (req, res) => {
//   // render public/index.html
//   res.sendFile(__dirname + "/public/index.html");

//   // res.send("Envia API is running");
// });

// Start the server
/*const PORT = process.env.PORT || 3000;
app.listen(PORT, (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders,
    });
  }
  console.log(`Server is running on port ${PORT}`);
});*/

module.exports = app;
