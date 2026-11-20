/**
 * Arregla la coleccion "Chiporros" (/collections/chiporros).
 *
 * La coleccion se creo en noviembre con 3 productos: el abrigo de chiporro
 * y dos polerones de franela con gorro (Hoodie Yellow y Hoodie Morado).
 * Los polerones NO son chiporros (no llevan forro de fleece; su descripcion
 * dice "tela franela de algodon"), asi que quedaban fuera de lugar.
 *
 * Este script:
 *   1) saca los 2 polerones de la coleccion
 *   2) deja la descripcion describiendo el chiporro real
 *
 *   node scripts/admin-fix-coleccion-chiporros.js            -> dry-run
 *   node scripts/admin-fix-coleccion-chiporros.js --aplicar   -> escribe
 *
 * Para deshacer: volver a agregar los polerones con
 * collectionAddProducts(id:, productIds: [los 2 ids]).
 */
require("dotenv").config();

const APLICAR = process.argv.includes("--aplicar");
const COLECCION = "gid://shopify/Collection/527838642399";
const DESCRIPCION =
  "<p>El <strong>chiporro</strong> es la prenda que corta el frío de verdad: tela exterior de chiporro resistente y forro interior de fleece, con capucha y cierre. Abrigado de verdad para el invierno.</p>";

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
  const A = `https://${shop}.myshopify.com/admin/api/2026-01/graphql.json`;
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

  const j = await gql(`{
    collection(id: "${COLECCION}") {
      title handle descriptionHtml
      productsCount { count }
      products(first: 30) { nodes { id title } }
    }
  }`);
  const c = j.collection;
  const quitar = c.products.nodes.filter((p) => /hoodie/i.test(p.title)).map((p) => p.id);
  console.log(`  coleccion "${c.title}" (${c.handle}): ${c.productsCount.count} productos`);
  console.log(`  a quitar: ${quitar.length ? c.products.nodes.filter((p) => /hoodie/i.test(p.title)).map((p) => p.title).join(" | ") : "(nada)"}`);
  console.log(`  descripcion actual: ${c.descriptionHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 90)}`);

  if (!APLICAR) {
    console.log("\n  (dry-run: no se escribio nada. Usa --aplicar)");
    return;
  }

  if (quitar.length) {
    const r = await gql(
      `mutation($id: ID!, $pids: [ID!]!) {
        collectionRemoveProducts(id: $id, productIds: $pids) {
          job { id }
          userErrors { message }
        }
      }`,
      { id: COLECCION, pids: quitar }
    );
    const ue = r && r.collectionRemoveProducts ? r.collectionRemoveProducts.userErrors : null;
    console.log("  quitar: " + (ue && ue.length ? "ERROR " + JSON.stringify(ue) : "OK (job " + (r.collectionRemoveProducts.job || {}).id + ")"));
  }
  const r2 = await gql(
    `mutation($id: ID!, $d: String!) {
      collectionUpdate(input: {id: $id, descriptionHtml: $d}) {
        collection { title handle }
        userErrors { message }
      }
    }`,
    { id: COLECCION, d: DESCRIPCION }
  );
  const ue2 = r2 && r2.collectionUpdate ? r2.collectionUpdate.userErrors : null;
  console.log("  descripcion: " + (ue2 && ue2.length ? "ERROR " + JSON.stringify(ue2) : "OK"));
})();
