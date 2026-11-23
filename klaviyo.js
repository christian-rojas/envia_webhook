/**
 * Cliente de Klaviyo para acotar la lista de perfiles al limite del plan
 * gratis (250 perfiles activos y 500 emails/mes).
 *
 * POR QUE NO SE BORRA:
 * la API publica NO tiene `DELETE /api/profiles/{id}/` (da 405). Las dos
 * formas de sacar un perfil del camino son:
 *
 *   1. **Suprimir** (`POST /api/profile-suppression-bulk-create-jobs/`):
 *      el perfil deja de ser "activo" y no puede recibir email marketing,
 *      pero sus datos quedan. Es reversible
 *      (`POST /api/profile-unsuppression-bulk-create-jobs/`). Es la via que
 *      se usa por defecto.
 *   2. **Borrado de privacidad** (`POST /api/data-privacy-deletion-jobs/`):
 *      borra el perfil y todos sus datos. Es asincrono e irreversible. Se
 *      deja disponible con `modo: "borrar"` para cuando el perfil sea de
 *      verdad basura y no un cliente.
 *
 * QUE ORDEN USA:
 * por defecto `created` descendente (los 250 mas recientes), que es lo que
 * se pidio. La API solo deja ordenar por `created`, `updated`, `email` o
 * `id`, asi que la alternativa real es `updated` (la ultima vez que el
 * perfil cambio), que se acerca mas a "activo".
 *
 * OJO CON EL RIESGO DE ORDEN: los clientes que sincroniza Shopify pueden
 * entrar con `created` viejo (la fecha en que se dieron de alta en Shopify),
 * asi que con el orden FIFO estricto se suprimen antes los clientes
 * antiguos que el spam. Para eso esta `protegerConPedidos`: nunca suprime
 * un perfil que tenga pedidos, y en ese caso reporta cuantos quedan por
 * encima del limite.
 */

const REVISION = "2025-04-15";
const LIMITE_POR_DEFECTO = 250;

function clave() {
  return process.env.KLAVIYO_PRIVATE_KEY || "";
}

function headers() {
  return {
    Authorization: "Klaviyo-API-Key " + clave(),
    accept: "application/json",
    "content-type": "application/vnd.api+json",
    revision: REVISION,
  };
}

function activo() {
  return Boolean(clave());
}

/**
 * Llamada a la API de Klaviyo.
 *
 * @param {string} method Metodo HTTP.
 * @param {string} path Ruta relativa a /api.
 * @param {object} [body] Cuerpo JSON.
 * @returns {Promise<{status:number, j:any}>}
 */
async function api(method, path, body) {
  const r = await fetch("https://a.klaviyo.com/api" + path, {
    method,
    headers: headers(),
    body: body ? JSON.stringify(body) : undefined,
  });
  const texto = await r.text();
  let j = null;
  try {
    j = JSON.parse(texto);
  } catch (e) {
    j = texto;
  }
  if (r.status === 429) {
    // Klaviyo manda el header x-klaviyo-ratelimit-limit
    const espera = Number(r.headers.get("retry-after") || 2);
    await new Promise((res) => setTimeout(res, Math.max(1000, espera * 1000)));
    return api(method, path, body);
  }
  return { status: r.status, j };
}

/**
 * Lista los perfiles de la cuenta, paginando con cursor.
 *
 * @param {{sort?:string}} [opciones]
 * @returns {Promise<object[]>} Perfiles (objetos JSON:API).
 */
async function listarPerfiles({ sort = "-created" } = {}) {
  const todos = [];
  let cursor = null;
  for (let pagina = 0; pagina < 60; pagina++) {
    const ruta =
      "/profiles/?sort=" + encodeURIComponent(sort) + (cursor ? "&page[cursor]=" + cursor : "");
    const { status, j } = await api("GET", ruta);
    if (status !== 200) {
      console.error("[klaviyo] listando perfiles: " + status + " " + JSON.stringify(j).slice(0, 200));
      break;
    }
    todos.push(...(j.data || []));
    cursor = j.links && j.links.next ? j.links.next.split("page[cursor]=")[1] : null;
    if (!cursor) break;
  }
  return todos;
}

/**
 * Un perfil que viene de Shopify lleva external_id (el id del cliente en
 * Shopify). Los que se dieron de alta solos en la lista de/newsletter no.
 *
 * @param {object} p Perfil.
 * @returns {boolean}
 */
function vieneDeShopify(p) {
  return Boolean(p.attributes && p.attributes.external_id);
}

/**
 * Cantidad de pedidos que Klaviyo le conoce al perfil.
 *
 * @param {object} p Perfil.
 * @returns {number}
 */
function pedidosDe(p) {
  const props = (p.attributes && p.attributes.properties) || {};
  return Number(props["Orders.Count"] || 0);
}

// La API acepta maximo 100 correos por request ("Email address per request
// limit: 100"). Mandar mas de 100 da 400, asi que va en lotes.
const LOTE_SUPRESION = 100;

/**
 * Suprime perfiles (dejan de ser activos y no reciben email marketing).
 *
 * @param {string[]} emails Correos a suprimir.
 * @returns {Promise<{status:number, j:any, lotes:number, jobs:any[]}>}
 */
async function suprimir(emails) {
  if (!emails.length) return { status: 200, j: { data: [] }, lotes: 0, jobs: [] };
  const jobs = [];
  let ultimo = { status: 200, j: null };
  const lotes = Math.ceil(emails.length / LOTE_SUPRESION);
  for (let i = 0; i < emails.length; i += LOTE_SUPRESION) {
    const lote = emails.slice(i, i + LOTE_SUPRESION);
    const res = await api("POST", "/profile-suppression-bulk-create-jobs/", {
      data: {
        type: "profile-suppression-bulk-create-job",
        attributes: {
          profiles: {
            data: lote.map((email) => ({ type: "profile", attributes: { email } })),
          },
        },
      },
    });
    ultimo = res;
    jobs.push(res);
    if (res.status >= 400) break;
    // el rate limit es 75/s: con una pausa corta se alcanza bien
    await new Promise((res2) => setTimeout(res2, 60));
  }
  return { status: ultimo.status, j: ultimo.j, lotes, jobs };
}

/**
 * Suprime TODOS los miembros de un segmento o de una lista con un solo job.
 * Es la via oficial masiva: el segmento se define en el panel de Klaviyo (con
 * las condiciones que quiera el merchant) y aca se dispara.
 *
 * @param {string} id Id del segmento o de la lista.
 * @param {"segment"|"list"} [tipo]
 * @returns {Promise<{status:number, j:any}>}
 */
async function suprimirSegmento(id, tipo = "segment") {
  const type = tipo === "list" ? "list" : "segment";
  return api("POST", "/profile-suppression-bulk-create-jobs/", {
    data: {
      type: "profile-suppression-bulk-create-job",
      attributes: {},
      relationships: {
        [type]: { data: { type, id } },
      },
    },
  });
}

/**
 * Borra perfiles de verdad (job de privacidad de datos, asincrono).
 *
 * El endpoint acepta UN perfil por request: `attributes.profile.data` es un
 * solo objeto, no una lista.
 *
 * @param {string[]} ids ids de perfil.
 * @returns {Promise<{status:number, j:any, jobs:any[]}>}
 */
async function borrar(ids) {
  if (!ids.length) return { status: 200, j: { data: [] }, jobs: [] };
  const jobs = [];
  let ultimo = { status: 200, j: null };
  for (const id of ids) {
    const res = await api("POST", "/data-privacy-deletion-jobs/", {
      data: {
        type: "data-privacy-deletion-job",
        attributes: { profile: { data: { type: "profile", id } } },
      },
    });
    ultimo = res;
    jobs.push(res);
    if (res.status === 429) break;
  }
  return { status: ultimo.status, j: ultimo.j, jobs };
}

/**
 * Acota la lista de perfiles al limite del plan.
 *
 * Regla: se conservan los `limite` perfiles mas recientes (orden descendente)
 * y se saca el resto, del mas antiguo al mas nuevo.
 *
 * @param {object} [opciones]
 * @param {number} [opciones.limite] Maximo de perfiles activos (250).
 * @param {string} [opciones.orden] "created" (por defecto) o "updated".
 * @param {boolean} [opciones.protegerConPedidos] No suprimir perfiles con pedidos.
 * @param {boolean} [opciones.aplicar] false = solo informe.
 * @param {"suprimir"|"borrar"} [opciones.modo] Como se saca del camino.
 * @returns {Promise<object>} Informe.
 */
async function purgar(opciones = {}) {
  const limite = Number(opciones.limite || process.env.KLAVIYO_LIMITE_PERFILES || LIMITE_POR_DEFECTO);
  const orden = opciones.orden || process.env.KLAVIYO_PURGE_ORDEN || "created";
  if (!["created", "updated"].includes(orden)) {
    throw new Error("orden invalido: la API solo acepta created o updated");
  }
  const protegerConPedidos =
    opciones.protegerConPedidos !== undefined
      ? Boolean(opciones.protegerConPedidos)
      : process.env.KLAVIYO_PROTEGER_CON_PEDIDOS === "1";
  const aplicar = Boolean(opciones.aplicar);
  const modo = opciones.modo || process.env.KLAVIYO_PURGE_MODO || "suprimir";

  const perfiles = await listarPerfiles({ sort: "-" + orden });
  const total = perfiles.length;

  const informe = {
    total,
    limite,
    orden,
    protegerConPedidos,
    modo,
    aSuprimir: [],
    aBorrar: [],
    quedan: total,
    sobreElLimite: Math.max(0, total - limite),
    error: null,
  };

  if (total <= limite) {
    console.log("[klaviyo] " + total + " perfiles, limite " + limite + ": no hay nada que hacer.");
    return informe;
  }


  // La lista viene de mas nuevo a mas viejo: el sobrante es la cola.
  //
  // INVARIANTE: despues de purgar, todos los que quedan fuera de los 250 mas
  // recientes estan suprimidos. Como un perfil suprimido NO cuenta para el
  // limite de 250, da igual que el script no sepa cuales estaban ya
  // suprimidos: los activos siempre quedan dentro de los 250.
  const sobrante = perfiles.slice(limite);
  let candidatos = sobrante;
  if (protegerConPedidos) {
    candidatos = sobrante.filter((p) => pedidosDe(p) === 0);
    const conPedidos = sobrante.length - candidatos.length;
    if (conPedidos) {
      console.log(
        "[klaviyo] " + conPedidos + " perfiles con pedidos NO se tocan (protegerConPedidos=1)."
      );
      informe.quedan = limite + conPedidos;
    }
  }

  const spam = candidatos.filter((p) => !vieneDeShopify(p));
  const clientes = candidatos.filter((p) => vieneDeShopify(p));
  informe.aSuprimir = candidatos.map((p) => ({
    id: p.id,
    email: p.attributes.email,
    created: p.attributes.created,
    pedidos: pedidosDe(p),
    origen: vieneDeShopify(p) ? "shopify" : "signup",
  }));
  informe.spam = spam.length;
  informe.clientes = clientes.length;

  console.log("[klaviyo] " + total + " perfiles > limite " + limite + ": sobran " + sobrante.length + ".");
  console.log("[klaviyo]   de alta propia (newsletter): " + spam.length + " | de Shopify: " + clientes.length);
  informe.aSuprimir.slice(0, 15).forEach((p) => {
    console.log(
      "[klaviyo]   - " + p.created + " | " + p.email + " | pedidos: " + p.pedidos + " | " + p.origen
    );
  });
  if (informe.aSuprimir.length > 15) {
    console.log("[klaviyo]   ... y " + (informe.aSuprimir.length - 15) + " mas");
  }

  if (!aplicar) {
    console.log("[klaviyo] (dry-run: no se borro nada)");
    return informe;
  }

  if (modo === "borrar") {
    const res = await borrar(candidatos.map((p) => p.id));
    informe.aBorrar = informe.aSuprimir;
    informe.error = res.status !== 202 ? JSON.stringify(res.j).slice(0, 300) : null;
    console.log("[klaviyo] job de borrado enviado: " + res.status + (informe.error ? " ERROR " + informe.error : ""));
  } else {
    const res = await suprimir(candidatos.map((p) => p.attributes.email));
    informe.error = res.status >= 400 ? JSON.stringify(res.j).slice(0, 300) : null;
    console.log(
      "[klaviyo] job de supresion enviado: " + res.status + " (" + candidatos.length + " perfiles)" + (informe.error ? " ERROR " + informe.error : "")
    );
  }
  informe.quedan = total - candidatos.length;
  return informe;
}

module.exports = {
  activo,
  api,
  listarPerfiles,
  purgar,
  suprimir,
  suprimirSegmento,
  borrar,
  vieneDeShopify,
  pedidosDe,
  LIMITE_POR_DEFECTO,
};
