require("dotenv").config();
const SHOP = process.env.SHOPIFY_SHOP;

(async () => {
  const t = await (
    await fetch(`https://${SHOP}.myshopify.com/admin/oauth/access_token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_id: process.env.SHOPIFY_CLIENT_ID,
        client_secret: process.env.SHOPIFY_CLIENT_SECRET,
        grant_type: "client_credentials",
      }),
    })
  ).json();
  const H = { "X-Shopify-Access-Token": t.access_token, "Content-Type": "application/json" };
  const A = `https://${SHOP}.myshopify.com/admin/api/2026-01`;
  const gql = async (q) =>
    (await (await fetch(A + "/graphql.json", { method: "POST", headers: H, body: JSON.stringify({ query: q }) })).json());

  // todos los productos con los campos que van al feed
  const prods = [];
  let cursor = null;
  for (let i = 0; i < 6; i++) {
    const after = cursor ? `, after: "${cursor}"` : "";
    const j = await gql(`{
      products(first: 100${after}) {
        nodes {
          id title handle vendor productType status tags
          descriptionHtml
          totalInventory
          featuredMedia { preview { image { url width height } } }
          variants(first: 50) { nodes { sku barcode price compareAtPrice inventoryQuantity availableForSale } }
          metafields(first: 20) { nodes { namespace key value type } }
        }
        pageInfo { hasNextPage endCursor }
      }
    }`);
    if (j.errors) { console.log("ERROR: " + JSON.stringify(j.errors).slice(0, 200)); return; }
    prods.push(...j.data.products.nodes);
    if (!j.data.products.pageInfo.hasNextPage) break;
    cursor = j.data.products.pageInfo.endCursor;
  }

  const activos = prods.filter((p) => p.status === "ACTIVE");
  const conGTIN = activos.filter((p) => p.variants.nodes.some((v) => v.barcode));
  const conSku = activos.filter((p) => p.variants.nodes.some((v) => v.sku));
  const sinDesc = activos.filter((p) => !p.descriptionHtml || p.descriptionHtml.replace(/<[^>]+>/g, "").trim().length < 40);
  const descCortas = activos.filter((p) => {
    const t = (p.descriptionHtml || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    return t.length >= 40 && t.length < 200;
  });
  const sinTipo = activos.filter((p) => !p.productType);
  const sinVendor = activos.filter((p) => !p.vendor);
  const sinImagen = activos.filter((p) => !p.featuredMedia?.preview?.image?.url);
  const titulosLargos = activos.filter((p) => p.title.length > 70);
  const titulosCortos = activos.filter((p) => p.title.length < 25);
  const sinPrecio = activos.filter((p) => p.variants.nodes.every((v) => !v.price || v.price === "0.0"));
  const sinStock = activos.filter((p) => p.totalInventory === 0);

  console.log(`=== PRODUCTOS (feed de Google Shopping) ===`);
  console.log(`  total: ${prods.length} | activos: ${activos.length} | inactivos: ${prods.length - activos.length}`);
  console.log("");
  console.log(`  con GTIN (barcode):  ${conGTIN.length}/${activos.length}  (${Math.round((conGTIN.length / activos.length) * 100)}%)`);
  console.log(`  con SKU:            ${conSku.length}/${activos.length}`);
  console.log(`  con tipo (categoría): ${activos.length - sinTipo.length}/${activos.length}`);
  console.log(`  con vendor/marca:   ${activos.length - sinVendor.length}/${activos.length}`);
  console.log(`  con imagen:          ${activos.length - sinImagen.length}/${activos.length}`);
  console.log(`  con precio:          ${activos.length - sinPrecio.length}/${activos.length}`);
  console.log(`  con rating (reviews.*): ${activos.filter((p) => (p.metafields.nodes || []).some((m) => m.namespace === "reviews" && m.key === "rating")).length}/${activos.length}`);
  console.log("");
  console.log(`  descripcion vacia o <40 chars: ${sinDesc.length}`);
  console.log(`  descripcion corta (40-200):     ${descCortas.length}`);
  console.log(`  titulo >70 chars:              ${titulosLargos.length}`);
  console.log(`  titulo <25 chars:              ${titulosCortos.length}`);
  console.log(`  sin stock:                      ${sinStock.length}`);

  console.log(`\n=== 12 titulos (como los ve Google) ===`);
  activos.slice(0, 12).forEach((p) => {
    const gtin = p.variants.nodes.find((v) => v.barcode);
    console.log(`  ${p.title}`);
    console.log(`     tipo: ${p.productType || "(sin tipo)"} | GTIN: ${gtin ? gtin.barcode : "NO"} | precio: ${p.variants.nodes[0]?.price} | stock: ${p.totalInventory}`);
  });

  console.log(`\n=== productos sin GTIN (los que mas pesan en Shopping) ===`);
  activos.filter((p) => !p.variants.nodes.some((v) => v.barcode)).slice(0, 10).forEach((p) => console.log(`  ${p.title}  (${p.variants.nodes.length} variantes)`));
})();
