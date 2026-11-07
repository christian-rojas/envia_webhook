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

// Palabras que delatan que una nota habla del proceso de fabricacion.
// Si la nota del pedido no menciona ninguna, no se le manda nada al cliente:
// las notas operativas (conserjeria, cambios de pedido) son internas.
const MANUFACTURING_KEYWORDS = (
  process.env.MANUFACTURING_KEYWORDS ||
  "taller,corte,elabora,planch,ensamblaj,costur,confecci,producc,tejid,serigraf,estampad,termin,listo,armado,montaje,acabado"
)
  .split(",")
  .map((k) => k.trim().toLowerCase())
  .filter(Boolean);

/**
 * Indica si unas notas internas hablan del proceso de fabricacion.
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

    const processDetails = looksLikeManufacturing(ctx.notes);
    console.log(
      `[shopify] pedido ${orderId}: notas ` +
        (processDetails ? "DE FABRICACION" : "sin detalle de etapas (en confeccion)")
    );
    return { notes: ctx.notes, processDetails };
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
  const { data, error } = await supabase
    .from("order_tracking")
    .select("order_id")
    .eq("order_id", orderId)
    .limit(1);
  return !error && Array.isArray(data) && data.length > 0;
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
 * POST /webhook/meta
 * Llega un mensaje entrante. Meta exige respuesta rapida (reintenta si
 * tarda), asi que se responde 200 de inmediato y el trabajo real se hace
 * despues, sin await.
 */
app.post("/webhook/meta", (req, res) => {
  const signature = req.headers["x-hub-signature-256"];

  if (!meta.verifyMetaSignature(req.rawBody, signature, META_APP_SECRET)) {
    console.warn("[meta] firma invalida, request rechazado");
    return res.status(401).send("Invalid signature");
  }

  const messages = meta.parseInboundMessages(req.body);
  console.log(`[meta] ${messages.length} mensaje(s) entrante(s)`);

  // Se responde ya para que Meta no reintente. El procesamiento sigue.
  res.status(200).send("EVENT_RECEIVED");

  for (const message of messages) {
    handleInboundMessage(message).catch((error) => {
      console.error("[meta] error procesando mensaje:", error.message);
    });
  }
});

/**
 * Logica principal: resuelve el pedido, arma el contexto y responde con IA.
 *
 * @param {object} message Mensaje normalizado del webhook de Meta.
 * @param {Function} sender Funcion para enviar la respuesta (WhatsApp o IG).
 */
async function handleInboundMessage(message, sender = meta.sendTextMessage) {
  const { from, text } = message;
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

  // 2) Resolver pedido: por numero de pedido en el texto o por telefono.
  //    En WhatsApp el `from` YA es el telefono del cliente: es la identidad
  //    del canal, no un dato que se le pida. Por eso no hace falta pedirle
  //    nada para saber de quien se trata.
  const { shipment, orderId, reason, matches } = await orders.findShipment({
    phone: from,
    text,
  });

  console.log(
    `[meta] busqueda: reason=${reason} orderId=${orderId || "n/d"} ` +
      `matches=${matches || 0}`
  );

  // Se recuerda el pedido para que los mensajes siguientes no repitan.
  if (orderId) conversation.remember(from, { orderId });

  // 3) Armar contexto para la IA.
  let context;
  if (shipment) {
    context = ai.buildShipmentContext(shipment);
    if (matches > 1) {
      context +=
        `\n\nNOTA: este cliente tiene ${matches} envios. Estas respondiendo ` +
        `por el MAS RECIENTE (${orderId}). Menciona que tiene otros pedidos ` +
        `y pide que confirme si es ese.`;
    }
  } else if (reason === "pedido_sin_envio") {
    context =
      `El pedido ${orderId} existe pero todavia NO tiene un envio generado ` +
      `(todavia no se ha enviado). Pregunta si ya le informamos el numero de ` +
      `seguimiento y ofrece pasar con un asesor.`;
  } else {
    context = ai.buildMissingDataContext({
      reason,
      orderId,
    });
  }

  // 4) Respuesta de la IA.
  const { ok, reply, error } = await ai.generateReply({ userText: text, context });

  if (!ok) {
    console.error("[meta] error de IA:", error);
    await sender(
      from,
      "Tuve problemas para responder en este momento. " +
        "Por favor contacta a nuestro equipo al +56 9 9689 1362 o contacto@mondano.cl"
    );
    return;
  }

  await sender(from, reply);
  console.log(`[meta] respuesta enviada a ${from}: ${reply}`);
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
  const waitUntil = req.waitUntil ? req.waitUntil.bind(req) : null;

  const tasks = messages.map(async (message) => {
    // El "from" sirve para buscar pedidos por telefono (WhatsApp); en
    // Instagram el id de usuario no es un telefono, asi que la respuesta
    // va al Instagram Account ID.
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
 * @returns {Promise<object>} { shipment, orderId, reason }
 */
async function resolveInstagramOrder(message) {
  const text = message.text;
  const key = message.customerId;

  // 1) Numero de pedido explicito
  const orderId = orders.extractOrderId(text);
  if (orderId) {
    const shipment = await orders.findShipmentByOrderId(orderId);
    if (shipment) {
      conversation.remember(key, { orderId: shipment.orderId || orderId });
      return {
        shipment,
        orderId: shipment.orderId || orderId,
        reason: "pedido",
      };
    }

    // Sin envio en Envia: el pedido puede existir y estar en fabricacion.
    // Se consulta Shopify, que es la fuente de verdad del pedido.
    const ctx = await shopify.getOrderContext(orderId).catch((error) => {
      console.error(`[shopify] error leyendo ${orderId}:`, error.message);
      return null;
    });

    if (ctx && ctx.found) {
      conversation.remember(key, { orderId });
      return {
        shipment: null,
        orderId,
        reason: "pedido_sin_envio",
        shopify: ctx,
      };
    }

    // El pedido no esta en Shopify (o no se pudo leer). Se comprueba
    // nuestra tabla de envios: si esta ahi, el pedido existe.
    if (await orderExistsInSupabase(orderId)) {
      conversation.remember(key, { orderId });
      return { shipment: null, orderId, reason: "pedido_sin_envio" };
    }

    return { shipment: null, orderId, reason: "pedido_no_encontrado" };
  }

  // 2) Memoria de la conversacion
  const memo = conversation.get(key);
  if (memo?.orderId) {
    const shipment = await orders.findShipmentByOrderId(memo.orderId);
    if (shipment) {
      return {
        shipment,
        orderId: memo.orderId,
        reason: "memoria_pedido",
      };
    }
    const ctx = await shopify.getOrderContext(memo.orderId).catch(() => null);
    if (ctx && ctx.found) {
      return {
        shipment: null,
        orderId: memo.orderId,
        reason: "pedido_sin_envio",
        shopify: ctx,
      };
    }
    return { shipment: null, orderId: memo.orderId, reason: "pedido_sin_envio" };
  }

  // 3) Sin ningun dato
  return { shipment: null, reason: "sin_datos" };
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

  if (ai.wantsHuman(text)) {
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

  // Armar contexto para la IA.
  let context;
  if (resolved.shipment) {
    context = ai.buildShipmentContext(resolved.shipment);
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
      greeting: ai.isGreetingOnly(text),
    });
  }

  // Proceso de fabricacion: se cuenta mientras el paquete no fue retirado.
  const process = await getManufacturingNotes(resolved);
  const mostrarProceso =
    resolved.orderId &&
    resolved.reason !== "pedido_no_encontrado" &&
    orders.isNotPickedUp(resolved.shipment);

  if (mostrarProceso) {
    context += "\n\n" + ai.buildProcessContext(process.notes, process);
  }

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
