/**
 * Atributos de producto para el feed de Google: color, talla, genero, edad.
 *
 *   node scripts/admin-atributos-feed.js            -> dry-run
 *   node scripts/admin-atributos-feed.js --aplicar   -> escribe
 *
 * Escribe (texto plano, no necesita scopes extra):
 *   custom.color      color con el nombre estandar de Shopify (black, beige,
 *                     light blue, multicolor...), deducido de las fotos.
 *   custom.size       tallas de la opcion "Talla" del producto.
 *   custom.age_group  adult
 *   custom.gender     copiado de custom.target_gender (ya esta en los 105).
 *
 * Con --metaobjects (necesita read_metaobjects) escribe ademas
 *   shopify.color-pattern   mismo valor, pero como referencia a los
 *                            metaobjetos de color: es lo que el canal
 *                            Google & YouTube lee por defecto.
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");

const APLICAR = process.argv.includes("--aplicar");
const CON_METAOBJECTS = process.argv.includes("--metaobjects");
const MAPA = process.env.MAPA_COLORES || path.join(__dirname, "colores-productos.json");

async function gql(query, variables) {
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
  if (!t.access_token) throw new Error("sin token: " + JSON.stringify(t).slice(0, 200));
  const H = { "X-Shopify-Access-Token": t.access_token, "Content-Type": "application/json" };
  const A = `https://${shop}.myshopify.com/admin/api/2026-01`;
  const resp = await fetch(A + "/graphql.json", {
    method: "POST",
    headers: H,
    body: JSON.stringify({ query, variables }),
  });
  const txt = await resp.text();
  if (!txt) {
    console.log("   (!) respuesta vacia, status " + resp.status);
    return null;
  }
  const r = JSON.parse(txt);
  if (r.errors) console.log("   (!) " + JSON.stringify(r.errors).slice(0, 280));
  return r.data;
}

(async () => {
  const mapa = JSON.parse(fs.readFileSync(MAPA, "utf8"));
  const porHandle = new Map((Array.isArray(mapa) ? mapa : []).map((x) => [x.handle, x]));

  const datos = await gql(`{
    products(first: 250, query: "status:active") {
      nodes {
        id handle title productType
        options { name values }
        metafields(first: 30) { nodes { namespace key value type } }
      }
    }
  }`);
  if (!datos || !datos.products) {
    console.log("  no se pudieron leer los productos");
    return;
  }
  const productos = datos.products.nodes;

  // GIDs de los metaobjetos de color (solo si el scope deja leerlos).
  let gids = null;
  if (CON_METAOBJECTS) {
    const mo = await gql(`{
      metaobjects(first: 250, type: "shopify_color_pattern") { nodes { id handle displayName } }
    }`);
    if (mo && mo.metaobjects) {
      gids = new Map(mo.metaobjects.nodes.map((n) => [n.handle, n.id]));
      console.log(`  metaobjetos de color leidos: ${gids.size}`);
    } else {
      console.log("  no se pudieron leer los metaobjetos (falta read_metaobjects)");
    }
  }

  const plan = [];
  for (const p of productos) {
    const info = porHandle.get(p.handle);
    if (!info || !info.color) continue;
    const mf = p.metafields.nodes;
    const opTalla = p.options.find((o) => /talla|size|tama/i.test(o.name));
    const genero = (mf.find((m) => m.namespace === "custom" && m.key === "target_gender") || {}).value || "Unisex";
    const campos = [
      { namespace: "custom", key: "color", type: "single_line_text_field", value: info.color },
      { namespace: "custom", key: "size", type: "single_line_text_field", value: opTalla ? opTalla.values.join(", ") : "" },
      { namespace: "custom", key: "age_group", type: "single_line_text_field", value: "adult" },
      { namespace: "custom", key: "gender", type: "single_line_text_field", value: genero },
    ];
    if (gids && gids.has(info.color)) {
      campos.push({
        namespace: "shopify",
        key: "color-pattern",
        type: "list.metaobject_reference",
        value: JSON.stringify([gids.get(info.color)]),
      });
    }
    plan.push({ id: p.id, title: p.title, color: info.color, genero, tallas: opTalla ? opTalla.values.length : 0, campos });
  }

  console.log(`\n  productos a actualizar: ${plan.length}`);
  const conteo = {};
  plan.forEach((x) => (conteo[x.color] = (conteo[x.color] || 0) + 1));
  Object.entries(conteo).sort((a, b) => b[1] - a[1]).forEach(([c, n]) => console.log(`    ${String(n).padStart(3)}x ${c}`));

  if (!APLICAR) {
    console.log("\n  (dry-run: no se escribio nada. Usa --aplicar)");
    return;
  }

  // Backup del estado actual.
  const backup = productos.map((p) => ({
    id: p.id,
    handle: p.handle,
    title: p.title,
    metafields: p.metafields.nodes
      .filter((m) => m.namespace === "custom" || m.namespace === "shopify")
      .map((m) => ({ namespace: m.namespace, key: m.key, type: m.type, value: m.value })),
  }));
  const back = path.join(__dirname, "..", "..", "mondano-seo", "backup_atributos_2026-11-19.json");
  fs.writeFileSync(back, JSON.stringify(backup, null, 2));
  console.log(`\n  backup: ${back}`);

  console.log("\n=== aplicando ===");
  let ok = 0;
  const errores = [];
  for (const x of plan) {
    const campos = x.campos.filter((c) => c.value !== "");
    const r = await gql(
      `mutation($m: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $m) {
          metafields { namespace key value }
          userErrors { message field }
        }
      }`,
      { m: campos.map((c) => ({ ownerId: x.id, ...c })) }
    );
    const ue = r && r.metafieldsSet ? r.metafieldsSet.userErrors : null;
    if (ue && ue.length) {
      errores.push(`${x.title}: ${JSON.stringify(ue).slice(0, 200)}`);
      console.log(`  ERROR ${x.title}`);
    } else {
      ok++;
      if (ok % 20 === 0) console.log(`  ...${ok}/${plan.length}`);
    }
  }
  console.log(`\n  actualizados: ${ok}/${plan.length}`);
  if (errores.length) {
    console.log("  errores:");
    errores.forEach((e) => console.log("   - " + e));
  }
})();
