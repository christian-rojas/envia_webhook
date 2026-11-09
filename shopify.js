/**
 * Cliente de Shopify Admin API para leer pedidos y sus notas.
 *
 * AUTENTICACION (client credentials grant)
 * -----------------------------------------
 * La app se creo en el Dev Dashboard de Shopify bajo la organizacion del
 * comerciante, asi que no hay un token `shpat_` fijo en el admin: el token se
 * pide programaticamente con el Client ID + Client Secret.
 *
 *   POST https://{shop}.myshopify.com/admin/oauth/access_token
 *   grant_type=client_credentials
 *
 * El token expira a las 24h, asi que se cachea en memoria y se renueva un
 * minuto antes de expirar. Si una llamada devuelve 401 (token revocado o
 * scopes cambiados), se fuerza la renovacion y se reintenta una vez.
 *
 * SCOPES
 * ------
 * `read_orders` cubre solo los ultimos 60 dias de pedidos.
 * `read_all_orders` (que hay que declarar junto a `read_orders`) da acceso a
 * todo el historial.
 */

const { combineSignals } = require("./abort.js");

// En local carga el .env; en Vercel no hace nada (no hay archivo .env).
// dotenv no pisa las variables ya definidas, asi que en produccion manda Vercel.
// Va antes de leer las variables de entorno.
try {
  require("dotenv").config();
} catch {
  /* dotenv es opcional */
}

const SHOPIFY_SHOP = process.env.SHOPIFY_SHOP || "mondano-chile";
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-10";
const REQUEST_TIMEOUT_MS = Number(process.env.SHOPIFY_TIMEOUT_MS || 20000);

// Cache del token: { token, expiresAt, scope }
let tokenCache = null;

// Cache de pedidos: Map<nombre, { order, savedAt }>
const orderCache = new Map();
const ORDER_CACHE_MS = Number(process.env.SHOPIFY_ORDER_CACHE_MS || 60000);

/**
 * Pide (o renueva) el access token de la Admin API.
 *
 * @param {object} [options] { force } fuerza la renovacion.
 * @returns {Promise<string>} Access token.
 */
async function getAccessToken({ force = false } = {}) {
  if (
    !force &&
    tokenCache &&
    tokenCache.token &&
    Date.now() < tokenCache.expiresAt - 60_000
  ) {
    return tokenCache.token;
  }

  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      "SHOPIFY_CLIENT_ID y SHOPIFY_CLIENT_SECRET no estan configurados"
    );
  }

  const response = await fetch(
    `https://${SHOPIFY_SHOP}.myshopify.com/admin/oauth/access_token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Shopify token error ${response.status}: ${detail.slice(0, 200)}`
    );
  }

  const data = await response.json();
  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + (Number(data.expires_in) || 86400) * 1000,
    scope: data.scope || null,
  };
  console.log(`[shopify] token renovado (scopes: ${tokenCache.scope})`);
  return tokenCache.token;
}

/**
 * Hace una llamada a la Admin API REST, renovando el token si hace falta.
 *
 * @param {string} path Ruta relativa, p.ej. "/orders.json".
 * @param {object} [options] { method, params, body }
 * @returns {Promise<object>} JSON de la respuesta.
 */
async function shopifyFetch(path, { method = "GET", params = {}, body, signal } = {}) {
  const url = new URL(
    `https://${SHOPIFY_SHOP}.myshopify.com/admin/api/${API_VERSION}${path}`
  );
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  const doRequest = async (token) =>
    fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: combineSignals(signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)),
    });

  let token = await getAccessToken();
  let response = await doRequest(token);

  // 401 = token expirado/revocado: se renueva y se reintenta una vez.
  if (response.status === 401) {
    token = await getAccessToken({ force: true });
    response = await doRequest(token);
  }

  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    throw new Error(
      `Shopify ${method} ${path} -> ${response.status}: ${text.slice(0, 200)}`
    );
  }

  return data;
}

/**
 * Normaliza un identificador de pedido al nombre de Shopify.
 * Acepta "MON3007", "mon-3007", "#MON3007" y devuelve "MON3007".
 *
 * @param {string} value Identificador.
 * @returns {string|null}
 */
function normalizeOrderName(value) {
  if (!value) return null;
  const digits = String(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/^MON/, "")
    .replace(/^#/, "");
  if (!/^\d{3,}$/.test(digits)) return null;
  return `MON${digits}`;
}

/**
 * Lee un pedido por su nombre (MON3007) usando GraphQL.
 *
 * IMPORTANTE: hay que usar GraphQL y no REST. Con `read_all_orders` la
 * conexion `orders` de GraphQL devuelve los 3700+ pedidos del historico
 * (desde 2021), mientras que REST `/orders.json` solo devuelve 76 y
 * `?name=` no encuentra los antiguos (p.ej. MON4500 responde vacio).
 *
 * @param {string} orderName Nombre del pedido.
 * @param {object} [options] { fresh } ignora la cache.
 * @returns {Promise<object|null>} El pedido, o null si no existe.
 */
async function getOrder(orderName, { fresh = false, signal } = {}) {
  const name = normalizeOrderName(orderName);
  if (!name) return null;

  if (!fresh) {
    const cached = orderCache.get(name);
    if (cached && Date.now() - cached.savedAt < ORDER_CACHE_MS) {
      return cached.order;
    }
  }

  const query = `query ($name: String!) {
    orders(first: 1, query: $name) {
      edges {
        node {
          id
          name
          createdAt
          note
          metafields(first: 30) { edges { node { namespace key type value } } }
          events(first: 50) {
            edges {
              node {
                __typename
                ... on CommentEvent { message createdAt }
                ... on BasicEvent { message createdAt }
              }
            }
          }
          lineItems(first: 20) { edges { node { title quantity variantTitle } } }
        }
      }
    }
  }`;

  // La busqueda de GraphQL espera el formato "name:MON3007".
  const node = await graphql(query, { name: `name:${name}` }, { signal }).then(
    (data) => data?.orders?.edges?.[0]?.node || null
  );

  if (!node) {
    orderCache.delete(name);
    return null;
  }

  // Campos que solo existen en REST: note_attributes y las propiedades de
  // las lineas. Se piden por id, que si funciona para pedidos antiguos.
  const rest = await fetchOrderRest(node.id, { signal }).catch(() => null);

  const metafields = (node.metafields?.edges || [])
    .map((e) => e.node)
    .filter((m) => m && m.value);

  const events = node.events?.edges || []
    .map((e) => e.node)
    .filter((e) => e && e.message);

  const order = {
    id: node.id,
    name: node.name,
    created_at: node.createdAt,
    note: node.note,
    metafields,
    events,
    line_items: (rest?.line_items || []).length
      ? rest.line_items
      : (node.lineItems?.edges || []).map((e) => ({
          title: e.node.title,
          quantity: e.node.quantity,
          variant_title: e.node.variantTitle,
          properties: [],
        })),
    note_attributes: rest?.note_attributes || [],
  };

  orderCache.set(name, { order, savedAt: Date.now() });
  return order;
}

/**
 * Pide un pedido por su id via REST (para los campos que no existen en
 * GraphQL: note_attributes, propiedades de linea).
 *
 * @param {string} gid Id del pedido (gid://shopify/Order/...).
 * @returns {Promise<object|null>}
 */
async function fetchOrderRest(gid, { signal } = {}) {
  const id = String(gid || "").split("/").pop();
  if (!id) return null;
  const data = await shopifyFetch(`/orders/${id}.json`, { signal });
  return data.order || null;
}

/**
 * Ejecuta una query GraphQL de la Admin API.
 *
 * @param {string} query Consulta.
 * @param {object} [variables] Variables.
 * @returns {Promise<object>} data de la respuesta.
 */
async function graphql(query, variables = {}, { signal } = {}) {
  const url = `https://${SHOPIFY_SHOP}.myshopify.com/admin/api/${API_VERSION}/graphql.json`;
  const doRequest = async (token) =>
    fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({ query, variables }),
      signal: combineSignals(signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)),
    });

  let token = await getAccessToken();
  let response = await doRequest(token);
  if (response.status === 401) {
    token = await getAccessToken({ force: true });
    response = await doRequest(token);
  }

  const data = await response.json().catch(() => ({}));
  if (data.errors) {
    throw new Error(`Shopify GraphQL: ${JSON.stringify(data.errors).slice(0, 250)}`);
  }
  return data.data || {};
}

/**
 * Junta TODAS las notas que puede tener un pedido, en un solo objeto.
 *
 * Busca en:
 *   - order.note              (la nota del pedido)
 *   - order.note_attributes    (atributos de nota)
 *   - line_items[].properties  (propiedades de la linea)
 *   - metafields del pedido    (GraphQL)
 *   - comentarios del timeline (GraphQL, CommentEvent)
 *
 * Los comentarios del timeline son importantes: es ahi donde el equipo
 * escribe las notas de operacion (NUEVO ENVIO, REEMBOLSADO, CORREGIR
 * TALLA...) y donde podrian anotar las etapas de fabricacion.
 *
 * @param {string} orderName Nombre del pedido.
 * @returns {Promise<object>} { name, found, notes, note, properties, metafields, comments }
 */
async function getOrderContext(orderName, { signal } = {}) {
  const name = normalizeOrderName(orderName);
  const order = await getOrder(name, { signal });

  if (!order) {
    return {
      name,
      found: false,
      notes: "",
      note: null,
      properties: [],
      metafields: [],
      comments: [],
      lineItems: [],
    };
  }

  const note = (order.note || "").trim();

  const attributes = (order.note_attributes || [])
    .map((a) => `${a.name}: ${a.value}`)
    .filter(Boolean);

  const properties = [];
  for (const item of order.line_items || []) {
    for (const prop of item.properties || []) {
      properties.push(`${item.title} — ${prop.name}: ${prop.value}`);
    }
  }

  const metafields = order.metafields || [];
  const comments = (order.events || [])
    .filter((e) => e.__typename === "CommentEvent")
    .map((e) => e.message);

  const parts = [];
  if (note) parts.push(note);
  if (attributes.length) parts.push(attributes.join("\n"));
  if (properties.length) parts.push(properties.join("\n"));
  if (metafields.length) {
    parts.push(metafields.map((m) => `${m.key}: ${m.value}`).join("\n"));
  }
  if (comments.length) parts.push(comments.join("\n"));

  return {
    name,
    found: true,
    notes: parts.join("\n").trim(),
    note,
    properties,
    metafields,
    comments,
    createdAt: order.created_at,
    lineItems: (order.line_items || []).map((i) => ({
      title: i.title,
      quantity: i.quantity,
      variant: i.variant_title || null,
    })),
  };
}

/**
 * Scopes que tiene el token actual (para diagnostico).
 *
 * @returns {Promise<object[]>} Lista de { handle, description }.
 */
async function getGrantedScopes() {
  const query = `query {
    currentAppInstallation {
      accessScopes { handle description }
    }
  }`;

  const url = `https://${SHOPIFY_SHOP}.myshopify.com/admin/api/${API_VERSION}/graphql.json`;
  const token = await getAccessToken();
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const data = await response.json().catch(() => ({}));
  return data?.data?.currentAppInstallation?.accessScopes || [];
}

/**
 * Normaliza un telefono a un formato comparable.
 *
 * Chile: 9 digitos moviles (9XXXX XXXX), 8 digitos fijos, con o sin 56.
 *
 * @param {string} phone Telefono.
 * @returns {string|null}
 */
function normalizePhone(phone) {
  if (!phone) return null;
  let digits = String(phone).replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 11 && digits.startsWith("56")) return digits;
  if (digits.length === 11) return digits;
  if (digits.length === 9 && digits.startsWith("9")) return `56${digits}`;
  if (digits.length === 8) return `56${digits}`;
  return digits;
}

/**
 * Indica si dos telefonos son el mismo numero.
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function phonesMatch(a, b) {
  const na = normalizePhone(a);
  const nb = normalizePhone(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // El "9" extra no debe impedir el match.
  if (na.slice(-8) === nb.slice(-8)) return true;
  const strip = (s) => (s.startsWith("569") ? "56" + s.slice(3) : s);
  return strip(na) === strip(nb);
}

// ---------------------------------------------------------------------------
// Indice telefono -> pedidos
// ---------------------------------------------------------------------------
// El telefono del cliente NO esta en Envia (alla va un telefono de fabrica)
// ni en Supabase. La unica fuente real es `shipping_address.phone` de
// Shopify. Y la busqueda por `phone:` de GraphQL no filtra, asi que hay que
// indexar los pedidos por telefono.
//
// El indice se guarda en memoria con TTL y se refresca en segundo plano.

let phoneIndex = null; // Map<telefono, [{name, createdAt, note}]>
let phoneIndexBuiltAt = 0;
let phoneIndexBuilding = false;

const PHONE_INDEX_TTL_MS = Number(
  process.env.SHOPIFY_PHONE_INDEX_TTL_MS || 30 * 60 * 1000
);

/**
 * Construye el indice telefono -> pedidos recorriendo todo el historico.
 *
 * @returns {Promise<Map<string, object[]>>}
 */
async function buildPhoneIndex() {
  const index = new Map();
  let after = null;
  let pages = 0;

  const query = `query ($after: String) {
    orders(first: 250, after: $after, sortKey: CREATED_AT, reverse: true) {
      edges {
        node {
          name
          createdAt
          shippingAddress { phone }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }`;

  while (pages < 30) {
    const data = await graphql(query, { after });
    const edges = data.orders?.edges || [];
    if (!edges.length) break;
    pages++;

    for (const edge of edges) {
      const node = edge.node;
      const phone = normalizePhone(node.shippingAddress?.phone);
      if (!phone) continue;
      if (!index.has(phone)) index.set(phone, []);
      index.get(phone).push({
        name: node.name,
        createdAt: node.createdAt,
      });
    }

    if (!data.orders.pageInfo.hasNextPage) break;
    after = data.orders.pageInfo.endCursor;
  }

  phoneIndex = index;
  phoneIndexBuiltAt = Date.now();
  phoneIndexBuilding = false;
  console.log(
    `[shopify] indice de telefonos: ${index.size} telefonos, ${pages} paginas`
  );
  return index;
}

/**
 * Devuelve el indice de telefonos, construyolo si hace falta.
 *
 * @param {object} [options] { maxWait } ms maximos de espera.
 * @returns {Promise<Map<string, object[]>|null>}
 */
async function getPhoneIndex({ maxWait = 20000 } = {}) {
  const fresh =
    phoneIndex && Date.now() - phoneIndexBuiltAt < PHONE_INDEX_TTL_MS;
  if (fresh) return phoneIndex;

  if (phoneIndexBuilding) {
    // Ya se esta construyendo: se espera un poco por el resultado.
    const deadline = Date.now() + maxWait;
    while (phoneIndexBuilding && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 250));
    }
    return phoneIndex;
  }

  phoneIndexBuilding = true;
  try {
    return await buildPhoneIndex();
  } catch (error) {
    phoneIndexBuilding = false;
    console.error("[shopify] error construyendo el indice:", error.message);
    return phoneIndex;
  }
}

/**
 * Busca los pedidos de un cliente por su telefono.
 *
 * @param {string} phone Telefono del cliente.
 * @param {object} [options] { maxWait } espera maxima por el indice.
 * @returns {Promise<object[]>} Pedidos del cliente, del mas nuevo al mas viejo.
 */
async function findOrdersByPhone(phone, { maxWait = 20000 } = {}) {
  const target = normalizePhone(phone);
  if (!target) return [];

  const index = await getPhoneIndex({ maxWait });
  if (!index) return [];

  // Se comparan con phonesMatch por si el formato guardado difiere.
  for (const [key, pedidos] of index.entries()) {
    if (key === target || phonesMatch(key, target)) {
      return pedidos.slice().sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    }
  }
  return [];
}

module.exports = {
  SHOPIFY_SHOP,
  API_VERSION,
  getAccessToken,
  shopifyFetch,
  graphql,
  normalizeOrderName,
  normalizePhone,
  phonesMatch,
  getOrder,
  getOrderContext,
  getGrantedScopes,
  buildPhoneIndex,
  getPhoneIndex,
  findOrdersByPhone,
};
