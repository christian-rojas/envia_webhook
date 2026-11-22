/**
 * Titles y meta descriptions de las colecciones de ropa con query generica
 * (Bloque 1.2 del plan SEO, 22-12-2026).
 *
 *   node scripts/admin-seo-titulos-colecciones.js            -> dry-run
 *   node scripts/admin-seo-titulos-colecciones.js --aplicar   -> escribe
 *
 * Solo se escribe seo.title y seo.description. No se toca el texto de la
 * coleccion (ya reescrito en la tanda anterior), ni los productos, ni los
 * handles.
 *
 * No se tocan las colecciones que ya tienen un title con keyword
 * (parkas, casacas, cortavientos) ni las estacionales o de marca
 * (invierno-2026, cyber-2026, denim, mike, dia-de-la-madre, all).
 */
require("dotenv").config();

const APLICAR = process.argv.includes("--aplicar");

const TEXTOS = {
  polerones: {
    title: "Polerones Unisex Oversize en Chile",
    desc: "Polerones unisex oversize en Chile: workshirt, crewneck, con capucha y crop. Del algodón pesado al fleece, en tallas XS a XXL. Envío a todo Chile.",
  },
  conjuntos: {
    title: "Conjuntos Unisex de Abrigo en Chile",
    desc: "Conjuntos unisex de dos piezas en Chile: polerón con shorts, camisa con pantalón y más. Paletas que combinan entre sí. Tallas XS a XXL. Envío a Chile.",
  },
  vestidos: {
    title: "Vestidos Unisex de Verano en Chile",
    desc: "Vestidos unisex de verano en Chile: estampados, brisa, olas, punto y tirantes. Tejidos livianos y siluetas cómodas. Tallas XS a XXL. Envío a Chile.",
  },
  camisas: {
    title: "Camisas Unisex de Algodón en Chile",
    desc: "Camisas unisex estilo boho en Chile, con cuello mao y algodón liviano. De la camisa de día a la de noche. Tallas XS a XXL. Envío a todo Chile.",
  },
  pantalones: {
    title: "Pantalones Unisex Baggy en Chile",
    desc: "Pantalones unisex baggy en Chile: jeans, cargo y cortes relajados que mantienen la forma después de muchas lavadas. Tallas XS a XXL. Envío a Chile.",
  },
  chiporros: {
    title: "Chiporros Térmicos de Invierno en Chile",
    desc: "Chiporros térmicos en Chile: exterior de chiporro resistente e interior fleece, con capucha y cierre. Abrigo real para el invierno. Envío a Chile.",
  },
  "best-sellers": {
    title: "Los Más Vendidos en Chile",
    desc: "Los más vendidos de Mondano: polerones, casacas, conjuntos y vestidos que se repiten cada temporada. La lista más fácil para empezar. Envío a Chile.",
  },
};

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
    if (r.errors) {
      console.log("   (!) " + JSON.stringify(r.errors).slice(0, 260));
      return null;
    }
    return r.data;
  };

  const jc = await gql(`{ collections(first: 40) { nodes { id title handle seo { title description } productsCount { count } } } }`);
  const porHandle = new Map(jc.collections.nodes.map((c) => [c.handle, c]));

  let errores = 0;
  for (const [handle, cfg] of Object.entries(TEXTOS)) {
    const c = porHandle.get(handle);
    if (!c) {
      console.log(`  ERROR: no existe la coleccion ${handle}`);
      errores++;
      continue;
    }
    if (cfg.desc.length > 165 || cfg.desc.length < 120)
      console.log(`  (!) ${handle}: desc de ${cfg.desc.length} car.`);
    console.log(`  ${handle} (${c.productsCount.count} prod)`);
    console.log(`      - ${c.seo.title || "(sin title)"}`);
    console.log(`      + ${cfg.title}`);
    if (!APLICAR) continue;

    const r = await gql(
      `mutation($c: CollectionInput!) {
        collectionUpdate(input: $c) {
          collection { id handle seo { title description } }
          userErrors { message field }
        }
      }`,
      { c: { id: c.id, seo: { title: cfg.title, description: cfg.desc } } }
    );
    if (!r || !r.collectionUpdate) {
      console.log("      ERROR: la mutation no respondio");
      errores++;
      continue;
    }
    const ue = r.collectionUpdate.userErrors;
    if (ue && ue.length) {
      console.log("      ERROR " + JSON.stringify(ue).slice(0, 200));
      errores++;
      continue;
    }
    const s = r.collectionUpdate.collection.seo;
    if (s.title !== cfg.title) {
      console.log("      ERROR: Shopify guardo otro title");
      errores++;
    }
  }

  console.log(
    `\n  ${Object.keys(TEXTOS).length} colecciones | errores: ${errores}` +
      (APLICAR ? "" : "\n  (dry-run: no se escribio nada. Usa --aplicar)")
  );
})();
