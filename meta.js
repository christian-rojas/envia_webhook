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
        instagramAccountId: messaging.recipient?.id || entry.id || null,
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
  const accountId = options.accountId || process.env.META_INSTAGRAM_ACCOUNT_ID;

  if (!isConfigured(recipientId) || !isConfigured(accessToken)) {
    return {
      ok: false,
      status: 500,
      error: "IGSID del destinatario o META_ACCESS_TOKEN no configurados",
    };
  }

  // Con IG Account ID se usa /{id}/messages; si no, /me/messages.
  const target = isConfigured(accountId) ? accountId : "me";
  const url = `https://graph.facebook.com/${graphVersion}/${target}/messages`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        recipient: { id: String(recipientId) },
        message: { text: String(body).slice(0, 1000) },
        messaging_type: "RESPONSE",
      }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const detail =
        data?.error?.message || data?.error?.error_user_msg || `HTTP ${response.status}`;
      return { ok: false, status: response.status, data, error: detail };
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
  const accessToken = options.accessToken || process.env.META_ACCESS_TOKEN;
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
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const detail =
        data?.error?.message || data?.error?.error_user_msg || `HTTP ${response.status}`;
      return { ok: false, status: response.status, data, error: detail };
    }

    return { ok: true, status: response.status, data };
  } catch (error) {
    return { ok: false, status: 0, error: error.message };
  }
}

module.exports = {
  GRAPH_VERSION,
  isConfigured,
  verifyMetaSignature,
  handleVerification,
  parseInboundMessages,
  parseInstagramMessages,
  sendTextMessage,
  sendInstagramMessage,
};
