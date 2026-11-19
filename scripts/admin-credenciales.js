/**
 * Helper: deja las credenciales del app con permisos extra en el .env y
 * comprueba si los scopes sirvieron.
 *
 * Uso:
 *   node scripts/admin-credenciales.js <client_id> <client_secret>
 *   node scripts/admin-credenciales.js            (solo testea lo que hay en el .env)
 *
 * Escribe SHOPIFY_ADMIN_CLIENT_ID / SHOPIFY_ADMIN_CLIENT_SECRET en el .env
 * (los usa scripts/admin-tareas-permisos.js) y prueba los scopes.
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");

const RAIZ = path.join(__dirname, "..");
const ENV_PATH = path.join(RAIZ, ".env");

async function scopesDe(client_id, client_secret) {
  const shop = process.env.SHOPIFY_SHOP;
  const r = await fetch(`https://${shop}.myshopify.com/admin/oauth/access_token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_id, client_secret, grant_type: "client_credentials" }),
  });
  const txt = await r.text();
  let j;
  try { j = JSON.parse(txt); } catch { return { ok: false, error: `HTTP ${r.status}: ${txt.slice(0, 120).replace(/\s+/g, " ")}` }; }
  if (!j.access_token) return { ok: false, error: JSON.stringify(j).slice(0, 160) };
  return { ok: true, token: j.access_token, scope: j.scope || "" };
}

(async () => {
  const [, , cid, sec] = process.argv;
  let client_id = cid;
  let client_secret = sec;

  if (client_id && client_secret) {
    // guardar en el .env
    let env = fs.readFileSync(ENV_PATH, "utf8");
    const set = (txt, key, val) => {
      const re = new RegExp(`^${key}=.*$`, "m");
      return re.test(txt) ? txt.replace(re, `${key}=${val}`) : txt.replace(/\n?$/, `\n${key}=${val}\n`);
    };
    env = set(env, "SHOPIFY_ADMIN_CLIENT_ID", client_id);
    env = set(env, "SHOPIFY_ADMIN_CLIENT_SECRET", client_secret);
    fs.writeFileSync(ENV_PATH, env);
    console.log("  .env actualizado con SHOPIFY_ADMIN_CLIENT_ID / _SECRET");
  } else {
    client_id = process.env.SHOPIFY_ADMIN_CLIENT_ID || process.env.SHOPIFY_CLIENT_ID;
    client_secret = process.env.SHOPIFY_ADMIN_CLIENT_SECRET || process.env.SHOPIFY_CLIENT_SECRET;
    console.log("  (sin argumentos: pruebo lo que hay en el .env)");
  }

  const r = await scopesDe(client_id, client_secret);
  if (!r.ok) {
    console.log("  NO FUNCIONA: " + r.error);
    console.log("  -> revisa que el client_id y el client_secret sean del MISMO app.");
    process.exit(1);
  }
  console.log("  OK. Scopes del token:");
  console.log("    " + r.scope);

  const shop = process.env.SHOPIFY_SHOP;
  const H = { "X-Shopify-Access-Token": r.token, "Content-Type": "application/json" };
  const A = `https://${shop}.myshopify.com/admin/api/2026-01`;
  const gql = async (q) => (await (await fetch(A + "/graphql.json", { method: "POST", headers: H, body: JSON.stringify({ query: q }) })).json());

  const pruebas = [
    ["menus (write_online_store_navigation)", `{ menus(first:1){ nodes{ id title } } }`],
    ["politicas (write_legal_policies)", `mutation { shopPolicyUpdate(shopPolicy:{type: SHIPPING_POLICY, body:"<p>prueba</p>"}) { userErrors { message } } }`],
    ["colecciones (read_collections)", `{ collections(first:1){ nodes{ id handle } } }`],
  ];
  for (const [nombre, q] of pruebas) {
    const j = await gql(q);
    const ok = !j.errors;
    console.log("    " + (ok ? "OK  " : "FALTA") + "  " + nombre);
  }
})();
