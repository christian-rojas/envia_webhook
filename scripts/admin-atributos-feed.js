/**
 * Atributos de producto para el feed de Google: color, talla, genero, edad.
 *
 *   node scripts/admin-atributos-feed.js            -> dry-run
 *   node scripts/admin-atributos-feed.js --aplicar   -> escribe
 *
 * Escribe los atributos ESTANDAR de Shopify (los que el canal Google &
 * YouTube lee por defecto, sin mapear nada):
 *   shopify.color-pattern    referencia a los metaobjetos de color
 *   shopify.size             referencia a los metaobjetos de talla
 *   shopify.age-group       referencia a "adultos"
 *   shopify.target-gender    referencia a unisex/femenino/masculino
 *
 * Y ademas, en texto plano (mismo dato, mas facil de mapear a mano):
 *   custom.color, custom.size, custom.age_group, custom.gender
 *
 * El color sale de la foto de cada producto (scripts/colores-productos.json),
 * no del titulo: la tienda llama "Purple Urban" a una prenda tricolor.
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");

const APLICAR = process.argv.includes("--aplicar");
const MAPA = process.env.MAPA_COLORES || path.join(__dirname, "colores-productos.json");

const TIPOS = {
  color: "shopify--color-pattern",
  size: "shopify--size",
  age: "shopify--age-group",
  gender: "shopify--target-gender",
};

// La tienda usa "XXL" en unas prendas y "2XL" en otras, pero el catalogo de
// tallas de Shopify solo tiene "2xl". Se mapean al mismo metaobjeto.
const TALLA_ALIAS = { xxl: "2xl" };

// "Talla unica" -> "talla-unica" (el handle del metaobjeto)
function norm(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

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
  const porHandle = new Map(mapa.map((x) => [x.handle, x]));

  // 1) metaobjetos: color, talla, edad y genero
  const meta = {};
  for (const [clave, tipo] of Object.entries(TIPOS)) {
    const r = await gql(
      "query($t: String!) { metaobjects(first: 250, type: $t) { nodes { id handle displayName } } }",
      { t: tipo }
    );
    const nodos = r && r.metaobjects ? r.metaobjects.nodes : [];
    meta[clave] = new Map(nodos.map((n) => [n.handle, n]));
    console.log(`  ${clave} (${tipo}): ${nodos.length} metaobjetos`);
  }

  // 2) productos
  const productos = [];
  let after = null;
  for (let i = 0; i < 6; i++) {
    const q =
      "{ products(first: 30" +
      (after ? `, after: "${after}"` : "") +
      ', query: "status:active") { nodes { id handle title productType options { name values } genero: metafield(namespace:"custom", key:"target_gender") { value } } pageInfo { hasNextPage endCursor } } }';
    const r = await gql(q);
    if (!r || !r.products) {
      console.log("  no se pudieron leer todos los productos");
      break;
    }
    productos.push(...r.products.nodes);
    if (!r.products.pageInfo.hasNextPage) break;
    after = r.products.pageInfo.endCursor;
  }
  console.log(`  productos leidos: ${productos.length}`);

  // 3) plan
  const plan = [];
  const faltantes = { color: 0, size: 0, age: 0, gender: 0 };
  for (const p of productos) {
    const info = porHandle.get(p.handle);
    if (!info) continue;
    const handles = Array.isArray(info.color) ? info.color : [info.color];
    const campos = [];

    const gidsColor = handles.map((h) => meta.color.get(h)).filter(Boolean);
    if (gidsColor.length !== handles.length) faltantes.color++;
    // Si el producto tiene opcion Color, Shopify administra el color-pattern
    // desde la opcion y no deja escribirlo a mano (el color ya viaja en la
    // variante, asi que el feed lo ve igual).
    const opcionColor = p.options.some((o) => /color/i.test(o.name));
    if (gidsColor.length && !opcionColor) {
      campos.push({
        namespace: "shopify",
        key: "color-pattern",
        type: "list.metaobject_reference",
        value: JSON.stringify(gidsColor.map((n) => n.id)),
      });
    }
    if (gidsColor.length) {
      campos.push({
        namespace: "custom",
        key: "color",
        type: "single_line_text_field",
        value: gidsColor.map((n) => n.displayName).join(", "),
      });
    }

    const op = p.options.find((o) => /talla|size|tama/i.test(o.name));
    if (op) {
      const gidsTalla = [...new Set(op.values
        .map((v) => {
          const k = norm(v);
          const n = meta.size.get(k) || meta.size.get(TALLA_ALIAS[k]);
          return n ? n.id : null;
        })
        .filter(Boolean))];
      if (!gidsTalla.length) faltantes.size++;
      if (gidsTalla.length) {
        campos.push({
          namespace: "shopify",
          key: "size",
          type: "list.metaobject_reference",
          value: JSON.stringify(gidsTalla),
        });
      }
      campos.push({
        namespace: "custom",
        key: "size",
        type: "single_line_text_field",
        value: op.values.join(", "),
      });
    }

    const gAge = meta.age.get("adultos");
    if (gAge) {
      if (!gAge) faltantes.age++;
      campos.push({
        namespace: "shopify",
        key: "age-group",
        type: "list.metaobject_reference",
        value: JSON.stringify([gAge.id]),
      });
    }
    campos.push({ namespace: "custom", key: "age_group", type: "single_line_text_field", value: "adult" });

    const gv = String((p.genero && p.genero.value) || "Unisex").toLowerCase();
    const handleG = gv === "mujer" ? "femenino" : gv === "hombre" ? "masculino" : "unisex";
    const gGender = meta.gender.get(handleG);
    if (!gGender) faltantes.gender++;
    if (gGender) {
      campos.push({
        namespace: "shopify",
        key: "target-gender",
        type: "list.metaobject_reference",
        value: JSON.stringify([gGender.id]),
      });
    }
    campos.push({
      namespace: "custom",
      key: "gender",
      type: "single_line_text_field",
      value: (p.genero && p.genero.value) || "Unisex",
    });

    plan.push({ id: p.id, title: p.title, color: handles.join("+"), campos });
  }

  console.log(`\n  productos a actualizar: ${plan.length}`);
  const conteo = {};
  plan.forEach((x) => (conteo[x.color] = (conteo[x.color] || 0) + 1));
  Object.entries(conteo).sort((a, b) => b[1] - a[1]).forEach(([c, n]) => console.log(`    ${String(n).padStart(3)}x ${c}`));
  if (faltantes.color || faltantes.size || faltantes.gender) {
    console.log(`  sin metaobjeto para: ${faltantes.color} color, ${faltantes.size} talla, ${faltantes.gender} genero`);
  }

  if (!APLICAR) {
    console.log("\n  (dry-run: no se escribio nada. Usa --aplicar)");
    return;
  }

  const back = path.join(__dirname, "..", "..", "mondano-seo", "backup_atributos_2026-11-19.json");
  if (fs.existsSync(back)) console.log(`\n  backup previo: ${back}`);

  console.log("\n=== aplicando ===");
  let ok = 0;
  const errores = [];
  for (const x of plan) {
    // Un metafield por llamada: si uno falla (p.ej. una definicion que no
    // existe para la categoria del producto), no arrastra a los demas.
    let fallosProducto = 0;
    for (const c of x.campos) {
      const r = await gql(
        `mutation($m: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $m) {
            metafields { namespace key value }
            userErrors { message field }
          }
        }`,
        { m: [{ ownerId: x.id, ...c }] }
      );
      const ue = r && r.metafieldsSet ? r.metafieldsSet.userErrors : null;
      if (ue && ue.length) {
        fallosProducto++;
        errores.push(`${x.title} [${c.namespace}.${c.key}]: ${JSON.stringify(ue).slice(0, 160)}`);
      }
    }
    if (!fallosProducto) {
      ok++;
      if (ok % 20 === 0) console.log(`  ...${ok}/${plan.length}`);
    } else {
      console.log(`  parcial ${x.title} (${fallosProducto} campos)`);
    }
  }
  console.log(`\n  actualizados: ${ok}/${plan.length}`);
  if (errores.length) {
    console.log("  errores:");
    errores.forEach((e) => console.log("   - " + e));
  }
})();
