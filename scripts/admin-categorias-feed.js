/**
 * Lote 1 del plan de feed: baja la categoria de taxonomia de los productos
 * que la tienen demasiado generica.
 *
 *   node scripts/admin-categorias-feed.js           -> dry-run (imprime, no escribe)
 *   node scripts/admin-categorias-feed.js --aplicar  -> escribe
 *
 * Por que:
 *   43 de los 105 productos activos tienen una categoria tan generica que
 *   Google no los puede clasificar ("Apparel & Accessories" a secas, 35
 *   productos; "Uncategorized", 6; "Apparel & Accessories > Clothing", 2).
 *   Ademas, los metafields de categoria (shopify.color-pattern, shopify.size,
 *   shopify.age-group, shopify.target-gender) SOLO existen donde la categoria
 *   es detallada: por eso color-pattern esta en 53/105, size en 56/105 y
 *   age-group en 38/105. Bajar la categoria es la llave; los atributos se
 *   rellenan despues.
 *
 * Que NO cambia: handles, URLs, titulos, precios, SKUs, GTIN, inventario,
 * fotos, descripciones, reviews y colecciones.
 *
 * Las categorias de destino se toman de las que YA usa un producto del mismo
 * tipo en la tienda (mismo criterio de ropa), no se inventan.
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");

const APLICAR = process.argv.includes("--aplicar");
const BACKUP = path.join(__dirname, "..", "..", "mondano-seo", "backup_categorias_2026-11-19.json");

// Categorias de taxonomia que ya existen en la tienda (sacadas de los
// productos que las usan) + el criterio de cada una.
const CAT = {
  HOODIES: "gid://shopify/TaxonomyCategory/aa-1-13-13", // Clothing > Clothing Tops > Hoodies
  SWEATSHIRTS: "gid://shopify/TaxonomyCategory/aa-1-13-14", // Clothing > Clothing Tops > Sweatshirts
  WINDBREAKERS: "gid://shopify/TaxonomyCategory/aa-1-10-2-16", // Outerwear > Coats & Jackets > Windbreakers
  PARKAS: "gid://shopify/TaxonomyCategory/aa-1-10-2-6", // Outerwear > Coats & Jackets > Parkas
  OUTFIT_SETS: "gid://shopify/TaxonomyCategory/aa-1-11", // Clothing > Outfit Sets
};

const NOMBRES = {
  [CAT.HOODIES]: "Clothing > Clothing Tops > Hoodies",
  [CAT.SWEATSHIRTS]: "Clothing > Clothing Tops > Sweatshirts",
  [CAT.WINDBREAKERS]: "Outerwear > Coats & Jackets > Windbreakers",
  [CAT.PARKAS]: "Outerwear > Coats & Jackets > Parkas",
  [CAT.OUTFIT_SETS]: "Clothing > Outfit Sets",
};

const GENERICAS = new Set([
  "Apparel & Accessories",
  "Uncategorized",
  "Apparel & Accessories > Clothing",
]);

/**
 * Decide la categoria destino de un producto.
 *
 * @param {object} p Producto (title, productType, category).
 * @returns {string|null} Id de la categoria destino, o null si ya esta bien.
 */
function categoriaDestino(p) {
  if (!GENERICAS.has(p.category.fullName)) return null;
  const t = p.productType;
  const titulo = p.title.toLowerCase();

  if (t === "Polerón") {
    // El crop top es un buzo cropped: la tienda ya tiene el precedente
    // ("Polerón Cropped de Franela Beige Duffle" -> Sweatshirts).
    if (/crop\s*top/.test(titulo)) return CAT.SWEATSHIRTS;
    return CAT.HOODIES;
  }
  if (t === "Cortaviento") return CAT.WINDBREAKERS;
  if (t === "Parka") return CAT.PARKAS;
  if (t === "Conjunto") return CAT.OUTFIT_SETS;
  if (t === "Casaca") {
    // Las dos casacas genericas son impermeables con capucha: la misma
    // categoria que las dos Wintertrainer (que ya estan ahi).
    return CAT.WINDBREAKERS;
  }
  return null;
}

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
  if (!t.access_token) throw new Error("no se pudo obtener el token: " + JSON.stringify(t).slice(0, 200));

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
    if (r.errors) {
      console.log("   (!) " + JSON.stringify(r.errors).slice(0, 300));
      return null;
    }
    return r.data;
  };

  console.log("=== leyendo productos ===");
  const datos = await gql(`{
    products(first: 250, query: "status:active") {
      nodes { id handle title productType category { id fullName } }
    }
  }`);
  const productos = datos.products.nodes;

  const plan = [];
  for (const p of productos) {
    const destino = categoriaDestino(p);
    if (!destino) continue;
    plan.push({
      id: p.id,
      handle: p.handle,
      title: p.title,
      productType: p.productType,
      antes: p.category.fullName,
      despues: NOMBRES[destino],
      categoriaId: destino,
    });
  }

  console.log(`\n  productos con categoria generica: ${plan.length}/${productos.length}`);
  const porDestino = {};
  plan.forEach((x) => (porDestino[x.despues] = (porDestino[x.despues] || 0) + 1));
  Object.entries(porDestino).forEach(([k, v]) => console.log(`    ${v}x  ${k}`));

  console.log("\n=== plan ===");
  for (const x of plan) {
    console.log(`  ${x.title}`);
    console.log(`      ${x.antes}  ->  ${x.despues}`);
  }

  if (!APLICAR) {
    console.log("\n  (dry-run: no se escribio nada. Usa --aplicar)");
    return;
  }

  // Backup antes de tocar nada.
  const backup = productos.map((p) => ({
    id: p.id,
    handle: p.handle,
    title: p.title,
    categoryId: p.category.id,
    category: p.category.fullName,
  }));
  fs.writeFileSync(BACKUP, JSON.stringify(backup, null, 2));
  console.log(`\n  backup: ${BACKUP}`);

  console.log("\n=== aplicando ===");
  let ok = 0;
  const errores = [];
  for (const x of plan) {
    const d = await gql(
      `mutation($id: ID!, $c: ID!) {
        productUpdate(product: {id: $id, category: $c}) {
          product { id title category { fullName } }
          userErrors { message field }
        }
      }`,
      { id: x.id, c: x.categoriaId }
    );
    const ue = d && d.productUpdate ? d.productUpdate.userErrors : null;
    if (ue && ue.length) {
      errores.push(`${x.title}: ${JSON.stringify(ue).slice(0, 160)}`);
      console.log(`  ERROR  ${x.title}`);
    } else {
      ok++;
      if (ok % 10 === 0) console.log(`  ...${ok}/${plan.length}`);
    }
  }
  console.log(`\n  actualizados: ${ok}/${plan.length}`);
  if (errores.length) {
    console.log("  errores:");
    errores.forEach((e) => console.log("   - " + e));
  }
})();
