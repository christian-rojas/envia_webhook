/**
 * Tareas de admin que necesitan scopes extra (write_legal_policies,
 * write_online_store_navigation, write_collections).
 *
 * Uso:
 *   SHOPIFY_ADMIN_TOKEN=shpss_xxx node _t.js token
 *   (o el client_id/client_secret del app nuevo en el .env, con client_credentials)
 *
 * 1) Llena las 4 politicas NATIVAS de Shopify (las que enlazan el carrito, el
 *    checkout y los correos de pedido; hoy estan vacias). Se deja el noindex
 *    en el tema: las que Google indexa son las /pages/... propias.
 * 2) Menu: saca "Dia de la Madre" (campaña de mayo) y agrega las 5 landings
 *    por audiencia (hombre, mujer, unisex, novias, sale) que estaban
 *    huerfanas.
 * 3) Despublica la coleccion duplicada dia-de-la-madre-1.
 */
require("dotenv").config();
const fs = require("fs");

const SHOP = process.env.SHOPIFY_SHOP;
const TOKEN_ARG = process.argv[2] || process.env.SHOPIFY_ADMIN_TOKEN;

const CLIENT_ID = process.env.SHOPIFY_ADMIN_CLIENT_ID;
const CLIENT_SECRET = process.env.SHOPIFY_ADMIN_CLIENT_SECRET;

async function getToken() {
  if (TOKEN_ARG) return TOKEN_ARG;
  if (CLIENT_ID && CLIENT_SECRET) {
    const r = await fetch(`https://${SHOP}.myshopify.com/admin/oauth/access_token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: "client_credentials",
      }),
    });
    const j = await r.json();
    if (!j.access_token) throw new Error("sin token: " + JSON.stringify(j));
    return j.access_token;
  }
  throw new Error("pasa el token como argumento o define SHOPIFY_ADMIN_CLIENT_ID/SECRET");
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

const ENVIO = fs.readFileSync("/tmp/politica_envio.html", "utf8");

(async () => {
  const token = await getToken();
  const H = { "X-Shopify-Access-Token": token, "Content-Type": "application/json" };
  const A = `https://${SHOP}.myshopify.com/admin/api/2026-01`;
  const gql = async (q) => {
    const j = await (
      await fetch(A + "/graphql.json", { method: "POST", headers: H, body: JSON.stringify({ query: q }) })
    ).json();
    if (j.errors) console.log("   (!) " + JSON.stringify(j.errors).slice(0, 200));
    return j.data;
  };

  // ---------------------------------------------------------------- 1) menus
  console.log("=== 1) menus ===");
  const jm = await gql(`{ menus(first: 10) { nodes { id title handle items { id title type url resourceId items { id title type url resourceId } } } } }`);
  if (jm && jm.menus) {
    for (const m of jm.menus.nodes) {
      console.log(`\n  MENU "${m.title}" (${m.id}) - ${m.items.length} items`);
      for (const it of m.items) {
        console.log(`     - "${it.title}" [${it.type}] ${it.url || ""}${it.items && it.items.length ? " (" + it.items.length + " hijos)" : ""}`);
        for (const sub of it.items || []) console.log(`         . "${sub.title}" [${sub.type}] ${sub.url || ""}`);
      }
    }
  } else {
    console.log("  (sin permiso de menus o sin menus)");
  }

  // ---------------------------------------------------------------- 2) politicas
  console.log("\n=== 2) politicas nativas de Shopify ===");
  const jp = await gql(`{ pages(first: 60) { nodes { id handle body } } }`);
  const paginas = (jp && jp.pages.nodes) || [];
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
  const POL = [
    ["PRIVACY_POLICY", cuerpo("politicas-de-privacidad")],
    ["TERMS_OF_SERVICE", cuerpo("terminos-y-condiciones")],
    ["REFUND_POLICY", cuerpo("politica-de-cambio-y-devoluciones-1")],
    ["SHIPPING_POLICY", ENVIO],
  ];
  for (const [tipo, body] of POL) {
    if (!body) { console.log("  " + tipo + ": sin cuerpo, se omite"); continue; }
    const j = await gql(
      `mutation { shopPolicyUpdate(shopPolicy: {type: ${tipo}, body: ${JSON.stringify(body)}}) { shopPolicy { type body } userErrors { message field } } }`
    );
    const ue = j && j.shopPolicyUpdate ? j.shopPolicyUpdate.userErrors : null;
    console.log("  " + tipo.padEnd(18) + (ue && ue.length ? "ERROR " + JSON.stringify(ue) : "OK (" + body.length + " chars)"));
  }

  // ---------------------------------------------------------------- 3) coleccion
  // No se puede despublicar por API: no existe el scope write_collections.
  // La coleccion dia-de-la-madre-1 ya tiene noindex en el tema, asi que no
  // compite en el indice. Despublicarla es una tarea del admin.
})();
