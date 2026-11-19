/**
 * Tareas de admin que necesitan permisos extra (write_legal_policies +
 * write_online_store_navigation).
 *
 *   node scripts/admin-tareas-permisos.js            -> dry-run (imprime, no escribe)
 *   node scripts/admin-tareas-permisos.js --aplicar   -> escribe
 *
 * 1) Llena las 4 politicas NATIVAS de Shopify (/policies/...), que hoy estan
 *    vacias y son las que enlazan el carrito, el checkout y los correos de
 *    pedido. Se deja el noindex en el tema: las que Google indexa siguen
 *    siendo las /pages/... propias.
 * 2) Arregla el menu principal: el item "Chiporros" apuntaba a la coleccion
 *    de la campana de mayo (/collections/dia-de-la-madre); ahora apunta a la
 *    coleccion Chiporros. Y agrega las 5 landings por auditoria, que estaban
 *    huerfanas (nadie las enlazaba).
 * 3) Mete la campana de mayo en el menu del pie, donde no estorba.
 *
 * El menuUpdate REEMPLAZA el menu completo, asi que se reenvian TODOS los
 * items con sus ids. Por eso el dry-run primero.
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");

const RAIZ = path.join(__dirname, "..");
const APLICAR = process.argv.includes("--aplicar");
const ENV_PATH = path.join(RAIZ, "..", "envia_webhook", ".env");

// --- permisos: primero el admin (nuevo), si no, el del .env ----------------
async function tokenAdmin() {
  const shop = process.env.SHOPIFY_SHOP;
  const par = [
    ["SHOPIFY_ADMIN_CLIENT_ID", "SHOPIFY_ADMIN_CLIENT_SECRET"],
    ["SHOPIFY_CLIENT_ID", "SHOPIFY_CLIENT_SECRET"],
  ];
  for (const [idK, secK] of par) {
    if (!process.env[idK] || !process.env[secK]) continue;
    const r = await fetch(`https://${shop}.myshopify.com/admin/oauth/access_token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_id: process.env[idK],
        client_secret: process.env[secK],
        grant_type: "client_credentials",
      }),
    });
    const t = await r.json().catch(() => ({}));
    if (t.access_token) return { token: t.access_token, scope: t.scope || "", de: idK };
  }
  throw new Error("no se pudo obtener un token");
}

function limpiar(html) {
  return String(html)
    .replace(/<meta[^>]*charset[^>]*>/gi, "")
    .replace(/<\/strong><strong>/gi, "")
    .replace(/<\/em><em>/gi, "")
    .replace(/<\/b><b>/gi, "")
    .replace(/<p>\s*\*\*([^*]+)\*\*\s*<\/p>/gi, "<p><strong>$1</strong></p>")
    .replace(/&nbsp;/gi, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

(async () => {
  const { token, scope, de } = await tokenAdmin();
  console.log(`  token: ${de} | scopes: ${scope.split(",").length}\n`);
  const H = { "X-Shopify-Access-Token": token, "Content-Type": "application/json" };
  const A = `https://${process.env.SHOPIFY_SHOP}.myshopify.com/admin/api/2026-01`;
  const gql = async (q, variables) => {
    const r = await (
      await fetch(A + "/graphql.json", {
        method: "POST",
        headers: H,
        body: JSON.stringify({ query: q, variables }),
      })
    ).json();
    if (r.errors) console.log("   (!) " + JSON.stringify(r.errors).slice(0, 250));
    return r.data;
  };

  const MENU_MAIN = "gid://shopify/Menu/194151743711";
  const MENU_FOOTER = "gid://shopify/Menu/194151776479";
  const CHIPORROS = "gid://shopify/Collection/527838642399";

  // ---------------------------------------------------------------- 1) politicas
  console.log("=== 1) politicas nativas de Shopify ===");
  const jp = await gql(`{ pages(first: 60) { nodes { id handle body } } }`);
  const paginas = jp.pages.nodes;
  const cuerpo = (h) => {
    const p = paginas.find((x) => x.handle === h);
    if (!p) return null;
    let b = limpiar(p.body);
    if (h === "politica-de-cambio-y-devoluciones-1") {
      b = b.replace(
        /<a href="https:\/\/mondano\.reversso\.cl\/"[^>]*>\s*<img[^>]*>\s*<\/a>\s*<a href="https:\/\/mondano\.reversso\.cl\/"[^>]*>\s*<\/a>/i,
        '<p>Para gestionar tu cambio o devolución, entra al <a href="https://mondano.reversso.cl/">portal de cambios y devoluciones</a> (el botón está al pie de esta página).</p>'
      );
      b = b.replace(/<p>\s*<em>\s*\*\*has click en el botón superior[^<]*<\/em>\s*<\/p>/gi, "");
      b = b.replace(/<strong>\s*<\/strong>/gi, "");
    }
    return b;
  };
  const POLITICAS = [
    ["PRIVACY_POLICY", cuerpo("politicas-de-privacidad")],
    ["TERMS_OF_SERVICE", cuerpo("terminos-y-condiciones")],
    ["REFUND_POLICY", cuerpo("politica-de-cambio-y-devoluciones-1")],
    ["SHIPPING_POLICY", fs.readFileSync(path.join(__dirname, "politica-envio.html"), "utf8")],
  ];
  for (const [tipo, body] of POLITICAS) {
    if (!body) { console.log(`  ${tipo}: sin cuerpo, se omite`); continue; }
    if (!APLICAR) { console.log(`  ${tipo.padEnd(18)} (dry-run) ${body.length} chars`); continue; }
    const j = await gql(
      `mutation($t: ShopPolicyType!, $b: String!) { shopPolicyUpdate(shopPolicy: {type: $t, body: $b}) { shopPolicy { type } userErrors { message field } } }`,
      { t: tipo, b: body }
    );
    const ue = j && j.shopPolicyUpdate ? j.shopPolicyUpdate.userErrors : null;
    console.log(`  ${tipo.padEnd(18)} ${ue && ue.length ? "ERROR " + JSON.stringify(ue).slice(0, 120) : "OK (" + body.length + " chars)"}`);
  }

  // ---------------------------------------------------------------- 2) menu
  console.log("\n=== 2) menu principal ===");
  const jm = await gql(`{
    menus(first: 10) { nodes { id title handle items {
      id title type url resourceId
      items { id title type url resourceId items { id title type url resourceId } }
    } } }
  }`);
  const menu = jm.menus.nodes.find((m) => m.id === MENU_MAIN);
  if (!menu) { console.log("  no se encontro el menu principal"); return; }

  // Reconstruye TODOS los items (menuUpdate reemplaza el menu entero).
  const clonar = (items) =>
    items.map((it) => {
      const o = { title: it.title, type: it.type, url: it.url };
      if (it.id) o.id = it.id;
      if (it.resourceId) o.resourceId = it.resourceId;
      if (it.items && it.items.length) o.items = clonar(it.items);
      return o;
    });

  const nuevos = clonar(menu.items);

  // a) El item "Chiporros" del menu apuntaba a la campana de mayo
  //    (/collections/dia-de-la-madre): etiqueta y destino no coincidian.
  //    Si la coleccion Chiporros esta publicada, el item apunta a ella;
  //    si no (no se puede publicar por API: falta write_publications), el
  //    item queda con la etiqueta que SI corresponde a su destino, para no
  //    dejar un 404 en el menu.
  const tienda = nuevos.find((i) => i.title === "Tienda");
  let corregido = false;
  let destinoChiporros = "/collections/dia-de-la-madre";
  let etiquetaChiporros = "Día de la Madre";
  const rChip = await fetch("https://mondano.cl/collections/chiporros", {
    headers: { "user-agent": "Mozilla/5.0" },
  });
  if (rChip.status === 200) {
    destinoChiporros = "/collections/chiporros";
    etiquetaChiporros = "Chiporros";
  }
  if (tienda && tienda.items) {
    for (const it of tienda.items) {
      if (
        it.resourceId === "gid://shopify/Collection/436978778335" ||
        it.resourceId === CHIPORROS
      ) {
        it.resourceId = destinoChiporros === "/collections/chiporros" ? CHIPORROS : "gid://shopify/Collection/436978778335";
        it.url = destinoChiporros;
        it.title = etiquetaChiporros;
        corregido = true;
      }
    }
  }
  console.log("  item del menu -> " + etiquetaChiporros + " (" + destinoChiporros + "): " + (corregido ? "SI" : "no se encontro"));

  // b) las 5 landings por auditoria, que estaban huerfanas.
  const LANDINGS = [
    { title: "Para ella", url: "/pages/mujer" },
    { title: "Para él", url: "/pages/hombre" },
    { title: "Unisex", url: "/pages/unisex" },
  ];
  if (tienda && tienda.items) {
    const yaEsta = new Set(tienda.items.map((i) => i.url));
    for (const l of LANDINGS) {
      if (!yaEsta.has(l.url)) tienda.items.push({ title: l.title, type: "HTTP", url: l.url });
    }
  }
  // c) dos landings que van arriba (campanas)
  const extra = [
    { title: "Novias", type: "HTTP", url: "/pages/novias" },
    { title: "Ofertas", type: "HTTP", url: "/pages/sale" },
  ];
  for (const e of extra) {
    if (!nuevos.some((i) => i.url === e.url)) {
      const idx = nuevos.findIndex((i) => i.title === "Cambios y devoluciones");
      nuevos.splice(idx > 0 ? idx : nuevos.length, 0, e);
    }
  }

  const mostrar = (items, nivel = 1) => {
    for (const it of items) {
      console.log("  ".repeat(nivel) + `- "${it.title}" [${it.type}] ${it.url || ""}`);
      if (it.items) mostrar(it.items, nivel + 1);
    }
  };
  console.log("  estructura nueva:");
  mostrar(nuevos);

  if (!APLICAR) {
    console.log("\n  (dry-run: no se escribio nada. Usa --aplicar)");
    return;
  }

  const jmu = await gql(
    `mutation($id: ID!, $title: String!, $items: [MenuItemUpdateInput!]!) { menuUpdate(id: $id, title: $title, items: $items) { menu { id title } userErrors { message field } } }`,
    { id: MENU_MAIN, title: menu.title, items: nuevos }
  );
  const ue = jmu && jmu.menuUpdate ? jmu.menuUpdate.userErrors : null;
  console.log("\n  menuUpdate principal: " + (ue && ue.length ? "ERROR " + JSON.stringify(ue).slice(0, 300) : "OK"));

  // ---------------------------------------------------------------- 3) pie
  console.log("\n=== 3) menu del pie (campana de mayo) ===");
  const jf = await gql(`{ menus(first: 10) { nodes { id title items { id title type url resourceId } } } }`);
  const pie = jf.menus.nodes.find((m) => m.id === MENU_FOOTER);
  if (!pie) { console.log("  no se encontro el menu del pie"); return; }
  const itemsPie = pie.items.map((it) => {
    const o = { title: it.title, type: it.type, url: it.url };
    if (it.id) o.id = it.id;
    if (it.resourceId) o.resourceId = it.resourceId;
    return o;
  });
  if (!itemsPie.some((i) => i.url === "/collections/dia-de-la-madre")) {
    itemsPie.push({
      title: "Día de la Madre",
      type: "HTTP",
      url: "/collections/dia-de-la-madre",
    });
  }
  if (!APLICAR) { console.log("  (dry-run)"); return; }
  const jfu = await gql(
    `mutation($id: ID!, $title: String!, $items: [MenuItemUpdateInput!]!) { menuUpdate(id: $id, title: $title, items: $items) { menu { id title } userErrors { message field } } }`,
    { id: MENU_FOOTER, title: pie.title, items: itemsPie }
  );
  const ue2 = jfu && jfu.menuUpdate ? jfu.menuUpdate.userErrors : null;
  console.log("  menuUpdate pie: " + (ue2 && ue2.length ? "ERROR " + JSON.stringify(ue2).slice(0, 300) : "OK"));
})();
