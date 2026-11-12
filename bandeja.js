/**
 * Lector de la bandeja de Instagram.
 *
 * La bandeja tiene tres carpetas: Primary (seguidores), General (despues de
 * que la cuenta responde) y Requests (los que no siguen a la cuenta).
 *
 * El webhook entrega los mensajes de todas las carpetas, pero Meta deja
 * cosas afuera: "los mensajes en Requests que llevan 30 dias sin actividad no
 * se devuelven en las llamadas a la API" y un mensaje no se marca como leido
 * hasta que se responde.
 *
 * Este lector es una red de seguridad: revisa la bandeja y responde lo que
 * haya quedado sin contestar. Se puede llamar desde un cron.
 */

const conversations = require("./conversations.js");

/** Cuanto tiempo se cachea la bandeja. */
const BANDEJA_CACHE_MS = Number(process.env.BANDEJA_CACHE_MS || 60000);

/** Quantos mensajes mira por pasada. */
const BANDEJA_LIMIT = Number(process.env.BANDEJA_LIMIT || 25);

let cache = null;

/**
 * Trae los mensajes recientes de la bandeja.
 *
 * @param {object} [options] { fresh }
 * @returns {Promise<object[]>} Mensajes normalizados.
 */
async function listInboxMessages({ fresh = false } = {}) {
  if (!fresh && cache && Date.now() - cache.at < BANDEJA_CACHE_MS) {
    return cache.messages;
  }

  const data = await conversations.graphFetch(
    `${conversations.OUR_ID}/messages`,
    {
      fields: "id,from{id,username},message,created_time,is_echo",
      limit: BANDEJA_LIMIT,
    }
  );

  const mensajes = (data.data || []).map((m) => ({
    id: m.id,
    from: m.from || {},
    texto: String(m.message || "").trim(),
    createdTime: m.created_time || null,
    esNuestro: String(m.from?.id || "") === String(conversations.OUR_ID),
    esEco: Boolean(m.is_echo),
  }));

  cache = { at: Date.now(), messages: mensajes };
  console.log(`[bandeja] ${mensajes.length} mensajes`);
  return mensajes;
}

/**
 * Devuelve los mensajes de clientes que NO tienen una respuesta nuestra
 * despues.
 *
 * @param {object} [options] { fresh }
 * @returns {Promise<object[]>}
 */
async function findUnanswered({ fresh = false } = {}) {
  const mensajes = await listInboxMessages({ fresh });
  const ultimoNuestro = new Map();

  for (const m of mensajes) {
    if (m.esNuestro) {
      const clave = m.from?.id;
      if (clave) ultimoNuestro.set(clave, m.createdTime);
    }
  }

  const sinResponder = [];
  for (const m of mensajes) {
    if (m.esNuestro || m.esEco || !m.texto) continue;
    const clave = m.from?.id;
    if (!clave) continue;
    const nuestra = ultimoNuestro.get(clave);
    if (!nuestra || String(m.createdTime) > String(nuestra)) {
      sinResponder.push(m);
    }
  }

  // Del mas reciente al mas antiguo.
  sinResponder.sort((a, b) => String(b.createdTime).localeCompare(String(a.createdTime)));
  return sinResponder;
}

/**
 * Convierte un mensaje de la bandeja al formato que espera el handler.
 *
 * @param {object} mensaje Mensaje de la bandeja.
 * @returns {object} Mensaje normalizado (como el webhook).
 */
function toInboundMessage(mensaje) {
  return {
    messageId: mensaje.id,
    from: mensaje.from?.id || null,
    profileName: mensaje.from?.username || null,
    text: mensaje.texto,
    timestamp: mensaje.createdTime ? Date.parse(mensaje.createdTime) : null,
    phoneNumberId: null,
    displayPhoneNumber: null,
    rawType: "text",
  };
}

module.exports = {
  listInboxMessages,
  findUnanswered,
  toInboundMessage,
  BANDEJA_LIMIT,
};
