/**
 * Bloque 2 del plan SEO (22-12-2026): una coleccion por palabra clave.
 *
 *   node scripts/admin-seo-colecciones.js            -> dry-run
 *   node scripts/admin-seo-colecciones.js --aplicar   -> escribe
 *
 * Crea:
 *   /collections/parkas     (18 productos) -> "parkas", "parkas impermeables"
 *   /collections/casacas    (11 productos) -> "casacas"
 *   /pages/impermeables     (hub)          -> "impermeables" (hoy 0 impresiones)
 *
 * Y actualiza:
 *   /collections/cortavientos  -> seo.title con keyword + link a la guia
 *   /collections/parkas-y-casacas -> 301 a /collections/parkas
 *
 * Decisiones del merchant (22-12-2026): el 301 si; "impermeables" es una
 * etiqueta transversal, asi que se hace como pagina hub con enlaces y no
 * como coleccion de productos (evita que las mismas prendas aparezcan en
 * cuatro paginas).
 */
require("dotenv").config();

const APLICAR = process.argv.includes("--aplicar");

const TEXTOS = {
  parkas: {
    title: "Parkas",
    seoTitle: "Parkas Impermeables para Mujer y Hombre en Chile",
    seoDescription:
      "Parkas impermeables y termicas para el invierno chileno. Unisex, de la XS a la XXL. Tela Taslan, poliamida y forro termico. Envio a todo Chile.",
    descriptionHtml: [
      "<p>Una <strong>parka</strong> es el abrigo largo que aguanta la lluvia y el frio de verdad: llega por debajo de la rodilla, lleva capucha, cierre y forro, y en Chile se usa de septiembre a mayo. Las nuestras son <strong>unisex</strong> y van de la XS a la XXL.</p>",
      "<p>Las telas van de la <strong>Taslan</strong> a la <strong>poliamida</strong> y la <strong>Thermaheat</strong>: repelen el agua, pesan poco y secan rapido. Sirven para un dia de lluvia en la ciudad igual que para un fin de semana en la cordillera. Si buscas el abrigo mas impermeable del catalogo, mira nuestra <a href=\"/pages/impermeables\">guia de las prendas impermeables</a>, donde explicamos la diferencia entre impermeable y repelente al agua y que material elegir para cada clima.</p>",
      "<p>Buscas algo mas corto o solo para la lluvia? Entonces mira las <a href=\"/collections/cortavientos\">cortavientos impermeables</a>. Y si lo que quieres es algo que sirva de abrigo de diario, las <a href=\"/collections/casacas\">casacas</a> son lo mas parecido a una parka, pero mas cortas.</p>",
      "<p>Tallas XS a XXL. Si dudas con la talla, mide una prenda que te quede bien y comparala con la <a href=\"/pages/guia-de-tallas\">guia de tallas</a>, o escribenos por WhatsApp al <a href=\"https://wa.me/56929773980\">+56 9 2977 3980</a> y te ayudamos a elegir.</p>",
    ].join("\n"),
  },
  casacas: {
    title: "Casacas",
    seoTitle: "Casacas Impermeables Unisex en Chile",
    seoDescription:
      "Casacas impermeables y termicas unisex, de la XS a la XXL. Tela Taslan, poliamida y forro de fleece. El abrigo corto para todos los dias. Envio a todo Chile.",
    descriptionHtml: [
      "<p>La <strong>casaca</strong> es el abrigo corto: la prenda que te pones sin pensarlo para ir al trabajo, a la to uni o a tomar el cerro con frio. Es mas liviana que una parka y se lleva igual de bien, y en Mondano todas son <strong>unisex</strong>, de la XS a la XXL.</p>",
      "<p>Nuestras casacas combinan <strong>Taslan</strong>, <strong>poliamida</strong> y <strong>Thermaheat</strong> con forro de fleece en los modelos mas frios: repelen el agua, pesan poco y secan rapido. Para saber que material necesitas segun el clima, lee nuestra <a href=\"/pages/impermeables\">guia de prendas impermeables</a>.</p>",
      "<p>Si quieres un abrigo mas largo, con capucha y mas abrigo, mira las <a href=\"/collections/parkas\">parkas impermeables</a>. Y si lo que buscas es algo solo para la lluvia y el viento, las <a href=\"/collections/cortavientos\">cortavientos impermeables</a> son mas livianas todavia.</p>",
      "<p>Tallas XS a XXL. Si dudas, mide una prenda que te quede bien y comparala con la <a href=\"/pages/guia-de-tallas\">guia de tallas</a>, o escribenos por WhatsApp al <a href=\"https://wa.me/56929773980\">+56 9 2977 3980</a>.</p>",
    ].join("\n"),
  },
};

const HUB = [
  "<p>En Chile, <strong>impermeable</strong> no significa solamente \"que no te mojas\": significa que la tela repele el agua, que seca rapido y que no te deja congelado. Y no todas las prendas lo logran de la misma forma: hay diferencias entre <strong>impermeable</strong> y <strong>repelente al agua</strong>, y entre las <strong>telas</strong> que usamos.</p>",
  "<h2>Impermeable o repelente al agua</h2>",
  "<p>Una prenda <strong>impermeable</strong> bloquea el agua: sirve cuando llueve fuerte o cuando vas a estar mucho tiempo bajo la lluvia. Una prenda <strong>repelente al agua</strong> (water repellent) resiste un rato y despues deja pasar el agua: es mas liviana y transpirable, ideal para la lluvia de la ciudad. Para el clima de la cordillera o del sur, impermeable.</p>",
  "<h2>Los materiales que usamos</h2>",
  "<ul><li><strong>Taslan</strong>: polyester ripstop, repele el agua, pesa poco y resiste la abrasion. Ideal para chaquetas y parkas de uso diario.</li><li><strong>Poliamida</strong>: la base de nuestras prendas impermeables; muy liviana y de secado rapido.</li><li><strong>Thermaheat</strong>: forro termico que mantiene el calor sin agregar peso.</li><li><strong>Franela</strong> y <strong>algodon</strong>: para el frio seco de la altura, sin lluvia.</li></ul>",
  "<h2>Cual necesitas</h2>",
  "<p>Si tu problema es la <strong>lluvia</strong>: <a href=\"/collections/cortavientos\">cortavientos impermeables</a>, livianos y cortos. Si ademas hace <strong>frio</strong>: <a href=\"/collections/parkas\">parkas impermeables</a>, que llegan mas abajo de la rodilla y llevan forro. Y si buscas algo que <strong>todavia mas se ponga y quite</strong>: las <a href=\"/collections/casacas\">casacas impermeables</a>.</p>",
  "<h2>Cuidado y mantenimiento</h2>",
  "<p>Un impermeable se lava con agua fria y nunca en secadora: el calor dania el recubrimiento y la prenda deja de repeler el agua. Te explicamos el paso a paso en <a href=\"/blogs/noticias/como-cuidar-tu-ropa-para-que-dure\">como cuidar tu ropa</a> y en <a href=\"/blogs/noticias/que-ponerse-cuando-llueve-en-chile\">que ropa llevar cuando llueve en Chile</a>.</p>",
  "<p>Todos los impermeables de Mondano son <strong>unisex</strong> y van de la XS a la XXL. Si dudas con la talla, mide una prenda que te quede bien y comparala con la <a href=\"/pages/guia-de-tallas\">guia de tallas</a>.</p>",
].join("\n");

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

  // ---------------------------------------------------------------- productos
  const ps = [];
  let after = null;
  for (let i = 0; i < 4; i++) {
    const q =
      "{ products(first: 40" +
      (after ? `, after: "${after}"` : "") +
      ', query: "status:active") { nodes { id handle title productType } pageInfo { hasNextPage endCursor } } }';
    const j = await gql(q);
    if (!j || !j.products) break;
    ps.push(...j.products.nodes);
    if (!j.products.pageInfo.hasNextPage) break;
    after = j.products.pageInfo.endCursor;
  }

  // Los "Casaca/Parka - ICONIC ..." tienen tipo "Casaca" pero se venden
  // como casaca O como parka (opcion Estilo), asi que van en las dos.
  const esParka = (p) =>
    /parka/i.test(p.productType || "") || /^casaca\s*\/\s*parka/i.test(p.title || "");
  const esCasaca = (p) => /casaca/i.test(p.productType || "");
  const parkas = ps.filter(esParka);
  const casacas = ps.filter(esCasaca);
  console.log(`\n  productos: ${ps.length}`);
  console.log(`  parkas: ${parkas.length} | casacas: ${casacas.length}`);
  const tipos = {};
  ps.forEach((x) => (tipos[x.productType] = (tipos[x.productType] || 0) + 1));
  console.log("  tipos: " + JSON.stringify(tipos));
  const ambas = ps.filter((x) => esParka(x) && esCasaca(x));
  console.log("  en las dos (tipo Casaca/Parka): " + ambas.length + " -> " + ambas.map((x) => x.title).join(" | "));

  const jc = await gql(`{ collections(first: 40) { nodes { id title handle } } }`);
  const porHandle = new Map(jc.collections.nodes.map((c) => [c.handle, c]));

  if (!APLICAR) {
    console.log("\n=== plan ===");
    for (const [handle, cfg] of Object.entries(TEXTOS)) {
      const existe = porHandle.get(handle);
      console.log(
        `  /collections/${handle}: ${existe ? "YA EXISTE" : "se crea"} | ${cfg.seoTitle} (${cfg.seoTitle.length} car.)`
      );
      console.log(`      texto: ${cfg.descriptionHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().split(" ").length} palabras`);
    }
    console.log(`  /pages/impermeables: se crea | ${HUB.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().split(" ").length} palabras`);
    console.log(`  301: /collections/parkas-y-casacas -> /collections/parkas`);
    console.log("\n  (dry-run: no se escribio nada. Usa --aplicar)");
    return;
  }

  // ---------------------------------------------------------------- colecciones
  for (const [handle, cfg] of Object.entries(TEXTOS)) {
    const existente = porHandle.get(handle);
    let id = existente ? existente.id : null;
    if (existente) {
      const r = await gql(
        `mutation($c: CollectionInput!) {
          collectionUpdate(input: $c) { collection { id title handle } userErrors { message field } }
        }`,
        {
          id,
          c: {
            id,
            title: cfg.title,
            descriptionHtml: cfg.descriptionHtml,
            seo: { title: cfg.seoTitle, description: cfg.seoDescription },
          },
        }
      );
      const ue = r && r.collectionUpdate ? r.collectionUpdate.userErrors : null;
    if (!r || !r.collectionUpdate) {
      console.log("  ERROR: la mutation no respondio (revisar el mensaje de arriba)");
      return;
    }
      console.log(`  /collections/${handle}: actualizada ${ue && ue.length ? "ERROR " + JSON.stringify(ue).slice(0, 160) : "OK"}`);
      continue;
    }
    const r = await gql(
      `mutation($c: CollectionInput!) {
        collectionCreate(input: $c) {
          collection { id title handle }
          userErrors { message field }
        }
      }`,
      {
        c: {
          title: cfg.title,
          handle,
          descriptionHtml: cfg.descriptionHtml,
          seo: { title: cfg.seoTitle, description: cfg.seoDescription },
        },
      }
    );
    const ue = r && r.collectionCreate ? r.collectionCreate.userErrors : null;
    if (ue && ue.length) {
      console.log(`  /collections/${handle}: ERROR ${JSON.stringify(ue).slice(0, 200)}`);
      continue;
    }
    id = r.collectionCreate.collection.id;
    console.log(`  /collections/${handle}: creada (${id})`);

    const productos = handle === "parkas" ? parkas : casacas;
    const r2 = await gql(
      `mutation($id: ID!, $pids: [ID!]!) {
        collectionAddProducts(id: $id, productIds: $pids) {
          collection { id productsCount { count } }
          userErrors { message }
        }
      }`,
      { id, pids: productos.map((p) => p.id) }
    );
    const ue2 = r2 && r2.collectionAddProducts ? r2.collectionAddProducts.userErrors : null;
    console.log(
      `      productos: ${productos.length} ${ue2 && ue2.length ? "ERROR " + JSON.stringify(ue2).slice(0, 160) : "OK"}`
    );
  }

  // ---------------------------------------------------------------- hub
  const jp = await gql(`{ pages(first: 40) { nodes { id handle title } } }`);
  const paginaHub = jp.pages.nodes.find((p) => p.handle === "impermeables");
  if (paginaHub) {
    const r = await gql(
      `mutation($id: ID!, $b: String!) { pageUpdate(id: $id, page: {body: $b}) { page { id title handle } userErrors { message } } }`,
      { id: paginaHub.id, b: HUB }
    );
    const ue = r && r.pageUpdate ? r.pageUpdate.userErrors : null;
    console.log(`  /pages/impermeables: actualizada ${ue && ue.length ? "ERROR " + JSON.stringify(ue).slice(0, 160) : "OK"}`);
  } else {
    const r = await gql(
      `mutation($t: String!, $b: String!, $h: String!) {
        pageCreate(page: {title: $t, body: $b, handle: $h}) {
          page { id title handle }
          userErrors { message field }
        }
      }`,
      { t: "Impermeables", b: HUB, h: "impermeables" }
    );
    const ue = r && r.pageCreate ? r.pageCreate.userErrors : null;
    console.log(`  /pages/impermeables: creada ${ue && ue.length ? "ERROR " + JSON.stringify(ue).slice(0, 220) : "OK"}`);
    if (r && r.pageCreate && r.pageCreate.page) {
      await gql(
        `mutation($m: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $m) { metafields { namespace key value } userErrors { message field } }
        }`,
        {
          m: [
            {
              ownerId: r.pageCreate.page.id,
              namespace: "seo",
              key: "description",
              type: "single_line_text_field",
              value:
                "Guia de prendas impermeables en Chile: impermeable vs repelente al agua, telas Taslan, poliamida y Thermaheat, y cual elegir entre parkas, casacas y cortavientos. Unisex, XS a XXL.",
            },
          ],
        }
      );
      console.log("      meta description escrita");
    }
  }

  // ---------------------------------------------------------------- 301
  const r301 = await gql(
    `mutation($p: UrlRedirectInput!) {
      urlRedirectCreate(urlRedirect: $p) { urlRedirect { id path target } userErrors { message } }
    }`,
    { p: { path: "/collections/parkas-y-casacas", target: "/collections/parkas" } }
  );
  const ue3 = r301 && r301.urlRedirectCreate ? r301.urlRedirectCreate.userErrors : null;
  console.log(
    `  301 /collections/parkas-y-casacas -> /collections/parkas: ${ue3 && ue3.length ? "ERROR " + JSON.stringify(ue3).slice(0, 160) : "OK"}`
  );

  // ---------------------------------------------------------------- cortavientos
  const jcol = await gql(`{ collection(id: "${porHandle.get("cortavientos").id}") { id title handle descriptionHtml seo { title description } } }`);
  const c = jcol.collection;
  const descActual = c.descriptionHtml || "";
  const addition =
    " Si buscas el abrigo impermeable de verdad, mira nuestra <a href=\"/pages/impermeables\">guia de prendas impermeables</a> y las <a href=\"/collections/parkas\">parkas</a>.";
  const descNuevo = descActual.includes("/pages/impermeables")
    ? descActual
    : descActual.replace(/<\/p>\s*$/, addition + "</p>");
  const r2 = await gql(
    `mutation($c: CollectionInput!) {
      collectionUpdate(input: $c) {
        collection { id title handle seo { title description } }
        userErrors { message field }
      }
    }`,
    {
      id: c.id,
      c: {
        id: c.id,
        descriptionHtml: descNuevo,
        seo: {
          title: "Cortavientos Impermeables Unisex en Chile",
          description:
            "Cortavientos impermeables livianos y repelentes al agua, para la lluvia y el viento. Unisex, de la XS a la XXL. Tela repelente al agua y capucha. Envio a todo Chile.",
        },
      },
    }
  );
  const ue4 = r2 && r2.collectionUpdate ? r2.collectionUpdate.userErrors : null;
  if (!r2 || !r2.collectionUpdate) {
    console.log("  ERROR: la mutation de cortavientos no respondio");
    return;
  }
  console.log(`  /collections/cortavientos: seo.title + link a la guia ${ue4 && ue4.length ? "ERROR " + JSON.stringify(ue4).slice(0, 160) : "OK"}`);
})();
