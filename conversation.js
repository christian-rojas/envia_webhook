/**
 * Memoria de conversacion del bot.
 *
 * Guarda, por cliente, el ultimo pedido (MON-XXXX) o telefono que nos dio,
 * para que en los mensajes siguientes ("hola", "y cuando llega?") no tenga
 * que repetirlo.
 *
 * IMPLEMENTACION ACTUAL: memoria en el proceso (Map).
 *   - Vercel reutiliza la instancia mientras hay trafico, asi que en la
 *     practica aguanta una conversacion completa.
 *   - En un cold start se pierde. Por eso el bot SIEMPRE vuelve a pedir el
 *     dato si no lo tiene: nunca se queda mudo por perder el estado.
 *
 * PARA HACERLO DURABLE: reemplazar el Map por una tabla de Supabase.
 * La interfaz es la misma (get / remember / forget), asi que el resto del
 * codigo no cambia. La tabla podria ser:
 *
 *   create table bot_conversations (
 *     id bigint generated always as identity primary key,
 *     channel text not null,          -- 'instagram' | 'whatsapp'
 *     customer_key text not null,     -- IGSID o telefono
 *     order_id text,
 *     phone text,
 *     updated_at timestamptz not null default now()
 *   );
 *   create unique index on bot_conversations (channel, customer_key);
 */

/** Tiempo que se recuerda el contexto de un cliente. */
const TTL_MS = Number(process.env.BOT_MEMORY_TTL_MS || 30 * 60 * 1000); // 30 min

/** Map<clave, {orderId, phone, seenAt}> */
const store = new Map();

/**
 * Limpia las entradas vencidas. Se llama en cada escritura para que el Map
 * no crezca sin control.
 */
function purgeExpired() {
  const now = Date.now();
  for (const [key, value] of store) {
    if (now - value.seenAt > TTL_MS) store.delete(key);
  }
}

/**
 * Devuelve el contexto guardado para un cliente (o null).
 *
 * @param {string} key Identificador del cliente (IGSID o telefono).
 * @returns {{orderId: string|null, phone: string|null}|null}
 */
function get(key) {
  if (!key) return null;
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() - entry.seenAt > TTL_MS) {
    store.delete(key);
    return null;
  }
  return { orderId: entry.orderId || null, phone: entry.phone || null };
}

/**
 * Guarda (o actualiza) el contexto de un cliente.
 *
 * @param {string} key Identificador del cliente.
 * @param {object} patch { orderId, phone }
 * @returns {void}
 */
function remember(key, patch = {}) {
  if (!key) return;
  purgeExpired();

  const current = store.get(key) || { orderId: null, phone: null };
  store.set(key, {
    orderId: patch.orderId || current.orderId || null,
    phone: patch.phone || current.phone || null,
    seenAt: Date.now(),
  });
}

/**
 * Olvida el contexto de un cliente (por ejemplo, si se equivoco de pedido).
 *
 * @param {string} key Identificador del cliente.
 * @returns {void}
 */
function forget(key) {
  if (key) store.delete(key);
}

module.exports = { get, remember, forget, TTL_MS };
