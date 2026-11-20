/**
 * Borra los productos en borrador de la tienda.
 *
 *   node scripts/admin-borra-borradores.js            -> dry-run
 *   node scripts/admin-borra-borradores.js --aplicar   -> borra
 *
 * Son 64 borradores: la catalogo viejo (nombres como "Poleron Blue Spring
 * Sweatshirt") que quedo sin publicar cuando se renombraron los productos.
 * No aparecen en la web, ni en el sitemap, ni en el feed de Google, pero
 * si se cuelgan en el admin y son un riesgo: publicar uno por error deja
 * dos productos casi iguales en la tienda.
 *
 * ANTES de borrar, el script escribe un backup completo en
 * mondano-seo/backup_no_publicados_2026-11-20.json (titulo, descripcion,
 * tags, variantes con SKU/precio/inventario y URLs de las fotos), asi que
 * cualquier producto se puede volver a crear.
 *
 * Los 8 productos ya ARCHIVADOS no se tocan: en Shopify, archivado ya es
 * "borrado pero recuperable".
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");

const APLICAR = process.argv.includes("--aplicar");
const BACKUP = path.join(__dirname, "..", "..", "mondano-seo", "backup_no_publicados_2026-11-20.json");

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

  const productos = [];
  let after = null;
  for (let i = 0; i < 6; i++) {
    const q =
      "{ products(first: 50" +
      (after ? `, after: "${after}"` : "") +
      ") { nodes { id handle title status productType } pageInfo { hasNextPage endCursor } } }";
    const j = await gql(q);
    if (!j || !j.products) break;
    productos.push(...j.products.nodes);
    if (!j.products.pageInfo.hasNextPage) break;
    after = j.products.pageInfo.endCursor;
  }
  const borradores = productos.filter((p) => p.status === "DRAFT");
  const archivados = productos.filter((p) => p.status === "ARCHIVED");
  console.log(`  productos: ${productos.length} | borradores: ${borradores.length} | archivados: ${archivados.length}`);

  if (!fs.existsSync(BACKUP)) {
    console.log(`  ERROR: no existe el backup ${BACKUP}. No se borra nada.`);
    return;
  }
  const backup = JSON.parse(fs.readFileSync(BACKUP, "utf8"));
  const respaldados = new Set(backup.map((p) => p.id));
  const sinRespaldo = borradores.filter((p) => !respaldados.has(p.id));
  if (sinRespaldo.length) {
    console.log(`  ERROR: ${sinRespaldo.length} borradores no estan en el backup. No se borra nada.`);
    sinRespaldo.forEach((p) => console.log("    " + p.title));
    return;
  }
  console.log(`  backup OK: ${backup.length} productos respaldados en ${BACKUP}`);

  if (!APLICAR) {
    console.log("\n  (dry-run: no se borro nada. Usa --aplicar)");
    return;
  }

  console.log("\n=== borrando ===");
  let ok = 0;
  const errores = [];
  for (const p of borradores) {
    const r = await gql(`mutation($id: ID!) { productDelete(input: {id: $id}) { deletedProductId userErrors { message } } }`, { id: p.id });
    const ue = r && r.productDelete ? r.productDelete.userErrors : null;
    if (!r || !r.productDelete) { errores.push(`${p.title}: sin respuesta`); continue; }
    if (ue && ue.length) errores.push(`${p.title}: ${JSON.stringify(ue).slice(0, 160)}`);
    else {
      ok++;
      if (ok % 10 === 0) console.log(`  ...${ok}/${borradores.length}`);
    }
  }
  console.log(`\n  borrados: ${ok}/${borradores.length}`);
  if (errores.length) {
    console.log("  errores:");
    errores.forEach((e) => console.log("   - " + e));
  }
})();
