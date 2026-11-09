/**
 * Resolucion de pedidos y estado de envio.
 *
 * Flujo: numero de telefono -> pedido en Supabase -> tracking -> estado en Envia.
 *
 * Nota sobre el mapeo de telefonos:
 *  - `order_tracking.order_id` guarda el ID de Shopify con prefijo ("MON3007").
 *  - El telefono del cliente vive en el envio de Envia (`destination.phone`), que
 *    es la unica fuente consultable sin depender de una tabla de pedidos.
 *  - `shipping_addresses.phone` guarda el telefono de la direccion de envio, pero
 *    no esta enlazada a `order_tracking`, asi que se usa como respaldo.
 */

const { createClient } = require("@supabase/supabase-js");
const dotenv = require("dotenv");
const { combineSignals } = require("./abort.js");

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Desde Vercel la conexion directa a Supabase a veces se queda colgada
// (la instancia es nueva, hay que resolver DNS y abrir el socket). Se
// acota con un timeout y se reintenta: una consulta colgada mataba la
// funcion entera y el bot nunca respondia.
const DB_TIMEOUT_MS = Number(process.env.SUPABASE_TIMEOUT_MS || 8000);
const DB_RETRIES = Number(process.env.SUPABASE_RETRIES || 2);

let trackingMap = null; // Map<order_id, tracking_id>
let trackingMapAt = 0;
// Carga en curso. Se REUTILIZA: dos consultas simultaneas a Supabase desde
// la misma instancia se quedan colgadas las dos (la segunda espera un
// socket que la primera tiene ocupado).
let trackingMapPromise = null;

/**
 * Ejecuta una consulta a Supabase con timeout y reintentos.
 *
 * @param {Function} makeBuilder Fabrica que devuelve la consulta (se vuelve
 *   a crear en cada intento, porque un builder no se puede reutilizar).
 * @param {object} [options] { retries, timeoutMs, label }
 * @returns {Promise<object>} Respuesta de Supabase ({ data, error }).
 */
async function dbQuery(makeBuilder, options = {}) {
  const retries = options.retries ?? DB_RETRIES;
  const timeoutMs = options.timeoutMs ?? DB_TIMEOUT_MS;
  const label = options.label || "supabase";

  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    // AbortController: cancela de verdad la peticion HTTP cuando se pasa el
    // tiempo. Sin esto, desde Vercel algunas consultas a Supabase se quedan
    // colgadas 60-90 s y el setTimeout no basta (la promesa nunca resuelve).
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort(new Error(`${label}: timeout de ${timeoutMs}ms`));
    }, timeoutMs);

    try {
      const builder = makeBuilder();
      if (builder && typeof builder.abortSignal === "function") {
        builder.abortSignal(controller.signal);
      }
      const result = await builder;
      if (result && result.error) {
        // Error de Supabase (no de red): no insistir, eslogico.
        return result;
      }
      return result;
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        console.warn(
          `[db] ${error.message} -> reintento ${attempt + 1}/${retries}`
        );
        await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
      }
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError || new Error(`${label}: fallo desconocido`);
}

// Calentamiento: abre la conexion con Supabase al cargar el modulo, fuera
// del reloj de la peticion. Asi la primera consulta real no sufre el
// arranque en frio.
// NO se carga nada aqui a proposito: en la fase de "init" de Vercel las
// promesas en segundo plano pueden quedar congeladas, y el primer request
// se quedaria esperando a una que nunca avanza. La carga se hace bajo
// demanda, con tope de espera (ver getTrackingMap).


const ENVIA_API_URL = "https://api.envia.com/ship/generaltrack";

/**
 * Normaliza un telefono a digitos, opcionalmente con prefijo de pais.
 * Chile usa 56 y los numeros locales pueden venir con 9 digitos, +56, o
 * 569XXXXXXXX.
 *
 * @param {string} phone Telefono en cualquier formato.
 * @returns {string} Telefono normalizado (solo digitos, con 56 adelante).
 */
function normalizePhone(phone) {
  if (!phone) return "";
  let digits = String(phone).replace(/\D/g, "");
  if (!digits) return "";

  // 569XXXXXXXX -> 56 + 9XXXXXXXX
  if (digits.startsWith("569") && digits.length === 11) return digits;
  // 9XXXXXXXX (formato local chileno) -> 56 + 9XXXXXXXX
  if (digits.length === 9 && digits.startsWith("9")) return `56${digits}`;
  // 56XXXXXXXXX (11 digitos, sin 9 extra)
  if (digits.length === 11 && digits.startsWith("56")) return digits;
  // 8 digitos (fijo) -> 56 + ...
  if (digits.length === 8) return `56${digits}`;

  return digits;
}

/**
 * Compara dos telefonos normalizados de forma tolerante.
 * Chile tiene una situacion comun con el "9" extra: 9XXXXXXXX y 56+9XXXXXXXX
 * son el mismo numero, pero algunos sistemas guardan uno y otros el otro.
 *
 * @param {string} a Telefono A.
 * @param {string} b Telefono B.
 * @returns {boolean}
 */
function phonesMatch(a, b) {
  const na = normalizePhone(a);
  const nb = normalizePhone(b);
  if (!na || !nb) return false;
  if (na === nb) return true;

  // Comparacion laxa: ultimos 8 digitos (el "9" extra no debe impedir el match)
  const tail = (s) => s.slice(-8);
  if (tail(na) === tail(nb)) return true;

  // Un numero con 9 extra y otro sin el: 56912345678 vs 5612345678
  const strip = (s) => (s.startsWith("569") ? "56" + s.slice(3) : s);
  return strip(na) === strip(nb);
}

/**
 * Consulta el estado de un envio en Envia.
 *
 * @param {string|string[]} trackingNumbers Numero(s) de seguimiento.
 * @returns {Promise<object|null>} Primer envio encontrado, o null.
 */
async function fetchShipmentFromEnvia(trackingNumbers, options = {}) {
  const list = await fetchShipmentsFromEnvia(trackingNumbers, options);
  return list[0] || null;
}

/**
 * Consulta TODOS los envios de Envia para una lista de seguimientos.
 *
 * Ojo: Envia devuelve un objeto por cada trackingNumber enviado, asi que
 * quedarse solo con el primero (como hacia antes) hacia que la busqueda
 * por telefono comparara contra un unico envio de 30.
 *
 * @param {string|string[]} trackingNumbers Numero(s) de seguimiento.
 * @returns {Promise<object[]>} Lista de envios crudos (puede estar vacia).
 */
async function fetchShipmentsFromEnvia(trackingNumbers, { signal } = {}) {
  const key = process.env.ENVIA_API_KEY;
  if (!key || !trackingNumbers) return [];

  const list = Array.isArray(trackingNumbers) ? trackingNumbers : [trackingNumbers];

  try {
    const response = await fetch(ENVIA_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ trackingNumbers: list }),
      // Timeout: Envia a veces se demora y sin esto la funcion de Vercel
      // queda colgada hasta que la matan por maxDuration.
      // `signal` externo: cancela la peticion si el llamador ya no la espera.
      signal: combineSignals(
        signal,
        AbortSignal.timeout(Number(process.env.ENVIA_TIMEOUT_MS || 15000))
      ),
    });

    const data = await response.json().catch(() => ({}));
    if (data.error || !Array.isArray(data.data)) return [];

    return data.data;
  } catch (error) {
    console.error("Error consultando Envia:", error.message);
    return null;
  }
}

/**
 * Normaliza un envio de Envia al formato que consume la IA.
 *
 * @param {object} raw Envio devuelto por Envia.
 * @returns {object} Envio normalizado.
 */
function normalizeShipment(raw) {
  if (!raw) return null;

  const events = [];
  const history = raw.eventHistory || [];
  for (const ev of history) {
    events.push({
      date: ev.date || ev.createdAt || null,
      city: ev.city || null,
      description: ev.description || ev.status || null,
    });
  }

  const delivered = /delivered|entregado/i.test(raw.status || "");

  return {
    trackingNumber: raw.trackingNumber || null,
    carrier: raw.carrierDescription || raw.carrier || null,
    service: raw.serviceDescription || raw.service || null,
    status: raw.status || null,
    currentStatus: raw.status || null,
    estimatedDelivery: raw.estimatedDelivery || null,
    shippedAt: raw.shippedAt || null,
    deliveredAt: raw.deliveredAt || null,
    delivered,
    trackUrl: raw.trackUrl || raw.trackUrlSite || null,
    orderId: raw.content?.content || null,
    customerPhone: raw.destination?.phone || null,
    customerCity: raw.destination?.city || null,
    events,
  };
}

/**
 * Extrae un numero de pedido del texto del cliente.
 * Acepta variantes como "MON3007", "3007", "mon-3007", "#3007".
 *
 * Un numero de 8-9 digitos NO se considera pedido: en Chile es un
 * telefono, y se maneja por separado (ver extractPhone). Antes un
 * telefono como "9689 1362" terminaba como pedido "MON9689".
 *
 * @param {string} text Texto del cliente.
 * @returns {string|null} ID de pedido normalizado ("MON3007") o null.
 */
function extractOrderId(text) {
  if (!text) return null;

  // Formas explicitas: siempre ganan.
  const explicit = [
    /\bMON[\s\-_]*(\d{3,})\b/i,
    /\b(?:pedido|orden|order|#)\s*[:\-]?\s*(\d{3,})\b/i,
  ];
  for (const re of explicit) {
    const m = text.match(re);
    if (m) {
      const digits = m[1];
      return /^\d+$/.test(digits) ? `MON${digits}` : digits.toUpperCase();
    }
  }

  // Fallback: un numero suelto de 4 a 7 digitos. Solo si el mensaje NO
  // trae un telefono, para no partir un numero de 8-9 digitos por la mitad.
  if (extractPhone(text)) return null;

  const loose = text.match(/\b(\d{4,7})\b/);
  if (loose) return `MON${loose[1]}`;

  return null;
}

/**
 * Extrae un telefono chileno del texto del cliente.
 *
 * Acepta los formatos habituales:
 *   +56 9 9689 1362 | 56 9 9689 1362 | 9 9689 1362 | 9689 1362 | 96891362
 *
 * En Instagram es la via principal para identificar al cliente, porque
 * ahi el id del usuario no es un telefono.
 *
 * @param {string} text Texto del cliente.
 * @returns {string|null} Telefono en digitos (formato internacional sin +).
 */
function extractPhone(text) {
  if (!text) return null;

  // Secuencia de digitos con separadores opcionales. Los grupos son
  // flexibles para cubrir "9 9689 1362", "968 913 62" y "96891362".
  const seq = /(?<![\d+])(?:\+?56[\s.-]?)?\d{1,4}[\s.-]?\d{3,4}[\s.-]?\d{2,4}(?![\d])/g;
  const matches = text.match(seq) || [];

  for (const raw of matches) {
    const digits = raw.replace(/\D/g, "");
    // 8 digitos: fijo local o movil sin el 9 extra.
    // 9 digitos: movil local (9 + 8).
    // 10/11 digitos: con prefijo 56.
    const valid =
      digits.length === 8 ||
      digits.length === 9 ||
      ((digits.length === 10 || digits.length === 11) && digits.startsWith("56"));
    if (valid) return digits;
  }

  return null;
}

/**
 * Variantes con las que conviene comparar un telefono.
 *
 * En Chile el movil se escribe a veces con el 9 extra ("9 8689 1362") y
 * a veces sin el ("8689 1362"). Si el numero se escribe con separadores
 * raros, el parseo puede quitar ese 9, asi que se prueba tambien la
 * variante alternativa.
 *
 * @param {string} phone Telefono en digitos.
 * @returns {string[]} Telefonos a comparar.
 */
function phoneVariants(phone) {
  const base = String(phone || "").replace(/\D/g, "");
  if (!base) return [];

  const variants = new Set([base]);
  if (base.length === 9 && base.startsWith("9")) {
    variants.add(base.slice(1)); // sin el 9 extra
  } else if (base.length === 8) {
    variants.add(`9${base}`); // con el 9 extra
  }
  return [...variants];
}

/**
 * Busca el envio de un cliente.
 *
 * Estrategia, en orden:
 *  1. Si el mensaje trae un numero de pedido explicito, se busca por ese ID.
 *  2. Si no, se listan los envios recientes y se busca coincidencia por telefono.
 *
 * @param {object} params
 * @param {string} params.phone Telefono del cliente (formato WhatsApp, con +).
 * @param {string} [params.text] Texto del mensaje (para extraer numero de pedido).
 * @param {number} [params.limit] Maximo de envios a revisar (default 30).
 * @returns {Promise<{shipment: object|null, orderId: string|null, reason: string}>}
 */
async function findShipment({ phone, text, limit = 30 }) {
  const orderId = extractOrderId(text);

  // 1) Busqueda directa por numero de pedido
  if (orderId) {
    const shipment = await findShipmentByOrderId(orderId);
    if (shipment) {
      return { shipment, orderId, reason: "order_id" };
    }

    // El pedido existe en la tabla pero sin envio generado.
    const { data } = await dbQuery(() =>
      supabase
        .from("order_tracking")
        .select("order_id")
        .eq("order_id", orderId)
        .limit(1)
    );
    if (data && data.length > 0) {
      return { shipment: null, orderId, reason: "pedido_sin_envio" };
    }
    // El pedido no existe: se sigue intentando por telefono, por si el
    // cliente se equivoco de numero.
  }

  // 2) Busqueda por telefono sobre los envios recientes
  const { shipment: byPhone, matches } = await findShipmentByPhone(phone, { limit });
  if (byPhone) {
    return {
      shipment: byPhone,
      orderId: byPhone.orderId || orderId,
      reason: orderId ? "pedido_sin_match_telefono" : "telefono",
      matches: matches.length,
    };
  }

  // 3) No se pudo resolver
  if (orderId) {
    return { shipment: null, orderId, reason: "pedido_desconocido", matches: 0 };
  }
  return { shipment: null, orderId: null, reason: "sin_match", matches: 0 };
}

/**
 * Busca envios asociados a un telefono.
 *
 * El telefono no esta en Supabase: vive en Envia (`destination.phone`).
 * Por eso se consultan los ultimos envios y se compara el telefono del
 * destinatario de cada uno.
 *
 * @param {string} phone Telefono del cliente.
 * @param {object} [options] { limit } numero de envios recientes a revisar.
 * @returns {Promise<{shipment: object|null, matches: object[]}>}
 *   shipment = el envio mas reciente que coincide; matches = todos los que
 *   coinciden (puede haber mas de uno si el cliente tiene varios pedidos).
 */
async function findShipmentByPhone(phone, { limit = 30 } = {}) {
  const empty = { shipment: null, matches: [] };
  if (!phone) return empty;

  // Mapa cacheado en lugar de una consulta por mensaje.
  const map = await getTrackingMap();
  const tracks = [...map.entries()]
    .slice(0, limit)
    .map(([orderId, trackingId]) => ({ order_id: orderId, tracking_id: trackingId }));

  if (tracks.length === 0) return empty;

  const trackingNumbers = tracks.map((t) => t.tracking_id).filter(Boolean);
  if (trackingNumbers.length === 0) return empty;

  const raws = await fetchShipmentsFromEnvia(trackingNumbers);
  const candidates = [];
  for (const raw of raws || []) {
    const s = normalizeShipment(raw);
    if (s) candidates.push(s);
  }

  const matches = candidates.filter((s) => {
    const variants = phoneVariants(phone);
    return variants.some((v) => phonesMatch(s.customerPhone, v));
  });
  if (matches.length === 0) return empty;

  // El mas reciente primero: `order_tracking` viene ordenado de mas nuevo a
  // mas viejo y Envia respeta ese orden.
  return { shipment: matches[0], matches };
}

/**
 * Busca pedidos en Supabase por el ID de Shopify (util para el webhook de
 * Shopify, donde ya se conoce el pedido).
 *
 * @param {string} orderId ID de pedido tipo "MON3007".
 * @returns {Promise<object|null>} Envio normalizado.
 */
async function findShipmentByOrderId(orderId, { signal } = {}) {
  if (!orderId) return null;
  const t0 = Date.now();

  // Se usa el mapa cacheado: consultar Supabase en cada mensaje es lento
  // desde Vercel (65-90 s de forma intermitente).
  const map = await getTrackingMap();
  const trackingId = map.get(orderId);
  console.log(
    `[envia] (${((Date.now() - t0) / 1000).toFixed(1)}s) ${orderId}: ` +
      `mapa=${map.size} tracking=${trackingId || "sin envio"}`
  );
  if (!trackingId) return null;

  const raw = await fetchShipmentFromEnvia(trackingId, { signal });
  console.log(
    `[envia] (${((Date.now() - t0) / 1000).toFixed(1)}s) ${orderId}: Envia contesto`
  );
  const shipment = normalizeShipment(raw);
  if (shipment) shipment.orderId = shipment.orderId || orderId;
  return shipment;
}

/**
 * Indica si un envio AUN NO fue retirado por la empresa de transporte.
 *
 * En Envia, `status` vale "Created" cuando se genero la etiqueta pero el
 * paquete aun no fue recogido. Ahi `shippedAt`, `pickupDate` y `deliveredAt`
 * vienen en null. Cuando el paquete ya fue retirado, el estado pasa a
 * "Picked up" / "In transit" / "Out for delivery" / "Delivered".
 *
 * Es la condicion para poder contarle al cliente como va su proceso de
 * fabricacion: una vez que el paquete esta en la transportista, la
 * manufactura ya termino.
 *
 * @param {object|null} shipment Envio normalizado.
 * @returns {boolean}
 */
function isNotPickedUp(shipment) {
  // Sin envio en Envia: el pedido todavia no tiene etiqueta, asi que
  // la fabricacion sigue en curso.
  if (!shipment) return true;

  const status = String(shipment.status || shipment.currentStatus || "").toLowerCase();

  // Estados que implican que la transportista ya tiene el paquete.
  const collected = [
    "picked up",
    "picked_up",
    "shipped",
    "in transit",
    "in_transit",
    "out for delivery",
    "out_for_delivery",
    "delivered",
    "delivered at origin",
    "redirection",
    "redirected",
    "in information",
    "returned",
    "lost",
    "damaged",
  ];
  if (collected.some((s) => status.includes(s))) return false;

  // Indicadores de que ya salio del deposito.
  if (shipment.shippedAt || shipment.pickupDate || shipment.deliveredAt) return false;

  // "Created" (etiqueta generada, sin retirar) es el caso tipico.
  if (status.includes("created") || status === "") return true;

  // Cualquier estado desconocido: se considera retirado para no mostrar
  // un proceso de fabricacion que podria estar obsoleto.
  return false;
}

/**
 * Mapa pedido -> numero de seguimiento, cacheado en memoria.
 *
 * Desde Vercel las consultas a Supabase se latenmucho (65-90 s de forma
 * intermitente), y una por mensaje hacia que el bot no respondiera nunca.
 * La tabla tiene unos cientos de filas: se bajan TODAS de una vez y se
 * cachean, asi que el camino critico no toca Supabase.
 */
const TRACKING_MAP_TTL_MS = Number(
  process.env.TRACKING_MAP_TTL_MS || 5 * 60 * 1000
);

/**
 * Devuelve el mapa pedido -> seguimiento, refrescandolo si es viejo.
 *
 * @returns {Promise<Map<string, string>>}
 */
/**
 * Devuelve el mapa pedido -> seguimiento.
 *
 * Nunca bloquea mas de `maxWaitMs`: si la carga no llega a tiempo se
 * devuelve lo que haya (puede estar vacio) y la carga sigue en segundo
 * plano. Es preferible responder "no pude verificar ahora" antes que
 * dejar al cliente sin respuesta.
 *
 * @param {object} [options] { maxWaitMs }
 * @returns {Promise<Map<string, string>>}
 */
async function getTrackingMap({ maxWaitMs = 6000 } = {}) {
  const ahora = Date.now();
  const hayMapa = trackingMap && trackingMap.size > 0;
  const vencido = ahora - trackingMapAt > TRACKING_MAP_TTL_MS;

  // Si ya hay un mapa, se devuelve al instante aunque este viejo: el
  // refresco va en segundo plano y nunca bloquea la respuesta al cliente.
  if (hayMapa) {
    if (vencido && !trackingMapPromise) startTrackingMapLoad();
    return trackingMap;
  }

  // Primera vez: se espera, pero no mas de maxWaitMs.
  if (!trackingMapPromise) startTrackingMapLoad();

  const limite = Date.now() + maxWaitMs;
  while (!trackingMap && Date.now() < limite) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  if (!trackingMap) {
    console.warn("[db] el mapa de envios no esta listo todavia");
    return new Map();
  }
  return trackingMap;
}

/**
 * Lanza la carga del mapa en segundo plano (una sola a la vez).
 */
function startTrackingMapLoad() {
  trackingMapPromise = loadTrackingMap()
    .catch((error) => {
      console.warn("[db] carga del mapa fallo:", error.message);
    })
    .finally(() => {
      trackingMapPromise = null;
    });
  return trackingMapPromise;
}

/**
 * Carga el mapa pedido -> seguimiento desde Supabase.
 *
 * Se usa fetch crudo en lugar del cliente de supabase-js: desde Vercel el
 * cliente se quedaba colgado (60-90 s) de forma intermitente, mientras que
 * la misma consulta con fetch crudo responde en ~400 ms.
 *
 * @returns {Promise<Map<string, string>>}
 */
async function loadTrackingMap() {
  const url = `${process.env.SUPABASE_URL}/rest/v1/order_tracking?select=order_id,tracking_id&limit=1000`;
  const key = process.env.SUPABASE_ANON_KEY;

  const response = await fetch(url, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(
      Number(process.env.SUPABASE_TIMEOUT_MS || 15000)
    ),
  });

  if (!response.ok) {
    throw new Error(`mapa de envios: HTTP ${response.status}`);
  }

  const rows = await response.json();
  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (row.order_id && row.tracking_id) map.set(row.order_id, row.tracking_id);
  }
  trackingMap = map;
  trackingMapAt = Date.now();
  console.log(`[db] mapa de envios: ${map.size} pedidos`);
  return map;
}

module.exports = {
  supabase,
  dbQuery,
  getTrackingMap,
  normalizePhone,
  phonesMatch,
  fetchShipmentFromEnvia,
  fetchShipmentsFromEnvia,
  normalizeShipment,
  extractOrderId,
  extractPhone,
  phoneVariants,
  findShipment,
  findShipmentByOrderId,
  findShipmentByPhone,
  isNotPickedUp,
};
