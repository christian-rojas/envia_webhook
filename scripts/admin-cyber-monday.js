/**
 * Campana Cyber Monday 2026 (25-11-2026).
 *
 *   node scripts/admin-cyber-monday.js            -> dry-run
 *   node scripts/admin-cyber-monday.js --aplicar   -> crea la coleccion y los packs
 *
 * QUE HACE:
 *  1. Coleccion "Cyber Monday 2026" con los 10 productos que mas se venden
 *     (5 polerones + 5 cortavientos), con descripcion y SEO propios.
 *  2. Tres packs "Cortaviento + Poleron" (los mas vendidos de cada
 *     categoria), con 10% de descuento y una variante por talla.
 *
 * DE DONDE SALE EL RANKING: unidades vendidas en los ultimos 12 meses,
 * leidas de los pedidos reales de Shopify (1591 pedidos).
 *
 * NOTA SOBRE STOCK: los packs se crean sin control de inventario, porque la
 * combinacion (poleron X + cortaviento Y) no tiene stock propio. Si se
 * instala la app Shopify Bundles, hay que rehacerlos con componentes para
 * que el stock se descuente solo.
 */
require("dotenv").config();

const APLICAR = process.argv.includes("--aplicar");
const DIAS_OFF = 0.1;
const ORDEN_TALLAS = ["XS", "S", "M", "L", "XL", "XXL"];

const HANDLES = [
  // polerones, por unidades vendidas
  "poleron-manga-murcielago-exclusive",
  "poleron-nostalgic",
  "poleron-black-colors",
  "poleron-belair",
  "poleron-urban",
  // cortavientos, por unidades vendidas
  "cortaviento-pistachio-spring-trend",
  "cortaviento-women-crop-pinkadelic",
  "cortaviento-vintage-1",
  "cortaviento-purple-spring-trend",
  "cortaviento-women-crop-lavender",
];

const PACKS = [
  {
    poleron: "poleron-manga-murcielago-exclusive",
    cortaviento: "cortaviento-pistachio-spring-trend",
    titulo: "Manga Murciélago + Pistachio",
    desc:
      "El combo más vendido: el <strong>polerón Manga Murciélago Exclusive</strong> (franela de algodón 70/30 con puño, cuello alto con capucha y bolsillo canguro, filtro UPF 50+) más el <strong>cortaviento Pistachio Spring Trend</strong> (poliéster reciclado con exterior impermeable, cuello alto, capucha con cordón y puños elásticos).",
  },
  {
    poleron: "poleron-nostalgic",
    cortaviento: "cortaviento-women-crop-pinkadelic",
    titulo: "Nostalgic + Crop Pinkadelic",
    desc:
      "El <strong>polerón Nostalgic</strong> (franela de algodón con puño, cuello alto con capucha y bolsillo canguro) más el <strong>cortaviento Crop Pinkadelic</strong> (poliéster rip stop con terminación de poliuretano, corte crop y cuello con gorro).",
  },
  {
    poleron: "poleron-black-colors",
    cortaviento: "cortaviento-vintage-1",
    titulo: "Black Colors + Vintage",
    desc:
      "El <strong>polerón Black Colors</strong> (franela de algodón con puño, cuello alto con capucha y bolsillo canguro) más el <strong>cortaviento Impermeable Vintage</strong> (exterior impermeable con forro térmico y capucha ajustable).",
  },
];

const DESCRIPCION_COLECCION =
  "<p><strong>Cyber Monday 2026:</strong> lo que más se vende, en un solo lugar. Polerones y cortavientos elegidos por unidades vendidas, no por catálogo.</p>" +
  "<p>Todos son <strong>unisex</strong>, van de la XS a la XXL y se envían a todo Chile. Si te queda la duda con la talla, mide una prenda que te quede bien y compárala con la <a href=\"/pages/guia-de-tallas\">guía de tallas</a>.</p>" +
  "<p>Y si quieres el look completo, los <strong>packs</strong> de cortaviento + polerón están a un 10% menos que por separado.</p>" +
  "<h3>Lo más vendido</h3><ul>" +
  "<li>Polerón Manga Murciélago Exclusive</li>" +
  "<li>Cortaviento Pistachio Spring Trend</li>" +
  "<li>Polerón Nostalgic</li>" +
  "<li>Cortaviento Crop Pinkadelic</li>" +
  "<li>Cortaviento Impermeable Vintage</li>" +
  "<li>Polerón Black Colors</li>" +
  "</ul>" +
  "<p>Escríbenos por WhatsApp al <a href=\"https://wa.me/56929773980\">+56 9 2977 3980</a> y te armamos el pedido.</p>";

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
  if (!tk.access_token) {
    console.log("  ERROR: no se obtuvo el token");
    return;
  }
  const TOKEN = tk.access_token;
  const URL_API = `https://${shop}.myshopify.com/admin/api/2026-01/graphql.json`;

  async function gql(query, variables) {
    const cuerpo = variables ? { query, variables } : { query };
    for (let intento = 0; intento < 3; intento++) {
      const res = await fetch(URL_API, {
        method: "POST",
        headers: { "X-Shopify-Access-Token": TOKEN, "Content-Type": "application/json" },
        body: JSON.stringify(cuerpo),
      });
      const texto = await res.text();
      if (texto) {
        try {
          const j = JSON.parse(texto);
          if (j.errors) console.log("   (!) " + JSON.stringify(j.errors).slice(0, 240));
          return j;
        } catch (e) {
          console.log("   (!) no json: " + texto.slice(0, 140));
          return null;
        }
      }
      console.log("   (respuesta vacia, reintento " + (intento + 1) + ")");
      await new Promise((r2) => setTimeout(r2, 2000));
    }
    return null;
  }

  // 0) limpiar el producto de prueba de una corrida anterior
  const r0 = await gql('{ products(first: 130, query: "status:active") { nodes { id handle title productType totalInventory featuredMedia { preview { image { url } } } } }');
  if (r0 && r0.data && r0.data.products) {
    const prueba = r0.data.products.nodes.find((p) => p.handle === "prueba-pack-cm");
    if (prueba) {
      const d = await gql("mutation($id: ID!) { productDelete(id: $id) { deletedProductId userErrors { message } } }", { id: prueba.id });
      console.log("  producto de prueba borrado: " + (d && d.data ? d.data.productDelete.deletedProductId : "?").toString().slice(0, 40));
    }
  }

  // 1) productos (query liviana) y variantes de los que nos interesan
  const j = await gql(
    '{ products(first: 130, query: "status:active") { nodes { id handle title productType totalInventory featuredMedia { preview { image { url } } } } } }'
  );
  if (!j || !j.data || !j.data.products) {
    console.log("  ERROR: no se pudieron leer los productos");
    return;
  }
  const porHandleTmp = new Map(j.data.products.nodes.map((p) => [p.handle, p]));
  const faltan = HANDLES.filter((h) => !porHandleTmp.has(h));
  if (faltan.length) {
    console.log("  ERROR: no encontramos " + faltan.join(", "));
    return;
  }
  const ids = HANDLES.map((h) => porHandleTmp.get(h).id);
  const jv = await gql(
    "query($ids: [ID!]!) { nodes(ids: $ids) { ... on Product { id handle title variants(first: 40) { nodes { title price inventoryQuantity availableForSale selectedOptions { name value } } } } } }",
    { ids }
  );
  if (!jv || !jv.data || !jv.data.nodes) {
    console.log("  ERROR: no se pudieron leer las variantes");
    return;
  }
  const porHandle = new Map();
  for (const p of jv.data.nodes) {
    if (!p) continue;
    porHandle.set(p.handle, Object.assign({}, porHandleTmp.get(p.handle), p));
  }

  console.log("  === los 10 de la coleccion ===");
  HANDLES.forEach((h) => {
    const p = porHandle.get(h);
    console.log("   " + h.padEnd(38) + " stock=" + String(p.totalInventory).padStart(4) + " | $" + p.variants.nodes[0].price);
  });

  // ---------------------------------------------------------------- coleccion
  const ex = await gql('{ collectionByHandle(handle: "cyber-monday-2026") { id title } }');
  const yaExiste = ex && ex.data && ex.data.collectionByHandle;
  console.log("\n  coleccion cyber-monday-2026: " + (yaExiste ? "ya existe" : "se crea"));

  let coleccionId = yaExiste ? yaExiste.id : null;
  if (APLICAR) {
    if (!yaExiste) {
      const r = await gql(
        "mutation($c: CollectionInput!) { collectionCreate(input: $c) { collection { id title handle } userErrors { message field } } }",
        {
          c: {
            title: "Cyber Monday 2026",
            handle: "cyber-monday-2026",
            descriptionHtml: DESCRIPCION_COLECCION,
            seo: {
              title: "Cyber Monday 2026 | Polerones y Cortavientos | MONDANO",
              description:
                "Los polerones y cortavientos más vendidos de MONDANO, con packs de cortaviento + polerón al 10% menos. Unisex, XS a XXL. Envío a todo Chile.",
            },
          },
        }
      );
      if (!r || !r.data || !r.data.collectionCreate) {
        console.log("  ERROR creando la coleccion");
        return;
      }
      const ue = r.data.collectionCreate.userErrors;
      if (ue && ue.length) {
        console.log("  ERROR coleccion: " + JSON.stringify(ue).slice(0, 220));
        return;
      }
      coleccionId = r.data.collectionCreate.collection.id;
      console.log("  coleccion creada: " + coleccionId);
    }
    const r = await gql(
      "mutation($id: ID!, $pids: [ID!]!) { collectionAddProducts(id: $id, productIds: $pids) { collection { id productsCount { count } } userErrors { message field } } }",
      { id: coleccionId, pids: ids }
    );
    const ca = r && r.data ? r.data.collectionAddProducts : null;
    console.log(
      "  productos en la coleccion: " + (ca ? ca.collection.productsCount.count : "?") +
      (ca && ca.userErrors.length ? " | ERROR " + JSON.stringify(ca.userErrors).slice(0, 220) : "")
    );
  }

  // ---------------------------------------------------------------- packs
  for (const pack of PACKS) {
    const pol = porHandle.get(pack.poleron);
    const cor = porHandle.get(pack.cortaviento);
    const pPol = Number(pol.variants.nodes[0].price);
    const pCor = Number(cor.variants.nodes[0].price);
    const bruto = pPol + pCor;
    const precio = Math.round((bruto * (1 - DIAS_OFF)) / 500) * 500;
    const ahorro = bruto - precio;
    // 2XL y XXL son la misma talla: se normalizan antes de cruzar
    const norm = (t) => (t === "2XL" ? "XXL" : t);
    const tPol = [...new Set(pol.variants.nodes.map((v) => norm(v.selectedOptions.map((o) => o.value).join("/"))))];
    const tCor = [...new Set(cor.variants.nodes.map((v) => norm(v.selectedOptions.map((o) => o.value).join("/"))))];
    const comunes = tPol.filter((t) => tCor.includes(t));
    const base = comunes.length ? comunes : tPol;
    const tallas = [...new Set(base)].sort((a, b) => ORDEN_TALLAS.indexOf(a) - ORDEN_TALLAS.indexOf(b));

    console.log("\n  === PACK " + pack.titulo + " ===");
    console.log("     " + pol.title + " ($" + pPol + ") + " + cor.title + " ($" + pCor + ")");
    console.log("     precio con 10% off: $" + precio + " (ahorra $" + ahorro + ") | tallas: " + tallas.join(" "));

    if (!APLICAR) continue;

    const handle = "pack-" + pack.poleron.replace(/^poleron-/, "") + "-" + pack.cortaviento.replace(/^cortaviento-/, "");
    const bodyHtml =
      "<p>" + pack.desc + "</p>" +
      "<p><strong>Precio del pack: $" + precio + ".</strong> Las dos prendas por separado cuestan $" + bruto + ": te ahorras <strong>$" + ahorro + "</strong>.</p>" +
      "<p>Polerón y cortaviento van en la <strong>misma talla</strong>. Si tu talla es 2XL, acá corresponde XXL.</p>" +
      "<p>Unisex, de la XS a la XXL. Envío a todo Chile. Si te queda la duda con la talla, mira la <a href=\"/pages/guia-de-tallas\">guía de tallas</a> o escríbenos al <a href=\"https://wa.me/56929773980\">+56 9 2977 3980</a>.</p>";

    // 1) producto con la opcion Talla. OJO: productCreate solo crea la
    //    variante default; el resto se agrega despues con bulkCreate.
    let packId = null;
    // OJO: product(handle:) no devuelve estos productos, asi que se buscan
    // por titulo en el listado.
    const r0 = await gql('{ products(first: 130) { nodes { id title variants(first: 30) { nodes { id title } } } } }');
    const existente = r0 && r0.data ? r0.data.products.nodes.find((x) => x.title === "Pack Cyber Monday 2026: " + pack.titulo) : null;
    if (existente) {
      packId = existente.id;
      console.log("     el pack ya existia, se actualiza");
    } else {
      const r = await gql(
        "mutation($p: ProductCreateInput!) { productCreate(product: $p) { product { id handle title variants(first: 30) { nodes { id title price } } } userErrors { message field } } }",
        {
          p: {
            title: "Pack Cyber Monday 2026: " + pack.titulo,
            handle: handle,
            productType: "Pack",
            descriptionHtml: bodyHtml,
            status: "ACTIVE",
            tags: ["cyber-monday-2026", "pack", "poleron", "cortaviento"],
            productOptions: [{ name: "Talla", values: tallas.map((t) => ({ name: t })) }],
            seo: {
              title: "Pack Cortaviento + Polerón | Cyber Monday 2026 | MONDANO",
              description:
                "Pack de cortaviento impermeable + polerón con 10% de descuento. Unisex, XS a XXL. Envío a todo Chile. Oferta Cyber Monday 2026 en MONDANO.",
            },
          },
        }
      );
      if (!r || !r.data || !r.data.productCreate) {
        console.log("     ERROR creando el pack");
        continue;
      }
      const ue = r.data.productCreate.userErrors;
      if (ue && ue.length) {
        console.log("     ERROR pack: " + JSON.stringify(ue).slice(0, 250));
        continue;
      }
      packId = r.data.productCreate.product.id;
      console.log("     pack creado: " + handle);
    }

    // 2) precio de las variantes que ya existen
    const rv = await gql('{ product(id: "' + packId + '") { variants(first: 30) { nodes { id title } } } }');
    let vars = rv.data.product.variants.nodes;
    if (vars.length) {
      const lits = vars.map((v) => '{id: "' + v.id + '", price: "' + precio + '"}').join(", ");
      await gql(
        "mutation($id: ID!) { productVariantsBulkUpdate(productId: $id, variants: [" + lits + "], allowPartialUpdates: true) { productVariants { id title price } userErrors { message field } } }",
        { id: packId }
      );
    }

    // 3) las tallas que falten
    const hechas = new Set(vars.map((v) => v.title));
    const faltan = tallas.filter((t) => !hechas.has(t));
    if (faltan.length) {
      const lits = faltan.map((t) => '{optionValues: [{optionName: "Talla", name: "' + t + '"}], price: "' + precio + '"}').join(", ");
      const rc = await gql(
        "mutation($id: ID!) { productVariantsBulkCreate(productId: $id, variants: [" + lits + "], strategy: REMOVE_STANDALONE_VARIANT) { productVariants { id title price } userErrors { message field } } }",
        { id: packId }
      );
      console.log("     variantes creadas: " + (rc && rc.data && rc.data.productVariantsBulkCreate ? (rc.data.productVariantsBulkCreate.productVariants || []).map((v) => v.title).join(" ") : "?") + (rc && rc.errors ? " | " + JSON.stringify(rc.errors).slice(0, 160) : ""));
    }

    // 4) imagen: la del cortaviento del pack
    const img = cor.featuredMedia && cor.featuredMedia.preview ? cor.featuredMedia.preview.image.url : null;
    if (img) {
      const rm = await gql(
        'mutation($id: ID!, $url: String!) { productSet(input: {id: $id, files: [{contentType: IMAGE, originalSource: $url, alt: "' + pack.titulo + '"}]}, synchronous: true) { product { id featuredMedia { preview { image { url } } } } userErrors { message field } } }',
        { id: packId, url: img }
      );
      const fm = rm && rm.data ? rm.data.productSet.product.featuredMedia : null;
      console.log("     imagen: " + (fm ? "ok" : "sin imagen") + (rm && rm.errors ? " | " + JSON.stringify(rm.errors).slice(0, 150) : ""));
    }
  }

  // ---------------------------------------------------------------- publicar
  // Lo creado por API no sale solo en la tienda: hay que publicarlo en el
  // canal Online Store.
  if (APLICAR) {
    const ONLINE = "gid://shopify/Publication/78057111775";
    const aPublicar = [["coleccion", coleccionId]];
    const rp = await gql('{ products(first: 130) { nodes { id title } } }');
    if (rp && rp.data) {
      rp.data.products.nodes.filter((p) => /^Pack Cyber Monday/i.test(p.title)).forEach((p) => aPublicar.push(["pack", p.id]));
    }
    for (const [tipo, id] of aPublicar) {
      const r = await gql(
        "mutation($id: ID!, $p: ID!) { publishablePublish(id: $id, input: {publicationId: $p}) { userErrors { message field } } }",
        { id, p: ONLINE }
      );
      console.log("  publicar " + tipo + ": " + (r && r.data && !r.data.publishablePublish.userErrors.length ? "OK" : JSON.stringify(r && r.errors ? r.errors : r.data.publishablePublish.userErrors).slice(0, 160)));
    }
  }

  console.log("\n  " + (APLICAR ? "hecho." : "(dry-run: no se escribio nada. Usa --aplicar)"));
})();
