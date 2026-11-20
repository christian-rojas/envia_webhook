/**
 * Saca de cada coleccion los productos activos cuyo tipo de producto no
 * corresponde a la coleccion.
 *
 *   node scripts/admin-limpia-colecciones.js            -> dry-run
 *   node scripts/admin-limpia-colecciones.js --aplicar   -> escribe
 *
 * Hay dos tipos de coleccion y cada una se arregla distinto:
 *
 *  - MANUALES (Denim, Shorts...): se saca el producto con
 *    collectionRemoveProducts.
 *  - INTELIGENTES (Vestidos, Polerones, Cortavientos...): su contenido lo
 *    deciden las reglas, asi que no se puede quitar un producto a mano
 *    ("Can't manually remove products from a smart collection"). Se toca lo
 *    que hace que el producto entre:
 *      * Vestidos: los 2 conjuntos que entraban por el tag "Vestidos".
 *      * Polerones: la regla TITLE CONTAINS "Poleron" arrastraba una casaca
 *        y un conjunto que tienen "Poleron" en el nombre; se pasa a
 *        TITLE STARTS_WITH, que deja solo las prendas que empiezan por
 *        "Poleron".
 *      * Cortavientos: la parka que entraba por el tag "cortaviento".
 *
 * Ningun producto se queda fuera de la tienda: los que salen de una
 * coleccion siguen en la que si les corresponde.
 */
require("dotenv").config();

const APLICAR = process.argv.includes("--aplicar");

// Tipos de producto que corresponde a cada coleccion.
const REGLA = {
  vestidos: ["vestido"],
  camisas: ["camisa", "blusa", "guayabera"],
  polerones: ["poleron"],
  cortavientos: ["cortaviento"],
  "parkas-y-casacas": ["parka", "casaca", "chaqueta"],
  conjuntos: ["conjunto"],
  poleras: ["polera", "polero"],
  pantalones: ["pantalon"],
  shorts: ["short"],
  denim: ["pantalon", "chaqueta"],
};

// Arreglos para las colecciones inteligentes: quitan el tag que mete al
// producto en la coleccion.
const QUITAR_TAG = [
  {
    handle: "vestidos",
    producto: "Conjunto - DOS PIEZAS SUSURRO de OLAS",
    tags: ["vestido", "Vestidos"],
  },
  {
    handle: "vestidos",
    producto: "Conjunto - DOS PIEZAS SUSURRO de ATARDECER",
    tags: ["vestido", "Vestidos"],
  },
  {
    handle: "cortavientos",
    producto: "Parka - Mujer - Turquesa Impermeable Urban Trek",
    tags: ["cortaviento"],
  },
];

// Cambio de regla de las colecciones inteligentes.
const CAMBIAR_REGLA = [
  {
    handle: "polerones",
    titulo: "Polerones Unisex",
    rules: [
      { column: "TITLE", relation: "STARTS_WITH", condition: "Polerón" },
      { column: "TYPE", relation: "EQUALS", condition: "Poleron" },
    ],
    appliedDisjunctively: true,
  },
];

const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();

(async () => {
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
  const H = { "X-Shopify-Access-Token": t.access_token, "Content-Type": "application/json" };
  const A = `https://${shop}.myshopify.com/admin/api/2026-01`;
  const gql = async (query, variables) => {
    const r = await (
      await fetch(A + "/graphql.json", {
        method: "POST",
        headers: H,
        body: JSON.stringify({ query, variables }),
      })
    ).json();
    if (r.errors) console.log("   (!) " + JSON.stringify(r.errors).slice(0, 240));
    return r.data;
  };

  const datos = await gql(`{
    collections(first: 30) { nodes { id title handle productsCount { count } ruleSet { appliedDisjunctively rules { column relation } } } }
  }`);
  const colecciones = datos.collections.nodes;
  for (const c of colecciones) {
    if (!REGLA[c.handle]) continue;
    const d = await gql(
      `{ collection(id: "${c.id}") { products(first: 60) { nodes { id title productType status tags } } } }`
    );
    c.products = d && d.collection ? d.collection.products.nodes : [];
  }

  // 1)alh
  const manuales = [];
  for (const c of colecciones) {
    const regla = REGLA[c.handle];
    if (!regla || c.ruleSet) continue;
    const fuera = c.products.filter((p) => p.status === "ACTIVE" && !regla.includes(norm(p.productType)));
    if (fuera.length) manuales.push({ c, fuera });
  }

  // 2) quitamos los tags que meten productos en las colecciones inteligentes
  const tags = [];
  for (const q of QUITAR_TAG) {
    const c = colecciones.find((x) => x.handle === q.handle);
    if (!c) continue;
    const p = c.products.find((x) => x.title === q.producto);
    if (!p) {
      console.log(`  (no se encontro "${q.producto}" en ${q.handle})`);
      continue;
    }
    tags.push({ c, p, tags: q.tags });
  }

  console.log(`\n  === 1) colecciones manuales: quitar ${manuales.reduce((s, m) => s + m.fuera.length, 0)} productos ===`);
  manuales.forEach(({ c, fuera }) => {
    console.log(`  ${c.title} (${c.handle})`);
    fuera.forEach((p) => console.log(`    - "${p.title}" (tipo: ${p.productType})`));
  });

  console.log(`\n  === 2) colecciones inteligentes: quitar tags ===`);
  tags.forEach(({ c, p, tags: ts }) => console.log(`  ${c.title}: "${p.title}" -> quitar ${ts.join(", ")}`));

  console.log(`\n  === 3) cambio de reglas ===`);
  CAMBIAR_REGLA.forEach((r) => {
    const c = colecciones.find((x) => x.handle === r.handle);
    console.log(`  ${r.titulo} (${r.handle})`);
    (c && c.ruleSet ? c.ruleSet.rules : []).forEach((x) => console.log(`    actual:  ${x.column} ${x.relation}`));
    r.rules.forEach((x) => console.log(`    nuevo:   ${x.column} ${x.relation} "${x.condition}"`));
  });

  if (!APLICAR) {
    console.log("\n  (dry-run: no se escribio nada. Usa --aplicar)");
    return;
  }

  console.log("\n=== aplicando ===");
  for (const { c, fuera } of manuales) {
    const r = await gql(
      `mutation($id: ID!, $pids: [ID!]!) {
        collectionRemoveProducts(id: $id, productIds: $pids) { job { id } userErrors { message } }
      }`,
      { id: c.id, pids: fuera.map((p) => p.id) }
    );
    const ue = r && r.collectionRemoveProducts ? r.collectionRemoveProducts.userErrors : null;
    console.log(`  ${c.title}: ` + (ue && ue.length ? "ERROR " + JSON.stringify(ue).slice(0, 160) : `OK (${fuera.length})`));
  }

  for (const { c, p, tags: ts } of tags) {
    // OJO: productUpdate REEMPLAZA la lista de tags. Hay que mandar los tags
    // que QUEDAN (los que tiene menos los que se van), no los que se van.
    const restantes = p.tags.filter((t) => !ts.includes(t));
    const finales = restantes.length ? restantes : ts.length === 1 ? [] : ts;
    const r = await gql(
      `mutation($id: ID!, $t: [String!]!) { productUpdate(product: {id: $id, tags: $t}) { product { id tags } userErrors { message } } }`,
      { id: p.id, t: finales }
    );
    const ue = r && r.productUpdate ? r.productUpdate.userErrors : null;
    console.log(`  tags de "${p.title}" -> ${JSON.stringify(finales)}: ` + (ue && ue.length ? "ERROR " + JSON.stringify(ue).slice(0, 160) : "OK"));
  }

  for (const r of CAMBIAR_REGLA) {
    const c = colecciones.find((x) => x.handle === r.handle);
    if (!c) continue;
    const res = await gql(
      `mutation($id: ID!, $rs: CollectionRuleSetInput!) {
        collectionUpdate(input: {id: $id, ruleSet: $rs}) { collection { id title } userErrors { message } }
      }`,
      { id: c.id, rs: { appliedDisjunctively: r.appliedDisjunctively, rules: r.rules } }
    );
    const ue = res && res.collectionUpdate ? res.collectionUpdate.userErrors : null;
    console.log(`  regla de ${r.titulo}: ` + (ue && ue.length ? "ERROR " + JSON.stringify(ue).slice(0, 200) : "OK"));
  }
})();
