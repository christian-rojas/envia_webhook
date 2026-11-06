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

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

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
async function fetchShipmentFromEnvia(trackingNumbers) {
  const key = process.env.ENVIA_API_KEY;
  if (!key || !trackingNumbers) return null;

  const list = Array.isArray(trackingNumbers) ? trackingNumbers : [trackingNumbers];

  try {
    const response = await fetch(ENVIA_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ trackingNumbers: list }),
    });

    const data = await response.json().catch(() => ({}));
    if (data.error || !Array.isArray(data.data) || data.data.length === 0) return null;

    return data.data[0] || null;
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
 * @param {string} text Texto del cliente.
 * @returns {string|null} ID de pedido normalizado ("MON3007") o null.
 */
function extractOrderId(text) {
  if (!text) return null;

  const patterns = [
    /\bMON[\s\-_]*(\d{3,})\b/i,
    /\b(?:pedido|orden|order|#)\s*[:\-]?\s*(\d{3,})\b/i,
    /\b(\d{4,})\b/,
  ];

  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      const digits = m[1];
      return /^\d+$/.test(digits) ? `MON${digits}` : digits.toUpperCase();
    }
  }
  return null;
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
    const { data, error } = await supabase
      .from("order_tracking")
      .select("order_id, tracking_id")
      .eq("order_id", orderId)
      .limit(1);

    if (!error && data && data.length > 0 && data[0].tracking_id) {
      const raw = await fetchShipmentFromEnvia(data[0].tracking_id);
      const shipment = normalizeShipment(raw);
      if (shipment) {
        shipment.orderId = shipment.orderId || orderId;
        return { shipment, orderId, reason: "order_id" };
      }
    }
  }

  // 2) Busqueda por telefono sobre los envios recientes
  const { data: tracks, error: tracksError } = await supabase
    .from("order_tracking")
    .select("order_id, tracking_id")
    .order("id", { ascending: false })
    .limit(limit);

  if (tracksError || !tracks || tracks.length === 0) {
    return { shipment: null, orderId, reason: "sin_datos" };
  }

  const trackingNumbers = tracks.map((t) => t.tracking_id).filter(Boolean);
  if (trackingNumbers.length === 0) {
    return { shipment: null, orderId, reason: "sin_tracking" };
  }

  const raws = await fetchShipmentFromEnvia(trackingNumbers);
  const list = Array.isArray(raws) ? raws : raws ? [raws] : [];

  // La API puede devolver varios envios: se procesan todos
  const candidates = [];
  for (const raw of list) {
    const s = normalizeShipment(raw);
    if (s) candidates.push(s);
  }

  if (candidates.length === 0) {
    return { shipment: null, orderId, reason: "envia_sin_datos" };
  }

  const match = candidates.find((s) => phonesMatch(s.customerPhone, phone));
  if (match) {
    return { shipment: match, orderId: match.orderId || orderId, reason: "telefono" };
  }

  // 3) Ultimo recurso: si el mensaje trae un pedido explicito, se devuelve ese
  // aunque no haya coincidencia de telefono (el cliente podria estar desde
  // otro numero).
  if (orderId) {
    const byOrder = candidates.find((s) => (s.orderId || "").toUpperCase() === orderId);
    if (byOrder) {
      return { shipment: byOrder, orderId, reason: "pedido_sin_match_telefono" };
    }
  }

  return { shipment: null, orderId, reason: "sin_match" };
}

/**
 * Busca pedidos en Supabase por el ID de Shopify (util para el webhook de
 * Shopify, donde ya se conoce el pedido).
 *
 * @param {string} orderId ID de pedido tipo "MON3007".
 * @returns {Promise<object|null>} Envio normalizado.
 */
async function findShipmentByOrderId(orderId) {
  if (!orderId) return null;

  const { data, error } = await supabase
    .from("order_tracking")
    .select("order_id, tracking_id")
    .eq("order_id", orderId)
    .limit(1);

  if (error || !data || data.length === 0 || !data[0].tracking_id) return null;

  const raw = await fetchShipmentFromEnvia(data[0].tracking_id);
  const shipment = normalizeShipment(raw);
  if (shipment) shipment.orderId = shipment.orderId || orderId;
  return shipment;
}

module.exports = {
  supabase,
  normalizePhone,
  phonesMatch,
  fetchShipmentFromEnvia,
  normalizeShipment,
  extractOrderId,
  findShipment,
  findShipmentByOrderId,
};
