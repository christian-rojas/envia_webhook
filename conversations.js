/**
 * Historial de conversaciones de Instagram y WhatsApp.
 *
 * Meta expone las conversaciones (Instagram DM y WhatsApp) por la Graph API:
 *
 *   GET /{ig-user-id}/conversations
 *       ?platform=instagram
 *       &fields=id,participants{id,username},messages{message,from{id,username},created_time}
 *
 * Sirve para que el bot entienda el contexto: que NO vuelva a pedir el
 * numero de pedido si ya se lo dieron, que no salude tres veces, que no
 * repita lo que ya respondio y que se calle si un asesor humano esta
 * hablando con el cliente.
 *
 * LIMITES QUE IMPORTAN (aprendidos a la fuerza):
 *   1. El maximo de `limit` es 25 (con 50 devuelve 0 conversaciones).
 *   2. Pedir `messages` de las 25 conversaciones de una vez falla con
 *      "Please reduce the amount of data you're asking for". Por eso se
 *      pide de 10 en 10 y se pagina.
 *   3. El campo de texto es `message`, no `text`.
 *   4. El limite de llamadas de la app es BAJO. Pedir el detalle de un
 *      hilo (`GET /{conversation-id}`) agota el cuota rapidisimo
 *      ("Application request limit reached"), mientras que la lista de 10
 *      hilos con sus mensajes entra sin problema. Por eso TODO se lee con
 *      la lista paginada y se cachea: 3 llamadas cada 15 minutos en vez de
 *      2 por cada mensaje del cliente.
 *
 * En Instagram el remitente se identifica por su id de Instagram, que
 * coincide EXACTO con el participante del hilo. En WhatsApp el remitente es
 * un telefono y Meta expone al cliente por su identidad de Instagram, asi
 * que ahi se busca por el texto del mensaje o por el pedido que ya dio.
 */

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v27.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

// En local carga el .env; en Vercel no hace nada (no hay archivo .env).
try {
  require("dotenv").config();
} catch {
  /* dotenv es opcional */
}

/** Nuestra propia cuenta (el bot). */
const OUR_ID = process.env.META_INSTAGRAM_ACCOUNT_ID || "17841408417156397";
const OUR_USERNAME = process.env.META_INSTAGRAM_USERNAME || "mondano.cl";

/** Cuanto tiempo se cachea la lista de hilos (con sus mensajes). */
const CACHE_MS = Number(process.env.CONVOS_CACHE_MS || 15 * 60 * 1000);

/** Cuantos mensajes de historico se le pasan al modelo. */
const HISTORY_MESSAGES = Number(process.env.CONVOS_HISTORY_MSGS || 16);

/** Cuantos hilos se revisan en detalle como maximo (para no gastar cuota). */
const MAX_HILOS_DETALLE = Number(process.env.CONVOS_MAX_HILOS || 12);

/** Cuantos hilos se bajan por pagina (10 es lo que aguanta el limite de datos). */
const PAGINA = Number(process.env.CONVOS_PAGINA || 10);

/** Cuantos hilos se bajan en total. */
const MAX_HILOS = Number(process.env.CONVOS_MAX_HILOS_TOTAL || 25);

/**
 * Cada llamada a la Graph API cuenta para el limite de la app. Con varias
 * peticiones seguidas se llega al tope y empieza a fallar con:
 *
 *   (#4) Application request limit reached
 *
 * Se serializan las llamadas: nunca hay dos con menos de este intervalo.
 */
const MIN_INTERVALO_MS = Number(process.env.GRAPH_MIN_INTERVALO_MS || 1500);
let ultimaLlamada = 0;

let listaCache = null; // { at, conversaciones }

/**
 * Espera a que se pueda hacer la siguiente llamada a la Graph API.
 *
 * @returns {Promise<void>}
 */
async function esperarTurno() {
  const ahora = Date.now();
  const espera = ultimaLlamada + MIN_INTERVALO_MS - ahora;
  if (espera > 0) {
    await new Promise((r) => setTimeout(r, espera));
  }
  ultimaLlamada = Date.now();
}

/**
 * Llama a la Graph API con una URL completa.
 *
 * @param {string} url Completa (incluye el access_token).
 * @returns {Promise<object>}
 */
async function graphFetchUrl(url) {
  await esperarTurno();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const data = await response.json().catch(() => ({}));
    if (data.error) {
      throw new Error(`Graph: ${data.error.message || "error"}`.slice(0, 200));
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

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
  return graphFetchUrl(url.toString());
}

/**
 * Campos que se piden: los mensajes de cada hilo y quienes lo participan.
 */
const CAMPOS =
  "id,participants{id,username}," +
  "messages{message,from{id,username},created_time}";

/**
 * Lista los hilos con sus mensajes, paginando de 10 en 10.
 *
 * @param {object} [options] { fresh }
 * @returns {Promise<object[]>} Conversaciones.
 */
async function listConversations({ fresh = false } = {}) {
  if (!fresh && listaCache && Date.now() - listaCache.at < CACHE_MS) {
    return listaCache.conversaciones;
  }

  const url = new URL(`${GRAPH_BASE}/${OUR_ID}/conversations`);
  url.searchParams.set("platform", "instagram");
  url.searchParams.set("fields", CAMPOS);
  url.searchParams.set("limit", String(PAGINA));
  url.searchParams.set(
    "access_token",
    process.env.META_ACCESS_TOKEN || process.env.META_WHATSAPP_TOKEN
  );

  const conversaciones = [];
  let siguiente = url.toString();

  // Pagina hasta tener los hilos o hasta que se acaben.
  while (siguiente && conversaciones.length < MAX_HILOS) {
    const data = await graphFetchUrl(siguiente);
    conversaciones.push(...(data.data || []));
    siguiente = data.paging?.next || null;
  }

  listaCache = { at: Date.now(), conversaciones };
  const mensajes = conversaciones.reduce(
    (s, c) => s + ((c.messages?.data || []).length),
    0
  );
  console.log(
    `[conversaciones] ${conversaciones.length} hilos, ${mensajes} mensajes`
  );
  return conversaciones;
}

/**
 * Trae los mensajes de UN hilo.
 *
 * Sale de la cache (la lista paginada ya los trae). Si el hilo no esta en
 * cache se pide el detalle puntual (una sola llamada).
 *
 * @param {string} conversationId Id del hilo.
 * @returns {Promise<object[]>} Mensajes.
 */
async function getThreadMessages(conversationId) {
  if (!conversationId) return [];

  if (listaCache && Date.now() - listaCache.at < CACHE_MS) {
    const hilo = listaCache.conversaciones.find((h) => h.id === conversationId);
    if (hilo) return hilo.messages?.data || [];
  }

  const data = await graphFetch(conversationId, {
    fields: "id,messages{message,from{id,username},created_time}",
  });
  return data.messages?.data || [];
}

/**
 * Busca la conversacion de un cliente.
 *
 * @param {object} params
 * @param {string} [params.senderId] IGSID del remitente (Instagram).
 * @param {string} [params.text] Texto del mensaje actual.
 * @param {string} [params.orderId] Numero de pedido ya conocido.
 * @returns {Promise<object|null>} { id, messages }
 */
async function findConversation({ senderId, text, orderId } = {}) {
  const hilos = await listConversations();

  // 1) Instagram: el id del remitente es EXACTO el participante del hilo.
  if (senderId) {
    const hilo = hilos.find((h) =>
      (h.participants?.data || []).some((p) => String(p.id) === String(senderId))
    );
    if (hilo) {
      const messages = hilo.messages?.data || [];
      if (messages.length) return { id: hilo.id, messages };
    }
  }

  const texto = (text || "").trim();
  const pedido = (orderId || "").trim();
  if (!texto && !pedido) return null;

  // 2) WhatsApp: el remitente es un telefono y Meta lo expone por su
  // identidad de Instagram. Se buscan los hilos revisando el detalle de
  // algunos (con tope, para no gastar cuota).
  const candidatos = hilos.slice(0, MAX_HILOS_DETALLE);
  for (const candidato of candidatos) {
    const mensajes = candidato.messages?.data || [];
    if (!mensajes.length) continue;

    if (texto.length >= 6) {
      const hit = mensajes.some(
        (m) => String(m.message || "").trim() === texto
      );
      if (hit) return { id: candidato.id, messages };
    }

    if (pedido) {
      const re = new RegExp(
        pedido.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "i"
      );
      const hit = mensajes.some((m) => re.test(String(m.message || "")));
      if (hit) return { id: candidato.id, messages };
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
  MAX_HILOS_DETALLE,
  PAGINA,
  MAX_HILOS,
  CACHE_MS,
  MIN_INTERVALO_MS,
  graphFetch,
  graphFetchUrl,
  listConversations,
  getThreadMessages,
  findConversation,
  formatHistory,
  findOrderIdInHistory,
  alreadyGreeted,
};
