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
async function listarPerfiles({ sort = "-created", pageSize = 100, maxPaginas = 0 } = {}) {
  const todos = [];
  // Se sigue el link "next" tal cual lo devuelve Klaviyo: el cursor viene
  // URL-codificado (page%5Bcursor%5D=) y reconstruirlo a mano lo rompe
  // ("Invalid page cursor") y hace que la lista se corte en la primera pagina.
  let url =
    "https://a.klaviyo.com/api/profiles/?sort=" +
    encodeURIComponent(sort) +
    "&page[size]=" +
    pageSize;
  const tope = maxPaginas > 0 ? maxPaginas : 2000;
  for (let pagina = 0; pagina < tope && url; pagina++) {
    const r = await fetch(url, { headers: headers() });
    const texto = await r.text();
    let j = null;
    try {
      j = JSON.parse(texto);
    } catch (e) {
      j = texto;
    }
    if (r.status !== 200) {
      console.error("[klaviyo] listando perfiles: " + r.status + " " + JSON.stringify(j).slice(0, 200));
      break;
    }
    todos.push(...(j.data || []));
    url = j.links && j.links.next ? j.links.next : null;
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
  // hay perfiles sin email (los crea el spam sin correo): la API no los
  // acepta en un job por email, y ademas sin email no son "activos" ni
  // cuentan para el limite.
  emails = (emails || []).filter(Boolean);
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
 * Lista los perfiles de un segmento (son los que pueden recibir email).
 *
 * @param {string} id Id del segmento.
 * @param {number} maxPaginas Tope de paginas.
 * @returns {Promise<object[]>}
 */
async function listarSegmento(id, maxPaginas) {
  const todos = [];
  let url = "https://a.klaviyo.com/api/segments/" + id + "/profiles/?page[size]=100";
  for (let pagina = 0; pagina < (maxPaginas || 100) && url; pagina++) {
    const r = await fetch(url, { headers: headers() });
    const texto = await r.text();
    let j = null;
    try {
      j = JSON.parse(texto);
    } catch (e) {
      j = texto;
    }
    if (r.status !== 200) {
      console.error("[klaviyo] listando el segmento: " + r.status + " " + JSON.stringify(j).slice(0, 200));
      break;
    }
    todos.push(...(j.data || []));
    url = j.links && j.links.next ? j.links.next : null;
  }
  return todos;
}

/**
 * Un perfil es BASURA si no hay ningun rastro de que sea de la tienda:
 * no acepto marketing, no tiene pedidos y no viene de Shopify. Es el perfil
 * que deja el trafico de bots (y el spam del formulario).
 *
 * Un perfil es CLIENTE/SUSCRIPTOR en cualquier otro caso. A esos no se los
 * toca: son los que hay que mantener para poder escribirles.
 *
 * @param {object} p Perfil.
 * @returns {boolean}
 */
function esBasura(p) {
  if (vieneDeShopify(p)) return false;
  if (pedidosDe(p) > 0) return false;
  const props = (p.attributes && p.attributes.properties) || {};
  if (props["Accepts Marketing"] === true) return false;
  return true;
}

/**
 * Acota la lista de perfiles al limite del plan.
 *
 * Regla (por defecto): se suprime la BASURA (bots y spam sin relacion con la
 * tienda). Se conservan intactos los clientes y los suscriptores, aunque
 * sigan siendo mas de 250.
 *
 * Modo "fifo": se conservan los `limite` perfiles mas recientes (orden
 * descendente) y se suprime el resto, del mas antiguo al mas nuevo. OJO:
 * con la base de suscriptores real de la tienda (mas de 10.000), este modo
 * suprime suscriptores de verdad, no basura. Hay que activarlo a proposito.
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

  // El segmento de basura (creado en el panel o por la API) se suprime con
  // un solo job: es la via rapida y la que alcanza lo que la enumeracion no
  // alcanza cuando el Segmento ya lo tiene.
  const segmentoBasura = opciones.segmentoBasura || process.env.KLAVIYO_SEGMENTO_BASURA || "";
  let suprimidosPorSegmento = 0;
  if (segmentoBasura && aplicar) {
    const rs = await suprimirSegmento(segmentoBasura, "segment");
    console.log("[klaviyo] job de supresion del segmento " + segmentoBasura + ": " + rs.status);
    if (rs.status >= 400) console.log("[klaviyo]   " + JSON.stringify(rs.j).slice(0, 200));
  }

  // La enumeracion se acota: la funcion de Vercel tiene 60 s de techo y
  // con 60.000 perfiles el listado completo se pasa de largo.
  const maxPaginas = Number(opciones.maxPaginas || process.env.KLAVIYO_MAX_PAGINAS || 60);
  const perfiles = await listarPerfiles({ sort: "-" + orden, maxPaginas });
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

  if (total <= limite && !segmentoBasura) {
    console.log("[klaviyo] " + total + " perfiles, limite " + limite + ": no hay nada que hacer.");
    return informe;
  }


  const fifo = opciones.fifo === true || process.env.KLAVIYO_PURGE_FIFO === "1";
  const ventana = Number(opciones.ventana || process.env.KLAVIYO_VENTANA_DIAS || 14);
  const segmentoActivos = opciones.segmentoActivos || process.env.KLAVIYO_SEGMENTO_ACTIVOS || "";

  // REGLA DE LA TIENDA: de la base de clientes y suscriptores solo interesa
  // la gente que compro en la ventana reciente (2 semanas por defecto). El
  // resto se suprime: son clientes de 2021-2025 que no vuelven y que, de no
  // suprimirse, dejan la cuenta en miles de perfiles activos (el plan gratis
  // permite 250).
  //
  // La lista de la ventana sale de SHOPIFY (la fuente de verdad): en Klaviyo
  // los eventos de pedido todavia no han sincronizado.
  if (!fifo && segmentoActivos) {
    const keep = await compradoresRecientes(ventana);
    console.log("[klaviyo] ventana de " + ventana + " dias: " + keep.size + " compradores (se conservan).");
    const activos = await listarSegmento(segmentoActivos, maxPaginas);
    console.log("[klaviyo] perfiles alcanzables: " + activos.length + " (los leidos; puede haber mas).");
    const aSuprimir = [];
    const conservados = [];
    for (const p of activos) {
      const email = (p.attributes.email || "").toLowerCase().trim();
      if (email && keep.has(email)) conservados.push(p);
      else aSuprimir.push(p);
    }
    console.log(
      "[klaviyo] a conservar: " + conservados.length + " | a suprimir: " + aSuprimir.length
    );
    if (!aplicar) {
      console.log("[klaviyo] (dry-run: no se borro nada)");
      informe.aSuprimir = aSuprimir.map((p) => ({ id: p.id, email: p.attributes.email, created: p.attributes.created, pedidos: pedidosDe(p), origen: vieneDeShopify(p) ? "shopify" : "signup" }));
      informe.conservados = conservados.length;
      return informe;
    }
    const correos = aSuprimir.map((p) => p.attributes.email).filter(Boolean);
    const res = await suprimir(correos);
    informe.aSuprimir = aSuprimir.length;
    informe.conservados = conservados.length;
    informe.error = res.status >= 400 ? JSON.stringify(res.j).slice(0, 300) : null;
    console.log(
      "[klaviyo] supresion: " + res.jobs.length + " lotes de 100, status " + res.status + (informe.error ? " ERROR " + informe.error : "")
    );
    informe.quedan = conservados.length;
    return informe;
  }
  let candidatos;
  if (fifo) {
    // Modo estricto: se conservan los `limite` mas recientes y se suprime el
    // resto, empezando por el mas antiguo.
    const sobrante = perfiles.slice(limite);
    candidatos = sobrante;
    if (protegerConPedidos) {
      candidatos = sobrante.filter((p) => pedidosDe(p) === 0);
      const conPedidos = sobrante.length - candidatos.length;
      if (conPedidos) {
        console.log("[klaviyo] " + conPedidos + " perfiles con pedidos NO se tocan.");
        informe.quedan = limite + conPedidos;
      }
    }
  } else {
    // Modo por defecto: solo se va la basura (bots y spam). Los clientes y
    // los suscriptores se quedan, aunque el total pase de 250.
    candidatos = perfiles.filter(esBasura);
    const basura = candidatos.length;
    const quedanActivos = perfiles.length - basura;
    console.log(
      "[klaviyo] " + perfiles.length + " perfiles: " + basura + " son basura (sin consentimiento, sin pedidos, sin Shopify). Se conservan " + quedanActivos + "."
    );
    if (quedanActivos > limite) {
      console.log(
        "[klaviyo] AVISO: quedan " + quedanActivos + " perfiles activos y el plan gratis permite " + limite + ". Los sobrantes son clientes y suscriptores: para eso hay que cambiar de plan (KLAVIYO_PURGE_FIFO=1 los suprime, pero se lleva suscriptores reales)."
      );
    }
    informe.quedan = quedanActivos;
  }
  informe.fifo = fifo;

  const spam = candidatos.filter((p) => !vieneDeShopify(p) && pedidosDe(p) === 0);
  const clientes = candidatos.filter((p) => vieneDeShopify(p) || pedidosDe(p) > 0);
  informe.aSuprimir = candidatos.map((p) => ({
    id: p.id,
    email: p.attributes.email,
    created: p.attributes.created,
    pedidos: pedidosDe(p),
    origen: vieneDeShopify(p) ? "shopify" : "signup",
  }));
  informe.spam = spam.length;
  informe.clientes = clientes.length;

  console.log(
    "[klaviyo] " + total + " perfiles vistos | a suprimir: " + candidatos.length + " (modo " + (fifo ? "fifo" : "solo basura") + ")"
  );
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


/**
 * Correos que compraron en los ultimos N dias, segun Shopify (fuente de
 * verdad: en Klaviyo los eventos de pedido todavia no han sincronizado).
 *
 * @param {number} dias Ventana en dias.
 * @returns {Promise<Set<string>>} Correos con al menos un pedido en la ventana.
 */
async function compradoresRecientes(dias) {
  const shop = process.env.SHOPIFY_SHOP;
  const t = await (
    await fetch(`https://${shop}.myshopify.com/admin/oauth/access_token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_id: process.env.SHOPIFY_ADMIN_CLIENT_ID,
        client_secret: process.env.SHOPIFY_ADMIN_CLIENT_SECRET,
        grant_type: "client_credentials",
      }),
    })
  ).json();
  const limite = new Date(Date.now() - dias * 86400000).toISOString();
  const q = `{
    orders(first: 250, query: "created_at:>=${limite}", sortKey: CREATED_AT, reverse: true) {
      nodes { email createdAt }
    }
  }`;
  const r = await fetch(`https://${shop}.myshopify.com/admin/api/2026-01/graphql.json`, {
    method: "POST",
    headers: { "X-Shopify-Access-Token": t.access_token, "Content-Type": "application/json" },
    body: JSON.stringify({ query: q }),
  });
  const j = await r.json();
  if (!j.data || !j.data.orders) {
    console.error("[klaviyo] no se pudieron leer los pedidos: " + JSON.stringify(j.errors || j).slice(0, 200));
    return new Set();
  }
  const correos = new Set();
  for (const o of j.data.orders.nodes) {
    if (o.email) correos.add(o.email.toLowerCase().trim());
  }
  return correos;
}

module.exports = {
  activo,
  compradoresRecientes,
  api,
  listarPerfiles,
  listarSegmento,
  purgar,
  suprimir,
  suprimirSegmento,
  borrar,
  vieneDeShopify,
  pedidosDe,
  esBasura,
  LIMITE_POR_DEFECTO,
};
