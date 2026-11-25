/**
 * Packs "cortaviento + poleron" como BUNDLES REALES de Shopify (con
 * componentes), para que el stock se descuente solo al vender.
 *
 *   node scripts/admin-bundles.js            -> dry-run
 *   node scripts/admin-bundles.js --aplicar   -> crea, precio, imagen, publica
 *   node scripts/admin-bundles.js --borrar-planos  -> borra los packs sueltos
 *
 * API: productBundleCreate (bundles nativos de Shopify 2026-01). La app
 * "Shopify Bundles" los muestra en su panel.
 *
 * Los packs sueltos (productos normales con precio de combo, sin stock
 * propio) los crea admin-cyber-monday.js. Este script los reemplaza.
 */
require("dotenv").config();

const APLICAR = process.argv.includes("--aplicar");
const BORRAR_PLANOS = process.argv.includes("--borrar-planos");
const ONLINE = "gid://shopify/Publication/78057111775";
const TALLAS = ["XS", "S", "M", "L", "XL", "XXL"];

const PACKS = [
  { poleron: "poleron-manga-murcielago-exclusive", cortaviento: "cortaviento-pistachio-spring-trend", titulo: "Manga Murciélago + Pistachio", precio: "51000" },
  { poleron: "poleron-nostalgic", cortaviento: "cortaviento-women-crop-pinkadelic", titulo: "Nostalgic + Crop Pinkadelic", precio: "65500" },
  { poleron: "poleron-black-colors", cortaviento: "cortaviento-vintage-1", titulo: "Black Colors + Vintage", precio: "69000" },
];

(async () => {
  const shop = process.env.SHOPIFY_SHOP;
  const tk = await (
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
  const TOKEN = tk.access_token;
  const URL_API = `https://${shop}.myshopify.com/admin/api/2026-01/graphql.json`;
  async function gql(query, variables) {
    const cuerpo = variables ? { query, variables } : { query };
    for (let i = 0; i < 3; i++) {
      const res = await fetch(URL_API, {
        method: "POST",
        headers: { "X-Shopify-Access-Token": TOKEN, "Content-Type": "application/json" },
        body: JSON.stringify(cuerpo),
      });
      const texto = await res.text();
      if (texto) {
        try {
          const j = JSON.parse(texto);
          if (j.errors) console.log("   (!) " + JSON.stringify(j.errors).slice(0, 300));
          return j;
        } catch (e) {
          return null;
        }
      }
      await new Promise((x) => setTimeout(x, 1500));
    }
    return null;
  }

  const r = await gql('{ products(first: 130) { nodes { id title handle featuredMedia { preview { image { url } } } } }');
  const porHandle = new Map(r.data.products.nodes.map((p) => [p.handle, p]));
  const planos = r.data.products.nodes.filter((p) => /^Pack Cyber Monday/i.test(p.title));

  for (const pack of PACKS) {
    const pol = porHandle.get(pack.poleron);
    const cor = porHandle.get(pack.cortaviento);
    if (!pol || !cor) { console.log("  falta un componente de " + pack.titulo); continue; }
    const input = {
      title: "Pack Cyber Monday 2026: " + pack.titulo,
      consolidatedOptions: [
        {
          optionName: "Talla",
          optionSelections: TALLAS.map((t) => ({
            optionValue: t,
            components: [{ componentOptionValue: t }, { componentOptionValue: t }],
          })),
        },
      ],
      components: [
        { productId: pol.id, quantity: 1, optionSelections: [{ name: "Talla", values: TALLAS }] },
        { productId: cor.id, quantity: 1, optionSelections: [{ name: "Talla", values: TALLAS }] },
      ],
    };
    if (!APLICAR) {
      console.log("  (dry-run) " + pack.titulo + " -> " + pol.title + " + " + cor.title + " | $" + pack.precio);
      continue;
    }
    const rb = await gql(
      "mutation($i: ProductBundleCreateInput!) { productBundleCreate(input: $i) { productBundleOperation { id } userErrors { message field } } }",
      { i: input }
    );
    if (!rb || !rb.data || !rb.data.productBundleCreate) {
      console.log("  ERROR creando el bundle " + pack.titulo);
      continue;
    }
    const ue = rb.data.productBundleCreate.userErrors;
    if (ue && ue.length) {
      console.log("  ERROR bundle " + pack.titulo + ": " + JSON.stringify(ue).slice(0, 300));
      continue;
    }
    const opId = rb.data.productBundleCreate.productBundleOperation ? rb.data.productBundleCreate.productBundleOperation.id : null;
    console.log("  bundle creado: " + pack.titulo + " (op " + opId + ")");
  }

  if (!APLICAR) {
    console.log("\n  (dry-run: no se escribio nada. Usa --aplicar)");
    return;
  }

  // precios, imagen y publicacion de los bundles creados
  const rb2 = await gql("{ products(first: 130) { nodes { id title handle variants(first: 30) { nodes { id title price } } } } }");
  const rimg = await gql("{ products(first: 130) { nodes { id handle featuredMedia { preview { image { url } } } } } }");
  const imgPor = new Map(rimg.data.products.nodes.map((x) => [x.handle, x]));
  for (const p of rb2.data.products.nodes.filter((x) => /^Pack Cyber Monday/i.test(x.title))) {
    const pack = PACKS.find((k) => p.title.indexOf(k.titulo) > -1);
    if (!pack) continue;
    if (p.variants.nodes.length) {
      const lits = p.variants.nodes.map((v) => '{id: "' + v.id + '", price: "' + pack.precio + '"}').join(", ");
      const ru = await gql(
        "mutation($id: ID!) { productVariantsBulkUpdate(productId: $id, variants: [" + lits + "], allowPartialUpdates: true) { productVariants { id title price } userErrors { message field } } }",
        { id: p.id }
      );
      console.log("  " + pack.titulo.slice(0, 34) + " precio: " + (ru && ru.data ? (ru.data.productVariantsBulkUpdate.productVariants || []).map((v) => v.title + " $" + v.price).join(" ") : "?"));
    }
    const origen = imgPor.get(pack.cortaviento);
    const img = origen && origen.featuredMedia ? origen.featuredMedia.preview.image.url : null;
    if (img) {
      const rm = await gql(
        'mutation($id: ID!, $url: String!) { productSet(input: {id: $id, files: [{contentType: IMAGE, originalSource: $url, alt: "' + pack.titulo + '"}]}, synchronous: true) { product { id featuredMedia { preview { image { url } } } } userErrors { message field } } }',
        { id: p.id, url: img }
      );
      const fm = rm && rm.data ? rm.data.productSet.product.featuredMedia : null;
      console.log("  " + pack.titulo.slice(0, 34) + " imagen: " + (fm ? "ok" : "sin imagen"));
    }
    const rp = await gql(
      "mutation($id: ID!, $p: ID!) { publishablePublish(id: $id, input: {publicationId: $p}) { userErrors { message } } }",
      { id: p.id, p: ONLINE }
    );
    console.log("  " + pack.titulo.slice(0, 34) + " publicar: " + (rp && rp.data && !rp.data.publishablePublish.userErrors.length ? "OK" : "ERROR"));
  }

  // borrar los packs sueltos
  if (BORRAR_PLANOS) {
    for (const p of planos) {
      const d = await gql('mutation($id: ID!) { productDelete(input: {id: $id}) { deletedProductId userErrors { message } } }', { id: p.id });
      console.log("  pack suelto borrado: " + (d && d.data ? d.data.productDelete.deletedProductId : "?") + " (" + p.title.slice(0, 40) + ")");
    }
  } else {
    console.log("\n  quedan " + planos.length + " packs sueltos (usa --borrar-planos para eliminarlos)");
  }
})();
