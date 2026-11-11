/**
 * Historial de conversaciones de Instagram y WhatsApp.
 *
 * Meta expone las conversaciones (Instagram DM y WhatsApp) por la Graph API:
 *
 *   GET /{ig-user-id}/conversations
 *       ?platform=instagram
 *       &fields=id,messages{message,from{id,username},created_time}
 *
 * Sirve para que el bot entienda el contexto: que NO vuelva a pedir el
 * numero de pedido si ya se lo dieron, que no salude tres veces, y que no
 * repita lo que ya respondio.
 *
 * OJO con dos limites de la API:
 *   - El maximo de `limit` es 25 (con 50 devuelve 0 conversaciones).
 *   - `platform` se ignora: devuelve Instagram y WhatsApp mezclados. Los
 *     participantes de WhatsApp aparecen con su usuario de Instagram (cuando
 *     lo tienen vinculado).
 */

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v27.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

/** Nuestra propia cuenta (el bot). */
const OUR_ID = process.env.META_INSTAGRAM_ACCOUNT_ID || "17841408417156397";
const OUR_USERNAME = process.env.META_INSTAGRAM_USERNAME || "mondano.cl";

/** Cuanto tiempo se cachea la lista de conversaciones. */
const CACHE_MS = Number(process.env.CONVOS_CACHE_MS || 60000);

/** Quantos mensajes de historico se le pasan al modelo. */
const HISTORY_MESSAGES = Number(process.env.CONVOS_HISTORY_MSGS || 16);

let cache = null; // { at, conversations }
let cacheInFlight = null;

/**
 * Llama a la Graph API de Meta.
 *
 * @param {string} path Ruta (ej: "17841408417156397/conversations").
 * @param {object} [params] Parametros de query.
 * @returns {Promise<object>}
 */
async function graphFetch(path, params = {}) {
  const url = new URL(`${GRAPH_BASE}/${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  url.searchParams.set(
    "access_token",
    process.env.META_ACCESS_TOKEN || process.env.META_WHATSAPP_TOKEN
  );

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const data = await response.json().catch(() => ({}));
    if (data.error) {
      throw new Error(
        `Graph ${path}: ${data.error.message || "error"}`.slice(0, 200)
      );
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Trae las conversaciones recientes (con cache).
 *
 * @param {object} [options] { fresh } ignora la cache.
 * @returns {Promise<Array>} Lista de conversaciones con sus mensajes.
 */
async function listConversations({ fresh = false } = {}) {
  if (!fresh && cache && Date.now() - cache.at < CACHE_MS) {
    return cache.conversations;
  }

  if (cacheInFlight) {
    await cacheInFlight;
    if (!fresh && cache) return cache.conversations;
  }

  cacheInFlight = (async () => {
    const data = await graphFetch(`${OUR_ID}/conversations`, {
      platform: "instagram",
      fields: "id,messages{message,from{id,username},created_time}",
      limit: 25,
    });
    const conversations = data.data || [];
    cache = { at: Date.now(), conversations };
    console.log(`[conversaciones] ${conversations.length} conversaciones`);
  })().finally(() => {
    cacheInFlight = null;
  });

  await cacheInFlight;
  return cache ? cache.conversations : [];
}

/**
 * Busca la conversacion de un cliente.
 *
 * Hay tres formas de identificarla, en este orden:
 *   1) Por el id de Instagram del remitente (exacto, canal Instagram).
 *   2) Por el texto exacto del mensaje que acaba de llegar (funciona en
 *      WhatsApp, donde el id de la Graph API no es el telefono).
 *   3) Por un numero de pedido que el cliente ya haya dado en la conversacion.
 *
 * @param {object} params
 * @param {string} [params.senderId] IGSID del remitente (Instagram).
 * @param {string} [params.text] Texto del mensaje actual.
 * @param {string} [params.orderId] Numero de pedido ya conocido.
 * @returns {Promise<object|null>} { id, messages } o null.
 */
async function findConversation({ senderId, text, orderId } = {}) {
  let conversations = await listConversations();

  let found = matchConversation(conversations, { senderId, text, orderId });

  // El mensaje actual puede no estar todavia en la cache: se refresca una vez.
  if (!found && text) {
    conversations = await listConversations({ fresh: true });
    found = matchConversation(conversations, { senderId, text, orderId });
  }

  if (!found) return null;

  const messages = [...(found.messages || [])].sort(
    (a, b) => String(a.created_time).localeCompare(String(b.created_time))
  );

  return { id: found.id, messages };
}

/**
 * Busca el hilo que corresponde a un cliente dentro de las conversaciones.
 *
 * @param {Array} conversations Conversaciones.
 * @param {object} params { senderId, text, orderId }
 * @returns {object|null}
 */
function matchConversation(conversations, { senderId, text, orderId } = {}) {
  // 1) Id exacto de Instagram.
  if (senderId) {
    for (const conv of conversations) {
      const esCliente = (conv.messages?.data || []).some(
        (m) => String(m.from?.id || "") === String(senderId)
      );
      if (esCliente) return conv;
    }
  }

  const texto = (text || "").trim();
  const pedido = (orderId || "").trim();

  // 2) Texto exacto del mensaje actual.
  if (texto.length >= 6) {
    for (const conv of conversations) {
      const hit = (conv.messages?.data || []).some(
        (m) => String(m.message || "").trim() === texto
      );
      if (hit) return conv;
    }
  }

  // 3) Numero de pedido que el cliente ya dio en el hilo.
  if (pedido) {
    const re = new RegExp(pedido.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    for (const conv of conversations) {
      const hit = (conv.messages?.data || []).some((m) =>
        re.test(String(m.message || ""))
      );
      if (hit) return conv;
    }
  }

  return null;
}

/**
 * Formatea el historial para mandarlo al modelo.
 *
 * @param {Array} messages Mensajes del hilo.
 * @param {object} [options] { max }
 * @returns {string}
 */
function formatHistory(messages, { max = HISTORY_MESSAGES } = {}) {
  const ultimos = (messages || []).slice(-max);
  if (!ultimos.length) return "";

  const lineas = ultimos.map((m) => {
    const delBot = String(m.from?.id || "") === String(OUR_ID);
    const quien = delBot ? "nosotros" : `cliente (${m.from?.username || "?"})`;
    const texto = String(m.message || "").replace(/\s+/g, " ").trim();
    return `${quien}: ${texto}`;
  });

  return (
    `HISTORIAL DE LA CONVERSACION (mensajes anteriores, del mas antiguo al mas nuevo):\n` +
    lineas.map((l) => `- ${l}`).join("\n")
  );
}

/**
 * Saca del historial los numeros de pedido que el cliente ya dio.
 *
 * @param {Array} messages Mensajes del hilo.
 * @returns {string|null} Primer numero de pedido encontrado.
 */
function findOrderIdInHistory(messages) {
  for (const m of messages || []) {
    // Solo los mensajes DEL CLIENTE: nuestros textos mencionan el formato
    // de ejemplo (MON3007) y no son un pedido real.
    if (String(m.from?.id || "") === String(OUR_ID)) continue;
    const hit = String(m.message || "").match(/\bMON[\s\-_]*(\d{3,})\b/i);
    if (hit) return `MON${hit[1]}`;
  }
  return null;
}

/**
 * Detecta si el bot ya saludo en este hilo (para no saludar otra vez).
 *
 * @param {Array} messages Mensajes del hilo.
 * @returns {boolean}
 */
function alreadyGreeted(messages) {
  return (messages || []).some((m) => {
    if (String(m.from?.id || "") !== String(OUR_ID)) return false;
    return /gracias por comunicarte|hola\b/i.test(String(m.message || ""));
  });
}

module.exports = {
  OUR_ID,
  OUR_USERNAME,
  HISTORY_MESSAGES,
  graphFetch,
  listConversations,
  findConversation,
  matchConversation,
  formatHistory,
  findOrderIdInHistory,
  alreadyGreeted,
};
