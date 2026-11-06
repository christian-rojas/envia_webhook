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
  sendTextMessage,
};
