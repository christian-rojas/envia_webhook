/**
 * Modulo de integracion con WhatsApp Cloud API de Meta.
 *
 * Responsabilidades:
 *  - Verificar la firma X-Hub-Signature-256 de los webhooks entrantes (HMAC-SHA256).
 *  - Responder al handshake GET de verificacion de Meta.
 *  - Normalizar el payload del webhook a mensajes de texto simples.
 *  - Enviar mensajes de texto via Graph API.
 *
 * Docs: https://developers.facebook.com/documentation/business-messaging/whatsapp
 */

const crypto = require("crypto");

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v23.0";

// Timeout del POST a Graph API. Sin esto, si graph.facebook.com se cuelga la
// promesa NUNCA resuelve: el `await sender(...)` que esta en el camino critico
// se queda esperando para siempre, el cliente no recibe respuesta y la funcion
// sigue viva hasta que Vercel la mata por maxDuration.
const META_TIMEOUT_MS = Number(process.env.META_TIMEOUT_MS || 10000);

/**
 * Cache en memoria del ig-user-id de la cuenta de negocio.
 *
 * El ig-user-id llega en entry[].id de cada webhook entrante. Se cachea
 * porque el endpoint de envio lo necesita y el valor no cambia. Se persiste
 * tambien en un archivo para sobrevivir a reinicios de la funcion (Vercel
 * recicla las instancias).
 */
let cachedIgUserId = process.env.META_INSTAGRAM_ACCOUNT_ID || null;
const IG_USER_ID_FILE = "/tmp/ig_user_id.txt";

try {
  if (!cachedIgUserId) {
    const fs = require("fs");
    if (fs.existsSync(IG_USER_ID_FILE)) {
      cachedIgUserId = fs.readFileSync(IG_USER_ID_FILE, "utf8").trim() || null;
    }
  }
} catch {
  // sin persistencia en disco: se usa solo la cache en memoria
}

/**
 * Guarda el ig-user-id descubierto.
 *
 * @param {string} igUserId
 */
function rememberIgUserId(igUserId) {
  if (!igUserId || cachedIgUserId === igUserId) return;
  cachedIgUserId = igUserId;
  try {
    const fs = require("fs");
    fs.writeFileSync(IG_USER_ID_FILE, igUserId, "utf8");
  } catch {
    // si no se puede escribir, la cache en memoria basta
  }
  console.log(`[instagram] ig-user-id descubierto: ${igUserId}`);
}

/**
 * Valor centinela usado al desplegar la variable de entorno antes de tener el
 * valor real. Evita que el bot intente enviar mensajes con credenciales
 * falsas y genere errores confusos en Meta.
 */
const PLACEHOLDER = "PENDIENTE";

/**
 * Indica si una credencial esta realmente configurada.
 *
 * @param {string|undefined} value Valor de la variable de entorno.
 * @returns {boolean}
 */
function isConfigured(value) {
  return Boolean(value && value !== PLACEHOLDER && value.trim() !== "");
}

/**
 * Verifica la firma del webhook de Meta sobre el body crudo.
 *
 * Meta firma con HMAC-SHA256 usando el App Secret como clave y envia el
 * resultado en el header `X-Hub-Signature-256` con el formato `sha256=<hex>`.
 * La comparacion debe hacerse en tiempo constante sobre los bytes crudos
 * ANTES de parsear el JSON.
 *
 * @param {string} rawBody Body crudo de la peticion.
 * @param {string|undefined} signature Header X-Hub-Signature-256.
 * @param {string|undefined} appSecret App Secret de la app de Meta.
 * @returns {boolean} true si la firma es valida.
 */
function verifyMetaSignature(rawBody, signature, appSecret) {
  if (!rawBody || !signature || !isConfigured(appSecret)) return false;

  const expected = crypto.createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  const received = String(signature).replace(/^sha256=/, "");

  const expectedBuf = Buffer.from(expected, "utf8");
  const receivedBuf = Buffer.from(received, "utf8");

  if (expectedBuf.length !== receivedBuf.length) return false;

  return crypto.timingSafeEqual(expectedBuf, receivedBuf);
}

/**
 * Resuelve el challenge de verificacion de Meta (GET).
 *
 * @param {object} query Query string parseado.
 * @param {string|undefined} verifyToken Token configurado en Meta.
 * @returns {{status: number, body?: string}} Respuesta a enviar.
 */
function handleVerification(query, verifyToken) {
  const mode = query["hub.mode"];
  const token = query["hub.verify_token"];
  const challenge = query["hub.challenge"];

  if (mode === "subscribe" && token && token === verifyToken && challenge) {
    return { status: 200, body: String(challenge) };
  }
  return { status: 403, body: "Verification failed" };
}

/**
 * Extrae los mensajes de texto de un payload del webhook de WhatsApp.
 *
 * Meta agrupa los eventos en `entry[].changes[].value`. Dentro pueden venir
 * mensajes entrantes (type `text`), estados de entrega, errores, etc. Solo nos
 * interesan los mensajes entrantes con cuerpo de texto.
 *
 * @param {object} payload Payload completo del webhook.
 * @returns {Array<object>} Lista de mensajes normalizados.
 */
function parseInboundMessages(payload) {
  const out = [];

  const entries = payload?.entry || [];
  for (const entry of entries) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      if (value.messaging_product && value.messaging_product !== "whatsapp") continue;

      for (const message of value.messages || []) {
        if (message.type !== "text" || !message.text || !message.text.body) continue;

        const profile = (value.contacts || []).find((c) => c.wa_id === message.from);

        out.push({
          messageId: message.id,
          from: message.from,
          profileName: profile?.profile?.name || null,
          text: String(message.text.body).trim(),
          timestamp: message.timestamp ? Number(message.timestamp) : null,
          phoneNumberId: value.metadata?.phone_number_id || null,
          displayPhoneNumber: value.metadata?.display_phone_number || null,
          rawType: message.type,
        });
      }
    }
  }

  return out;
}

/**
 * Extrae los mensajes de texto de un payload del webhook de Instagram.
 *
 * El formato es distinto a WhatsApp:
 *   entry[].messaging[]  ->  { sender: { id }, recipient: { id }, message: {...} }
 *
 * El `recipient.id` es el Instagram Account ID (IGSID) y es a donde hay que
 * enviar la respuesta. El `sender.id` es el usuario que escribe.
 *
 * @param {object} payload Payload completo del webhook.
 * @returns {Array<object>} Lista de mensajes normalizados.
 */
function parseInstagramMessages(payload) {
  const out = [];

  for (const entry of payload?.entry || []) {
    // El ig-user-id de la PROPIA cuenta llega en entry[].id. Es el id con el
    // que hay que hacer POST /{ig-user-id}/messages para responder. No se
    // puede adivinar ni descubrir por API: hay que tomarlo del webhook.
    const igUserId = entry.id || null;
    rememberIgUserId(igUserId);

    // `messaging` es la clave de Instagram; `changes` es la de WhatsApp.
    for (const messaging of entry.messaging || []) {
      const message = messaging.message || {};
      if (message.is_echo) continue; // eco de un mensaje que envio la app

      // Los mensajes de texto vienen en message.text. Los de imagen/audio/etc.
      // tienen otros campos y no son scope de este agente.
      if (!message.text || !message.text.trim()) continue;

      out.push({
        messageId: message.mid || null,
        from: messaging.sender?.id || null,
        profileName: null,
        text: String(message.text).trim(),
        timestamp: messaging.timestamp ? Number(messaging.timestamp) : null,
        // Para Instagram el destinatario es el IG Account ID.
        // Segun el payload oficial de Meta:
        //   sender.id    -> Instagram-scoped ID del CLIENTE que escribio (destinatario de la respuesta)
        //   recipient.id -> ID de NUESTRA cuenta de negocio
        // Responder a recipient.id seria mandarse un mensaje a uno mismo.
        customerId: messaging.sender?.id || null,
        // ig-user-id de la cuenta de negocio: es el id en el path del endpoint de envio.
        igUserId: igUserId || messaging.recipient?.id || null,
        rawType: "text",
      });
    }
  }

  return out;
}

/**
 * Envia un mensaje de texto por Instagram Messaging API.
 *
 * Hay dos formas equivalentes segun como se configuro la app:
 *  - `POST /me/messages`             -> Facebook Login / Unified Login (usa el token)
 *  - `POST /{IG_ACCOUNT_ID}/messages` -> cuando se tiene el IG Account ID
 *
 * Se usa la primera por defecto y la segunda si se configura
 * META_INSTAGRAM_ACCOUNT_ID.
 *
 * A diferencia de WhatsApp, Instagram no tiene ventana de atencion de 24h:
 * se puede responder cuando se quiera. Aun asi, Meta aplica la politica de
 * la cuenta: responder fuera de la ventana requiere estar en Advanced Access
 * con el feature Human Agent habilitado.
 *
 * @param {string} recipientId IGSID del destinatario (quien escribio).
 * @param {string} body Texto del mensaje (max 1000 caracteres).
 * @param {object} [options] Opciones: { accessToken, graphVersion, accountId }.
 * @returns {Promise<{ok: boolean, status: number, data?: object, error?: string}>}
 */
async function sendInstagramMessage(recipientId, body, options = {}) {
  const accessToken = options.accessToken || process.env.META_ACCESS_TOKEN;
  const graphVersion = options.graphVersion || GRAPH_VERSION;
  // El ig-user-id puede venir del webhook (entry[].id) o de la env.
  const accountId =
    options.accountId || options.igUserId || cachedIgUserId || process.env.META_INSTAGRAM_ACCOUNT_ID;

  if (!isConfigured(recipientId) || !isConfigured(accessToken)) {
    return {
      ok: false,
      status: 500,
      error: "IGSID del destinatario o META_ACCESS_TOKEN no configurados",
    };
  }

  if (!isConfigured(accountId)) {
    return {
      ok: false,
      status: 500,
      error:
        "No se conoce el ig-user-id de la cuenta. Llega en entry[].id del webhook; " +
        "configura META_INSTAGRAM_ACCOUNT_ID como fallback.",
    };
  }

  // Con ig-user-id se usa /{ig-user-id}/messages (endpoint de Instagram
  // Messaging). /me/messages corresponde al flujo de Facebook Login.
  const url = `https://graph.facebook.com/${graphVersion}/${accountId}/messages`;

  // Meta aplica limites de envio por app. Cuando se superan responde
  //   (#4) Application request limit reached  con is_transient=true
  // que es un error temporal: reintentar con backoff suele funcionar.
  const maxAttempts = Number(process.env.META_SEND_MAX_ATTEMPTS || 3);
  const backoffMs = Number(process.env.META_SEND_BACKOFF_MS || 5000);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await postInstagramMessage(url, recipientId, body, accessToken);
    if (result.ok) return result;

    const transient =
      result.data?.error?.is_transient === true || result.data?.error?.code === 4;
    if (!transient || attempt === maxAttempts) return result;

    const wait = backoffMs * attempt;
    console.warn(
      `[instagram] envio limitado por Meta (intento ${attempt}/${maxAttempts}), ` +
        `reintentando en ${wait}ms`
    );
    await new Promise((resolve) => setTimeout(resolve, wait));
  }

  return { ok: false, status: 0, error: "sin intentos de envio disponibles" };
}

/**
 * Hace un POST a /{ig-user-id}/messages y normaliza la respuesta.
 */
async function postInstagramMessage(url, recipientId, body, accessToken) {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      // El body sigue el formato oficial de Instagram Messaging:
      //   { recipient: { id: "<IGSID del cliente>" }, message: { text: "..." } }
      body: JSON.stringify({
        recipient: { id: String(recipientId) },
        message: { text: String(body).slice(0, 1000) },
      }),
      signal: AbortSignal.timeout(META_TIMEOUT_MS),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const detail =
        data?.error?.message || data?.error?.error_user_msg || `HTTP ${response.status}`;
      const subcode = data?.error?.error_subcode;
      let hint = "";
      if (subcode === 33) {
        hint =
          " | Suele indicar que al token le falta pages_manage_metadata " +
          "(o pages_messaging) o que el ig-user-id no es el de la cuenta.";
      } else if (subcode === 2534014) {
        hint =
          " | No se encontro al destinatario. En Instagram solo se puede " +
          "responder a alguien que ya te escribio (debe existir una conversacion).";
      } else if (data?.error?.code === 4) {
        hint =
          " | Limite de envio de la app alcanzado (error transitorio). " +
          "Reintenta en unos minutos o revisa el modo de la app en Meta.";
      }
      return { ok: false, status: response.status, data, error: detail + hint };
    }

    return { ok: true, status: response.status, data };
  } catch (error) {
    return { ok: false, status: 0, error: error.message };
  }
}

/**
 * Envia un mensaje de texto por WhatsApp Cloud API.
 *
 * Solo funciona dentro de la ventana de atencion de 24h abierta por el
 * cliente. Fuera de ella, Meta rechaza el mensaje y exige una plantilla
 * aprobada.
 *
 * @param {string} to Numero del destinatario en formato internacional (sin +).
 * @param {string} body Texto del mensaje.
 * @param {object} [options] Opciones: { phoneNumberId, accessToken, graphVersion }.
 * @returns {Promise<{ok: boolean, status: number, data?: object, error?: string}>}
 */
async function sendTextMessage(to, body, options = {}) {
  const phoneNumberId = options.phoneNumberId || process.env.META_PHONE_NUMBER_ID;
  // El token de WhatsApp puede ser distinto al de Instagram. Si esta
  // configurado, se usa ese; si no, se cae al token general.
  const accessToken =
    options.accessToken ||
    process.env.META_WHATSAPP_TOKEN ||
    process.env.META_ACCESS_TOKEN;
  const graphVersion = options.graphVersion || GRAPH_VERSION;

  if (!isConfigured(phoneNumberId) || !isConfigured(accessToken)) {
    return {
      ok: false,
      status: 500,
      error: "META_PHONE_NUMBER_ID o META_ACCESS_TOKEN no configurados (placeholder o vacio)",
    };
  }

  const cleanTo = String(to).replace(/\D/g, "");
  const url = `https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: cleanTo,
        type: "text",
        text: { body: String(body).slice(0, 4096) },
      }),
      signal: AbortSignal.timeout(META_TIMEOUT_MS),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const detail =
        data?.error?.message || data?.error?.error_user_msg || `HTTP ${response.status}`;
      const subcode = data?.error?.error_subcode;
      let hint = "";
      if (subcode === 33) {
        hint =
          " | Suele indicar que al token le falta pages_manage_metadata " +
          "(o pages_messaging) o que el ig-user-id no es el de la cuenta.";
      } else if (subcode === 2534014) {
        hint =
          " | No se encontro al destinatario. En Instagram solo se puede " +
          "responder a alguien que ya te escribio (debe existir una conversacion).";
      }
      return { ok: false, status: response.status, data, error: detail + hint };
    }

    return { ok: true, status: response.status, data };
  } catch (error) {
    return { ok: false, status: 0, error: error.message };
  }
}

module.exports = {
  GRAPH_VERSION,
  isConfigured,
  rememberIgUserId,
  getIgUserId: () => cachedIgUserId,
  verifyMetaSignature,
  handleVerification,
  parseInboundMessages,
  parseInstagramMessages,
  sendTextMessage,
  sendInstagramMessage,
};
