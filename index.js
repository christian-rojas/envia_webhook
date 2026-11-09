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
const meta = require("./meta.js");
const ai = require("./ai.js");
const orders = require("./orders.js");
const shopify = require("./shopify.js");
const conversation = require("./conversation.js");

// Palabras que delatan que una nota habla del proceso de fabricacion
// (corte, planchado, ensamblaje...).
const MANUFACTURING_KEYWORDS = (
  process.env.MANUFACTURING_KEYWORDS ||
  "taller,corte,elabora,planch,ensamblaj,costur,confecci,producc,tejid,serigraf,estampad,termin,listo,armado,montaje,acabado"
)
  .split(",")
  .map((k) => k.trim().toLowerCase())
  .filter(Boolean);

// Palabras que delatan una personalizacion del pedido (agregar gorro,
// cambiar color o forro, correccion de talla...). Son indicaciones de
// fabricacion que el cliente SI debe saber.
const CUSTOM_KEYWORDS = (
  process.env.CUSTOM_KEYWORDS ||
  "gorro,color,forro,talla,relleno,ribete,bolsillo,cierre,cremallera,personalizado,especial,bordado,estampa,serigraf"
)
  .split(",")
  .map((k) => k.trim().toLowerCase())
  .filter(Boolean);

/**
 * Indica si una nota interna es relevante para el cliente.
 *
 * Se filtran las notas operativas (cambios de pedido con ticket, notas de
 * conserjeria, reembolsos) porque son internas y no aportan nada.
 *
 * @param {string} nota Una linea de nota.
 * @returns {boolean}
 */
function isRelevantNote(nota) {
  if (!nota) return false;
  const lower = nota.toLowerCase();
  return (
    MANUFACTURING_KEYWORDS.some((k) => lower.includes(k)) ||
    CUSTOM_KEYWORDS.some((k) => lower.includes(k))
  );
}

/**
 * Filtra las notas internas dejando solo las que le interesan al cliente.
 *
 * @param {string} notes Notas unidas.
 * @returns {string[]} Lineas relevantes.
 */
function filterRelevantNotes(notes) {
  if (!notes) return [];
  return String(notes)
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s && isRelevantNote(s));
}

/**
 * Indica si unas notas internas hablan del proceso de manufactura.
 *
 * @param {string} notes Notas del pedido.
 * @returns {boolean}
 */
function looksLikeManufacturing(notes) {
  if (!notes) return false;
  const lower = notes.toLowerCase();
  return MANUFACTURING_KEYWORDS.some((k) => lower.includes(k));
}

/**
 * Devuelve las notas internas del pedido y si describen etapas de
 * manufactura.
 *
 * Se devuelve tambien cuando las notas NO hablan de manufactura: en ese
 * caso el bot simplemente dice que el pedido esta en confeccion.
 *
 * @param {object} resolved Resultado de resolveInstagramOrder.
 * @returns {Promise<{notes: string, processDetails: boolean}>}
 */
async function getManufacturingNotes(resolved) {
  const orderId = resolved.orderId;
  const vacio = { notes: "", processDetails: false };
  if (!orderId) return vacio;

  // Solo si el envio no fue retirado por la transportista: una vez que el
  // paquete salio, la fabricacion ya termino.
  if (!orders.isNotPickedUp(resolved.shipment)) return vacio;

  try {
    // Si ya se consulto Shopify, se reutiliza (evita una segunda llamada).
    const ctx = resolved.shopify || (await shopify.getOrderContext(orderId));

    if (!ctx.found) {
      console.log(
        `[shopify] pedido ${orderId} no encontrado (¿fuera de la ventana de 60 dias?)`
      );
      return vacio;
    }
    if (!ctx.notes) {
      console.log(`[shopify] pedido ${orderId} sin notas -> se dice "en confeccion"`);
      return vacio;
    }

    // Solo interesan las notas de fabricacion y las personalizaciones
    // (agregar gorro, cambiar color, corregir talla...). Las operativas
    // (ticket de cambio, conserjeria, reembolso) se descartan.
    const relevantes = filterRelevantNotes(ctx.notes);

    if (!relevantes.length) {
      console.log(
        `[shopify] pedido ${orderId}: sin notas relevantes -> se dice "en confeccion"`
      );
      return vacio;
    }

    const processDetails = looksLikeManufacturing(relevantes.join(" "));
    console.log(
      `[shopify] pedido ${orderId}: notas relevantes ` +
        (processDetails ? "DE FABRICACION" : "de personalizacion") +
        ` -> ${JSON.stringify(relevantes)}`
    );
    return { notes: relevantes.join("\n"), processDetails };
  } catch (error) {
    // Un fallo de Shopify no debe tumbar la respuesta del bot.
    console.error(`[shopify] error leyendo ${orderId}:`, error.message);
    return vacio;
  }
}

/**
 * Indica si el pedido esta en nuestra tabla de envios (Supabase).
 * Sirve para saber que el pedido existe aunque no tenga etiqueta en Envia.
 *
 * @param {string} orderId Nombre del pedido (MON3007).
 * @returns {Promise<boolean>}
 */
async function orderExistsInSupabase(orderId) {
  const map = await orders.getTrackingMap();
  return map.has(orderId);
}
dotenv.config();

// Log global de errores no capturados: sin esto, una excepcion en una
// promesa flotante se pierde silenciosamente en Vercel.
process.on("unhandledRejection", (reason) => {
  console.error("[global] unhandledRejection:", reason && reason.message ? reason.message : reason);
  if (reason && reason.stack) console.error("[global] stack:", reason.stack.split("\n").slice(0, 5).join(" | "));
});
process.on("uncaughtException", (err) => {
  console.error("[global] uncaughtException:", err && err.message ? err.message : err);
  if (err && err.stack) console.error("[global] stack:", err.stack.split("\n").slice(0, 5).join(" | "));
});

const { injectSpeedInsights } = require("@vercel/speed-insights");
injectSpeedInsights();
const { inject } = require("@vercel/analytics");
const { waitUntil: vercelWaitUntil } = require("@vercel/functions");
inject();

// Permitir todas las solicitudes (modo abierto)

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

const app = express();
// Ultimo mensaje entrante (Instagram o WhatsApp). Lo expone /health para
// poder verificar si el webhook sigue recibiendo eventos.
let lastInboundAt = null;
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
  if (!req.rawBody || !hmac || !SHOPIFY_SECRET) return false; // Prevents undefined error

  const calculatedHmac = crypto.createHmac("sha256", SHOPIFY_SECRET).update(req.rawBody).digest("base64");

  // crypto.timingSafeEqual lanza RangeError si los buffers tienen distinta
  // longitud. Sin esta comprobacion, una firma invalida con longitud
  // diferente provoca una excepcion no capturada y la funcion queda
  // colgada hasta el timeout de Vercel (300s) en vez de devolver 401.
  const hmacBuf = Buffer.from(hmac);
  const calculatedBuf = Buffer.from(calculatedHmac);
  if (hmacBuf.length !== calculatedBuf.length) return false;

  return crypto.timingSafeEqual(hmacBuf, calculatedBuf);
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
async function createEnviaShipment(shipment, order) {
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
    await sendMessage(order);
    console.log(JSON.stringify("Mensaje enviado exitosamente"));
  } catch (error) {
    console.error("error on sending message by twillio:", error);
  }

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
      name: customerName,
      order_id: String(order.order_number).toUpperCase(),
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
    // Now we need to await the formatEnviaShipment function
    const shipment = await formatEnviaShipment(order);
    console.log("el shipment", JSON.stringify(shipment));

    console.log("after shipment");
    // Send to Envia API
    const response = await createEnviaShipment(shipment, order);

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
        const responseExtended = await createEnviaShipment(shipment, order);
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

/**
 * GET /diag/wa?from=56966278263&text=...
 * Ejecuta la resolucion de WhatsApp y devuelve el resultado y los tiempos
 * en la propia respuesta (asi no se pierde nada si la funcion se corta).
 */
app.get("/diag/wa", async (req, res) => {
  const from = req.query.from || "56966278263";
  const text = req.query.text || "hola, en que va mi pedido MON4706?";
  const pasos = [];
  const t0 = Date.now();
  const mark = (m) =>
    pasos.push(`${((Date.now() - t0) / 1000).toFixed(1)}s ${m}`);

  const mensaje = { from, text, phoneNumberId: "530005643535929" };

  mark("inicio");
  const orderId = orders.extractOrderId(text);
  mark(`extractOrderId -> ${orderId}`);

  const shipment = await withTimeout(
    orders.findShipmentByOrderId(orderId),
    12000,
    "__timeout__"
  );
  mark(`findShipmentByOrderId -> ${shipment === "__timeout__" ? "TIMEOUT" : shipment ? shipment.status : "null"}`);

  const ctx = await withTimeout(
    shopify.getOrderContext(orderId),
    12000,
    "__timeout__"
  );
  mark(`getOrderContext -> ${ctx === "__timeout__" ? "TIMEOUT" : ctx ? ctx.found : "null"}`);

  res.status(200).json({
    pasos,
    total_ms: Date.now() - t0,
    shipment: shipment === "__timeout__" ? null : shipment,
    shopify_found: ctx === "__timeout__" ? null : ctx?.found ?? null,
  });
});

/**
 * GET /diag/db
 * Diagnostico de la conexion a Supabase: compara el cliente de supabase-js
 * con un fetch crudo a la REST API. Sirve para distinguir un problema de
 * red (Vercel -> Cloudflare) de uno del cliente.
 */
app.get("/diag/db", async (req, res) => {
  const url = `${process.env.SUPABASE_URL}/rest/v1/order_tracking?select=order_id&limit=1`;
  const key = process.env.SUPABASE_ANON_KEY;
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  const resultado = {};

  // 1) fetch crudo
  let t0 = Date.now();
  try {
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
    resultado.fetch_crudo = { ms: Date.now() - t0, status: r.status };
    await r.text();
  } catch (error) {
    resultado.fetch_crudo = { ms: Date.now() - t0, error: error.message };
  }

  // 2) supabase-js
  t0 = Date.now();
  try {
    const { data, error } = await orders.supabase
      .from("order_tracking")
      .select("order_id")
      .limit(1);
    resultado.supabase_js = { ms: Date.now() - t0, ok: !error, filas: data?.length ?? 0 };
  } catch (error) {
    resultado.supabase_js = { ms: Date.now() - t0, error: error.message };
  }

  // 3) la consulta del mapa completo (la que usa el bot)
  t0 = Date.now();
  try {
    const { data, error } = await orders.supabase
      .from("order_tracking")
      .select("order_id, tracking_id")
      .limit(1000);
    resultado.mapa_completo = {
      ms: Date.now() - t0,
      ok: !error,
      filas: data?.length ?? 0,
    };
  } catch (error) {
    resultado.mapa_completo = { ms: Date.now() - t0, error: error.message };
  }

  res.status(200).json(resultado);
});

/**
 * GET /health
 * Estado del bot sin exponer secretos. Sirve para verificar de un vistazo
 * si el webhook esta vivo, si las credenciales estan cargadas y cuando
 * llego el ultimo mensaje.
 */
app.get("/health", (req, res) => {
  res.status(200).json({
    ok: true,
    uptime_s: Math.round(process.uptime()),
    instagram: {
      // Configurado = hay credenciales; NO significa que la app de Meta
      // tenga los permisos o la suscripcion de webhooks activa.
      configurado: meta.isConfigured(process.env.META_ACCESS_TOKEN),
      ig_account_id: process.env.META_INSTAGRAM_ACCOUNT_ID || null,
      app_id: process.env.META_APP_ID || null,
      graph_version: process.env.META_GRAPH_VERSION || "v23.0",
      ultimo_mensaje: lastInboundAt,
    },
    ia: {
      configurado: Boolean(process.env.XAI_API_KEY),
      modelo: process.env.XAI_MODEL || "grok-4.7",
    },
    whatsapp: {
      // Configurado = hay credenciales reales (no el placeholder PENDIENTE).
      // Para que funcione de verdad el numero debe estar registrado en
      // WhatsApp Business y la app suscrita a los webhooks del WABA.
      configurado:
        meta.isConfigured(process.env.META_ACCESS_TOKEN) &&
        meta.isConfigured(process.env.META_PHONE_NUMBER_ID) &&
        meta.isConfigured(process.env.META_WABA_ID),
      waba_id: meta.isConfigured(process.env.META_WABA_ID)
        ? process.env.META_WABA_ID
        : null,
      phone_number_id: meta.isConfigured(process.env.META_PHONE_NUMBER_ID)
        ? process.env.META_PHONE_NUMBER_ID
        : null,
    },
    envios: {
      supabase: Boolean(process.env.SUPABASE_URL),
      envia: Boolean(process.env.ENVIA_API_KEY),
    },
  });
});

app.get("/tracking/:order_id", async (req, res) => {
  const order_id = req.params.order_id;
  console.log("order_id del tracking", order_id);

  try {
    const { data, error } = await orders.dbQuery(() =>
      supabase.from("order_tracking").select("tracking_id").eq("order_id", order_id)
    );
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

// ---------------------------------------------------------------------------
// Webhook de WhatsApp Cloud API (Meta) + agente de IA
// ---------------------------------------------------------------------------

const META_VERIFY_TOKEN = process.env.META_VERIFY_TOKEN;
const META_APP_SECRET = process.env.META_APP_SECRET;

// Aviso al arrancar si falta alguna credencial, para no tener que debuggear
// un fallo silencioso mas adelante.
if (!meta.isConfigured(META_APP_SECRET) || !meta.isConfigured(process.env.META_ACCESS_TOKEN)) {
  console.warn(
    "[meta] AVISO: META_APP_SECRET / META_ACCESS_TOKEN sin configurar. " +
      "El webhook rechazara los mensajes hasta completar la configuracion."
  );
}
if (!meta.isConfigured(process.env.XAI_API_KEY)) {
  console.warn("[meta] AVISO: XAI_API_KEY sin configurar. El agente no podra responder.");
}

/**
 * GET /webhook/meta
 * Handshake de verificacion de Meta. Meta envia:
 *   ?hub.mode=subscribe&hub.verify_token=<token>&hub.challenge=<challenge>
 * Hay que devolver el challenge en el body con status 200.
 */
app.get("/webhook/meta", (req, res) => {
  const result = meta.handleVerification(req.query, META_VERIFY_TOKEN);
  if (result.status === 200) {
    console.log("[meta] webhook verificado");
  } else {
    console.warn("[meta] verificacion fallida");
  }
  return res.status(result.status).send(result.body);
});

/**
 * Detecta si un payload de Meta es de WhatsApp (y no de Instagram).
 *
 * Instagram manda `object: "instagram"` con `entry[].messaging`.
 * WhatsApp manda `object: "whatsapp_business_account"` con
 * `entry[].changes[].value.messaging_product == "whatsapp"`.
 *
 * @param {object} body Payload del webhook.
 * @returns {boolean}
 */
function isWhatsAppPayload(body) {
  if (!body) return false;
  if (body.object === "whatsapp_business_account") return true;
  const change = body.entry?.[0]?.changes?.[0]?.value;
  if (change && change.messaging_product === "whatsapp") return true;
  return false;
}

/**
 * Procesa un webhook de Meta ya validado: responde 200 de inmediato y
 * sigue trabajando en segundo plano con waitUntil.
 *
 * @param {object} req Request.
 * @param {object} res Response.
 * @param {string} canal "instagram" | "whatsapp"
 */
async function processMetaWebhook(req, res, canal) {
  // Sin esto, Vercel CONGELA la funcion en cuanto se envia la respuesta y el
  // trabajo pendiente nunca avanza. @vercel/functions expone waitUntil para
  // registrarlo; req.waitUntil no existe en este runtime.
  const waitUntil =
    req.waitUntil || vercelWaitUntil || ((p) => p && p.catch(() => {}));

  if (canal === "whatsapp") {
    const messages = meta.parseInboundMessages(req.body);
    console.log(`[meta] ${messages.length} mensaje(s) entrante(s)`);

    const task = Promise.all(
      messages.map((message) => {
        // El phone_number_id viene en el webhook. Se usa para responder por el
        // mismo numero por el que escribio el cliente.
        const sender = (to, bodyText) =>
          meta.sendTextMessage(to, bodyText, {
            phoneNumberId: message.phoneNumberId,
          });

        return handleInboundMessage(message, sender).catch((error) => {
          console.error("[meta] error procesando mensaje:", error.message);
        });
      })
    );

    // Se responde primero (Meta exige <5 s) y el trabajo sigue despues.
    // waitUntil mantiene viva la funcion para que no se congele.
    waitUntil(task);
    res.status(200).send("EVENT_RECEIVED");
    return;
  }
  // Instagram
  const messages = meta.parseInstagramMessages(req.body);
  console.log(`[instagram] ${messages.length} mensaje(s) entrante(s)`);

  if (messages.length) {
    lastInboundAt = new Date().toISOString();
  } else {
    // Meta puede enviar eventos que no son mensajes (comments, mentions,
    // reactions, seen...). Se registra la forma del payload para poder
    // depurarlos sin depender de los logs crudos de Vercel.
    const entry = req.body?.entry?.[0] || {};
    console.log(
      "[instagram] evento sin mensajes:",
      JSON.stringify({
        object: req.body?.object,
        entry_id: entry.id,
        campos: Object.keys(entry),
      })
    );
  }

  const tasks = messages.map(async (message) => {
    // El destinatario es el cliente (sender.id del webhook), no nuestra cuenta.
    // Si se pasa un id explicito se respeta; si no, se usa el del mensaje.
    const sender = (to, body) =>
      meta.sendInstagramMessage(to || message.customerId, body, {
        igUserId: message.igUserId,
      });
    try {
      await handleInstagramMessage(message, sender);
    } catch (error) {
      console.error("[instagram] ERROR procesando mensaje:", error.message);
      console.error("[instagram] stack:", (error.stack || "").split("\n").slice(0, 4).join(" | "));
    }
  });

  const task = Promise.all(tasks);
  if (waitUntil) {
    waitUntil(task);
  } else {
    task.catch((error) => console.error("[instagram] error:", error.message));
  }

  res.status(200).send("EVENT_RECEIVED");
}

/**
 * POST /webhook/meta
 * Llega un mensaje entrante de WhatsApp. Meta exige respuesta rapida
 * (reintenta si tarda), asi que se responde 200 de inmediato y el trabajo
 * real se hace despues, con waitUntil (en Vercel las promesas sueltas se
 * hibernan y nunca se resuelven).
 */
app.post("/webhook/meta", async (req, res) => {
  const signature = req.headers["x-hub-signature-256"];

  if (!meta.verifyMetaSignature(req.rawBody, signature, META_APP_SECRET)) {
    console.warn("[meta] firma invalida, request rechazado");
    return res.status(401).send("Invalid signature");
  }

  await processMetaWebhook(req, res, "whatsapp");
});

/**
 * Logica principal: resuelve el pedido, arma el contexto y responde con IA.
 *
 * @param {object} message Mensaje normalizado del webhook de Meta.
 * @param {Function} sender Funcion para enviar la respuesta (WhatsApp o IG).
 */
async function handleInboundMessage(message, sender = meta.sendTextMessage) {
  const { from, text } = message;
  const t0 = Date.now();
  const mark = (m) =>
    console.log(`[meta] (${((Date.now() - t0) / 1000).toFixed(1)}s) ${m}`);
  console.log(`[meta] mensaje de ${from}: ${text}`);

  // 1) Si pide hablar con una persona, se escala sin preguntar nada.
  if (ai.wantsHuman(text)) {
    await sender(
      from,
      "Te paso con un asesor de Mondano que te va a ayudar. " +
        "Puedes contactarnos también al +56 9 9689 1362 o por contacto@mondano.cl"
    );
    console.log("[meta] escalado a humano por intencion explicita");
    return;
  }

  // 2) Resolver pedido: por numero de pedido en el texto, por lo que dijo
  //    antes, o por su telefono (que en WhatsApp ya viene en el `from`).
  mark("resolviendo pedido...");
  const resolved = await resolveWhatsAppOrder(message);
  mark(
    `resuelto: reason=${resolved.reason} orderId=${resolved.orderId || "n/d"} ` +
      `candidatos=${resolved.candidates ? resolved.candidates.length : 0}`
  );

  // 3) Armar contexto para la IA.
  mark("armando contexto...");
  const context = await buildReplyContext(resolved, {
    text,
    greeting: ai.isGreetingOnly(text),
    candidates: resolved.candidates || [],
  });
  mark(`contexto listo (${context.length} chars)`);

  // 4) Respuesta de la IA.
  mark("llamando a la IA...");
  const { ok, reply, error } = await ai.generateReply({ userText: text, context });
  mark(`IA ok=${ok}${error ? " error=" + error : ""}`);

  if (!ok) {
    console.error("[meta] error de IA:", error);
    await sender(
      from,
      "Tuve problemas para responder en este momento. " +
        "Por favor contacta a nuestro equipo al +56 9 9689 1362 o contacto@mondano.cl"
    );
    return;
  }

  const sent = await sender(from, reply);
  if (sent && sent.ok === false) {
    console.error("[meta] error enviando:", sent.error);
  } else {
    console.log(`[meta] respuesta enviada a ${from}: ${reply}`);
  }
}

// ---------------------------------------------------------------------------
// Webhook de Instagram Messaging API (Meta)
// ---------------------------------------------------------------------------

/**
 * GET /webhook/instagram
 * Handshake de verificacion de Meta. Meta envia un GET con:
 *   ?hub.mode=subscribe&hub.verify_token=<token>&hub.challenge=<challenge>
 * Hay que devolver el challenge en el body con status 200. Si no, Meta
 * muestra "No se pudo validar la URL de devolucion de llamada o el token
 * de verificacion".
 */
app.get("/webhook/instagram", (req, res) => {
  const result = meta.handleVerification(req.query, META_VERIFY_TOKEN);
  if (result.status === 200) {
    console.log("[instagram] webhook verificado");
  } else {
    console.warn(
      "[instagram] verificacion fallida:",
      "modo=" + (req.query["hub.mode"] || "?") +
        " token_coincide=" + (req.query["hub.verify_token"] === META_VERIFY_TOKEN)
    );
  }
  return res.status(result.status).send(result.body);
});

/**
 * POST /webhook/instagram
 * Mismo mecanismo que WhatsApp: se verifica la firma con el App Secret y se
 * responde 200 de inmediato para que Meta no reintente.
 *
 * A diferencia de WhatsApp, aqui el destinatario de la respuesta es el
 * Instagram Account ID (viene en recipient.id), no el id del usuario.
 */
app.post("/webhook/instagram", async (req, res) => {
  const signature = req.headers["x-hub-signature-256"];

  if (!meta.verifyMetaSignature(req.rawBody, signature, META_APP_SECRET)) {
    console.warn("[instagram] firma invalida, request rechazado");
    return res.status(401).send("Invalid signature");
  }

  // Meta puede mandar el payload de WhatsApp a esta misma URL si la
  // suscripcion de la app quedo apuntando aqui. Se detecta por la forma
  // del payload y se enruta al handler que corresponde.
  if (isWhatsAppPayload(req.body)) {
    console.log("[instagram] payload de WhatsApp detectado -> /webhook/meta");
    return processMetaWebhook(req, res, "whatsapp");
  }

  const messages = meta.parseInstagramMessages(req.body);
  console.log(`[instagram] ${messages.length} mensaje(s) entrante(s)`);
  if (messages.length) {
    lastInboundAt = new Date().toISOString();
  } else {
    // Meta puede enviar eventos que no son mensajes (comments, mentions,
    // reactions, seen...). Se registra la forma del payload para poder
    // depurarlos sin depender de los logs crudos de Vercel.
    const entry = req.body?.entry?.[0] || {};
    console.log(
      "[instagram] evento sin mensajes:",
      JSON.stringify({
        object: req.body?.object,
        entry_id: entry.id,
        campos: Object.keys(entry),
      })
    );
  }

  // Meta exige responder en menos de 5 segundos, asi que se responde de
  // inmediato. En Vercel, las promesas que quedan pendientes despues de
  // res.send() se hibernate y nunca se resuelven: por eso se usa
  // waitUntil() de @vercel/functions, que mantiene viva la funcion.
  // waitUntil mantiene viva la funcion despues de responder. Sin el, Vercel
  // congela la instancia y el trabajo pendiente nunca avanza.
  const waitUntil =
    req.waitUntil || vercelWaitUntil || ((p) => p && p.catch(() => {}));

  const tasks = messages.map(async (message) => {
    // El destinatario es el cliente (sender.id del webhook), no nuestra cuenta.
    // Si se pasa un id explicito se respeta; si no, se usa el del mensaje.
    const sender = (to, body) =>
      meta.sendInstagramMessage(to || message.customerId, body, {
        igUserId: message.igUserId,
      });
    try {
      await handleInstagramMessage(message, sender);
    } catch (error) {
      console.error("[instagram] ERROR procesando mensaje:", error.message);
      console.error("[instagram] stack:", (error.stack || "").split("\n").slice(0, 4).join(" | "));
    }
  });

  const task = Promise.all(tasks);
  if (waitUntil) {
    waitUntil(task);
  } else {
    // Fallback: si no hay waitUntil, se procesa antes de responder.
    await task;
  }

  res.status(200).send("EVENT_RECEIVED");
});

/**
 * Resuelve un pedido a partir de su numero (MON3007).
 *
 * @param {string} orderId Numero de pedido.
 * @returns {Promise<object>} { shipment, orderId, reason, shopify }
 */
/**
 * Corre una promesa con un tope de tiempo. Si se pasa, se resuelve con el
 * valor de respaldo y la promesa original se queda pendiente.
 *
 * Es una red de seguridad: desde Vercel hay llamadas que se quedan
 * colgadas (Supabase, Envia, x.ai) y una funcion que no termina la mata
 * Vercel a los 60 s, y con ella se pierden hasta los logs.
 *
 * @param {Promise} promise Promesa original.
 * @param {number} ms Tope de espera.
 * @param {*} fallback Valor si se pasa el tiempo.
 * @returns {Promise<*>}
 */
function withTimeout(promise, ms, fallback) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

async function resolveOrderById(orderId) {
  const t0 = Date.now();
  const mark = (m) =>
    console.log(
      `[orden] (${((Date.now() - t0) / 1000).toFixed(1)}s) ${orderId}: ${m}`
    );

  mark("consultando Supabase...");
  const resultado = await withTimeout(
    (async () => {
      const shipment = await orders.findShipmentByOrderId(orderId);
      mark(`envio: ${shipment ? shipment.status : "null"}`);
      if (shipment) {
        return { shipment, orderId: shipment.orderId || orderId, reason: "pedido" };
      }

      // Sin envio en Envia: el pedido puede existir y estar en fabricacion.
      mark("consultando Shopify...");
      const ctx = await shopify.getOrderContext(orderId).catch((error) => {
        console.error(`[shopify] error leyendo ${orderId}:`, error.message);
        return null;
      });
      mark(`shopify: found=${ctx ? ctx.found : "null"}`);

      if (ctx && ctx.found) {
        return {
          shipment: null,
          orderId,
          reason: "pedido_sin_envio",
          shopify: ctx,
        };
      }

      mark("verificando en order_tracking...");
      if (await orderExistsInSupabase(orderId)) {
        mark("existe en order_tracking");
        return { shipment: null, orderId, reason: "pedido_sin_envio" };
      }

      mark("no existe");
      return { shipment: null, orderId, reason: "pedido_no_encontrado" };
    })(),
    15000,
    null
  );

  if (!resultado) {
    // Se paso el tiempo: preferimos responder algo honesto antes que dejar
    // al cliente sin respuesta.
    console.warn(
      `[orden] ${orderId}: la busqueda paso de 15s, se responde sin verificar`
    );
    return { shipment: null, orderId, reason: "sin_verificar" };
  }

  return resultado;
}

/**
 * Resuelve el pedido de un cliente de Instagram, en cascada:
 *
 *   1) Numero de pedido explicito en el texto  (MON3007 / "pedido 3007")
 *   2) Lo que el cliente dijo antes en esta conversacion
 *   3) Nada -> se le pide el numero de pedido
 *
 * En Instagram el id del usuario NO es un telefono, asi que (1) es la unica
 * via de identificarlo. No se pide el telefono del cliente: no aporta y
 * complica la conversacion.
 *
 * @param {object} message Mensaje normalizado.
 * @returns {Promise<object>} { shipment, orderId, reason, shopify }
 */
async function resolveInstagramOrder(message) {
  const text = message.text;
  const key = message.customerId;

  // 1) Numero de pedido explicito
  const orderId = orders.extractOrderId(text);
  if (orderId) {
    const resolved = await resolveOrderById(orderId);
    if (resolved.shipment || resolved.reason === "pedido_sin_envio") {
      conversation.remember(key, { orderId: resolved.orderId });
    }
    return resolved;
  }

  // 2) Memoria de la conversacion
  const memo = conversation.get(key);
  if (memo?.orderId) {
    const resolved = await resolveOrderById(memo.orderId);
    if (resolved.shipment || resolved.reason === "pedido_sin_envio") {
      return { ...resolved, reason: resolved.reason === "pedido" ? "memoria_pedido" : resolved.reason };
    }
  }

  // 3) Sin ningun dato
  return { shipment: null, reason: "sin_datos" };
}

/**
 * Resuelve el pedido de un cliente de WhatsApp, en cascada:
 *
 *   1) Numero de pedido explicito en el texto
 *   2) Lo que el cliente dijo antes en esta conversacion
 *   3) Los pedidos del cliente, buscados por su telefono en Shopify
 *   4) Nada -> se le pide el numero de pedido
 *
 * En WhatsApp el `from` del webhook YA es el telefono del cliente: es la
 * identidad del canal, no un dato que se le recabe. Con eso se sabe de
 * inmediato de que pedido esta hablando, sin preguntarle nada.
 *
 * @param {object} message Mensaje normalizado.
 * @returns {Promise<object>} { shipment, orderId, reason, shopify, candidates }
 */
async function resolveWhatsAppOrder(message) {
  const { from, text } = message;

  // 1) Numero de pedido explicito
  const orderId = orders.extractOrderId(text);
  if (orderId) {
    const resolved = await resolveOrderById(orderId);
    if (resolved.shipment || resolved.reason === "pedido_sin_envio") {
      conversation.remember(from, { orderId: resolved.orderId });
    }
    return resolved;
  }

  // 2) Memoria de la conversacion
  const memo = conversation.get(from);
  if (memo?.orderId) {
    const resolved = await resolveOrderById(memo.orderId);
    if (resolved.shipment || resolved.reason === "pedido_sin_envio") {
      return {
        ...resolved,
        reason: resolved.reason === "pedido" ? "memoria_pedido" : resolved.reason,
      };
    }
  }

  // 3) Pedidos del cliente por telefono (Shopify)
  let candidates = [];
  try {
    candidates = await shopify.findOrdersByPhone(from);
  } catch (error) {
    console.error("[shopify] error buscando por telefono:", error.message);
  }

  if (candidates.length) {
    const principal = candidates[0];
    const resolved = await resolveOrderById(principal.name);
    conversation.remember(from, { orderId: resolved.orderId || principal.name });

    if (resolved.shipment || resolved.reason === "pedido_sin_envio") {
      return {
        ...resolved,
        reason: resolved.reason === "pedido" ? "telefono" : resolved.reason,
        candidates: candidates.map((c) => c.name),
      };
    }
    return { shipment: null, orderId: principal.name, reason: "pedido_no_encontrado", candidates: candidates.map((c) => c.name) };
  }

  // 4) Sin ningun dato
  return { shipment: null, reason: "sin_datos" };
}

/**
 * Arma el contexto para la IA a partir de la resolucion del pedido.
 *
 * Es el mismo para Instagram y WhatsApp: estado del envio, proceso de
 * fabricacion y los datos que falten.
 *
 * @param {object} resolved Resultado de resolve*.
 * @param {object} [options] { text, greeting, candidates }
 * @returns {Promise<string>} Contexto.
 */
async function buildReplyContext(resolved, { text = "", greeting = false, candidates = [] } = {}) {
  let context;

  if (resolved.shipment) {
    context = ai.buildShipmentContext(resolved.shipment);

    // Si el pedido se identifico por el telefono del cliente (no lo pidio
    // explicitamente), hay que responder sobre ESE pedido: el bot ya sabe
    // de que se trata y no debe preguntar de que pedido habla.
    if (resolved.reason === "telefono" || resolved.reason === "memoria_pedido") {
      context +=
        `\n\nYa identificamos el pedido del cliente por su numero de ` +
        `telefono: ${resolved.orderId}. Aunque no haya escrito un numero de ` +
        `pedido en su mensaje, responde sobre ESE pedido. No le preguntes de ` +
        `que pedido trata.`;
    }

    // Si el cliente tiene varios pedidos, se le avisa de cual se responde.
    if (candidates.length > 1) {
      context +=
        `\n\nNOTA: este cliente tiene ${candidates.length} pedidos ` +
        `(${candidates.join(", ")}). Estas respondiendo por el MAS RECIENTE ` +
        `(${resolved.orderId}). Menciona que tiene otros pedidos y pide que ` +
        `confirme si es ese.`;
    }
  } else if (resolved.reason === "pedido_sin_envio") {
    context =
      `El pedido ${resolved.orderId} EXISTE, pero todavia NO tiene un envio ` +
      `generado: sigue en proceso en el taller. No le digas que no lo ` +
      `encontramos. Pregunta si ya le informamos el numero de seguimiento y ` +
      `ofrece pasar con un asesor si es urgente.`;
  } else {
    context = ai.buildMissingDataContext({
      reason: resolved.reason,
      orderId: resolved.orderId,
      greeting,
    });
  }

  // Proceso de fabricacion: se cuenta mientras el paquete no fue retirado.
  // OJO: la variable NO se llama "process" porque sombrearia el global de Node.
  const fabNotes = await getManufacturingNotes(resolved);
  const mostrarProceso =
    resolved.orderId &&
    resolved.reason !== "pedido_no_encontrado" &&
    orders.isNotPickedUp(resolved.shipment);

  if (mostrarProceso) {
    context += "\n\n" + ai.buildProcessContext(fabNotes.notes, fabNotes);
  }

  return context;
}

/**
 * Procesa un mensaje de Instagram. Reusa la logica del agente, pero la
 * busqueda de pedidos no puede usar el id numerico del usuario de Instagram
 * como telefono, asi que se identifica al cliente por su numero de pedido
 * (MON3007) o por lo que dijo antes en la conversacion.
 *
 * @param {object} message Mensaje normalizado.
 * @param {Function} sender Funcion para enviar la respuesta.
 */
async function handleInstagramMessage(message, sender) {
  const { text } = message;
  console.log(`[instagram] mensaje: ${text}`);

  // ALCANCE: el bot solo habla si la persona pregunta por un pedido.
  // Un saludo, un "ok", un emoji o cualquier comentario que no sea del
  // pedido se queda sin respuesta.
  const mencionaPedido =
    Boolean(orders.extractOrderId(text)) || ai.isTrackingIntent(text);
  const pideHumano = ai.wantsHuman(text);

  if (!mencionaPedido && !pideHumano) {
    console.log("[instagram] sin respuesta: no pregunta por un pedido");
    return;
  }

  if (pideHumano) {
    await sender(
      message.customerId,
      "Te paso con un asesor de Mondano que te va a ayudar. " +
        "Puedes contactarnos también al +56 9 9689 1362 o por contacto@mondano.cl"
    );
    console.log("[instagram] escalado a humano por intencion explicita");
    return;
  }

  const resolved = await resolveInstagramOrder(message);
  console.log(
    `[instagram] busqueda: reason=${resolved.reason} ` +
      `orderId=${resolved.orderId || "n/d"}`
  );

  const context = await buildReplyContext(resolved, {
    text,
    greeting: ai.isGreetingOnly(text),
  });

  const { ok, reply, error } = await ai.generateReply({ userText: text, context });
  console.log(`[instagram] IA ok=${ok}${error ? " error=" + error : ""}`);

  if (!ok) {
    console.error("[instagram] error de IA:", error);
    await sender(
      message.customerId,
      "Tuve problemas para responder en este momento. " +
        "Por favor contacta a nuestro equipo al +56 9 9689 1362 o contacto@mondano.cl"
    );
    return;
  }

  const sent = await sender(message.customerId, reply);
  if (sent && sent.ok === false) console.error("[instagram] error enviando:", sent.error);
  else console.log(`[instagram] respuesta enviada: ${reply}`);
}

module.exports = app;
// Se exponen para poder probarlos sin levantar el servidor.
module.exports.handleInstagramMessage = handleInstagramMessage;
module.exports.handleInboundMessage = handleInboundMessage;
module.exports.resolveInstagramOrder = resolveInstagramOrder;
module.exports.resolveWhatsAppOrder = resolveWhatsAppOrder;
module.exports.buildReplyContext = buildReplyContext;
module.exports.filterRelevantNotes = filterRelevantNotes;
module.exports.isRelevantNote = isRelevantNote;
module.exports.looksLikeManufacturing = looksLikeManufacturing;
// La construccion del indice de telefonos puede tardar ~7s la primera vez.
module.exports.config = { maxDuration: 60 };
