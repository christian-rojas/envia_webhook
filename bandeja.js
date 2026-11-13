/**
 * Lector de la bandeja de Instagram.
 *
 * La bandeja tiene tres carpetas: Primary (seguidores), General (despues de
 * que la cuenta responde) y Requests (los que no siguen a la cuenta).
 * Meta no expone un endpoint por carpeta: `/{ig-user-id}/messages` solo
 * existe en el login de Instagram, no en el de Facebook. La conexion
 * `/{ig-user-id}/conversations` trae TODAS las carpetas, asi que el
 * detector de "sin responder" se hace sobre los hilos.
 *
 * Reglas de Meta que importan:
 *   - Un mensaje no se marca como leido hasta que se responde.
 *   - Los mensajes de Requests con mas de 30 dias sin actividad no se
 *     devuelven en las llamadas a la API.
 */

const conversations = require("./conversations.js");

/** Cuanto tiempo se cachea la bandeja. */
const BANDEJA_CACHE_MS = Number(process.env.BANDEJA_CACHE_MS || 60000);

/**
 * Instagram solo deja responder dentro de las 24 h desde el ultimo mensaje
 * del cliente (error 2534022 / #10 fuera de la ventana). No tiene sentido
 * intentar con mensajes viejos: fallan y ensucian el log.
 */
const MAX_EDAD_HORAS = Number(process.env.BANDEJA_MAX_HORAS || 23);

/**
 * Cuantos hilos se revisan en detalle como maximo.
 *
 * Cada detalle es una llamada a la Graph API y el limite de la app es bajo
 * (con 25 seguidas sale "Application request limit reached"), asi que se
 * revisan solo los hilos mas recientes.
 */
const MAX_HILOS = Number(process.env.BANDEJA_MAX_HILOS || 10);

let cache = null;

/**
 * Trae los hilos recientes de la bandeja.
 *
 * @param {object} [options] { fresh }
 * @returns {Promise<object[]>} Conversaciones.
 */
async function listInboxMessages({ fresh = false } = {}) {
  if (!fresh && cache && Date.now() - cache.at < BANDEJA_CACHE_MS) {
    return cache.conversations;
  }
  const hilos = await conversations.listConversations({ fresh });
  cache = { at: Date.now(), conversations: hilos };
  return hilos;
}

/**
 * Devuelve los mensajes de clientes a los que NO se les ha contestado.
 *
 * Se mira el ultimo mensaje de cada hilo: si es del cliente (no nuestro) y
 * tiene texto, es una mensaje sin responder.
 *
 * @param {object} [options] { fresh }
 * @returns {Promise<object[]>} [{ conversationId, mensaje }]
 */
async function findUnanswered({ fresh = false } = {}) {
  const hilos = await listInboxMessages({ fresh });
  const pendientes = [];

  // La lista viene ligera (id + participantes): los mensajes hay que
  // pedirlos hilo por hilo.
  for (const hilo of hilos.slice(0, MAX_HILOS)) {
    let mensajes = [];
    try {
      mensajes = await conversations.getThreadMessages(hilo.id);
    } catch (error) {
      console.warn(
        `[bandeja] no se pudo leer el hilo ${hilo.id}: ${error.message}`
      );
      continue;
    }

    const ordenados = [...mensajes].sort((a, b) =>
      String(a.created_time).localeCompare(String(b.created_time))
    );
    if (!ordenados.length) continue;

    const ultimo = ordenados[ordenados.length - 1];
    // Si el ultimo mensaje es nuestro, ya respondimos.
    if (String(ultimo.from?.id || "") === String(conversations.OUR_ID)) continue;
    const texto = String(ultimo.message || "").trim();
    if (!texto) continue;

    // Solo si es reciente (dentro de la ventana de 24 h de Instagram).
    const edad = Date.now() - Date.parse(ultimo.created_time || 0);
    if (!Number.isFinite(edad) || edad > MAX_EDAD_HORAS * 3600 * 1000) continue;

    pendientes.push({
      conversationId: hilo.id,
      mensaje: {
        id: ultimo.id,
        from: ultimo.from || {},
        texto,
        createdTime: ultimo.created_time || null,
        esNuestro: false,
        esEco: false,
      },
    });
  }

  // Del mas reciente al mas antiguo.
  pendientes.sort((a, b) =>
    String(b.mensaje.createdTime).localeCompare(String(a.mensaje.createdTime))
  );
  return pendientes;
}

/**
 * Convierte un mensaje de la bandeja al formato que espera el handler.
 *
 * @param {object} mensaje Mensaje de la bandeja.
 * @returns {object} Mensaje normalizado (como el webhook).
 */
function toInboundMessage(mensaje) {
  const from = mensaje.from?.id || null;
  return {
    messageId: mensaje.id,
    from,
    // El handler usa customerId para buscar el hilo y la memoria del bot:
    // sin esto, la bandeja no encuentra la conversacion ni el pedido.
    customerId: from,
    profileName: mensaje.from?.username || null,
    text: mensaje.texto,
    timestamp: mensaje.createdTime ? Date.parse(mensaje.createdTime) : null,
    phoneNumberId: null,
    displayPhoneNumber: null,
    rawType: "text",
  };
}

module.exports = {
  MAX_EDAD_HORAS,
  MAX_HILOS,
  listInboxMessages,
  findUnanswered,
  toInboundMessage,
  BANDEJA_CACHE_MS,
};
