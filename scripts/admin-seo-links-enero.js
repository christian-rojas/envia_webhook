/**
 * Links internos desde las colecciones al blog (tarea de enero 2027).
 *
 *   node scripts/admin-seo-links-enero.js            -> dry-run
 *   node scripts/admin-seo-links-enero.js --aplicar   -> escribe
 *
 * POR QUE HAY QUE ESPERAR: los 4 articulos estan agendados para enero 2027
 * (isPublished: false), asi que sus URLs devuelven 404 hasta esa fecha. Un
 * link a un 404 desde una pagina indexada es peor que ningun link, asi que
 * los links se agregan el mismo dia que los articulos se publican.
 *
 * QUE HACE: agrega un parrafo con enlaces a los 4 articulos al final de la
 * descripcion de las colecciones parkas, casacas y cortavientos, y de la
 * pagina hub /pages/impermeables. Es idempotente: si el link ya esta, no
 * escribe nada.
 */
require("dotenv").config();

const APLICAR = process.argv.includes("--aplicar");

const ARTICULOS = {
  "diferencia-entre-parka-y-casaca": {
    titulo: "diferencia entre parka y casaca",
    url: "/blogs/noticias/diferencia-entre-parka-y-casaca",
  },
  "como-elegir-cortaviento-impermeable": {
    titulo: "cómo elegir un cortaviento impermeable",
    url: "/blogs/noticias/como-elegir-cortaviento-impermeable",
  },
  "parka-o-cortaviento-impermeable": {
    titulo: "parka o cortaviento impermeable",
    url: "/blogs/noticias/parka-o-cortaviento-impermeable",
  },
  "como-lavar-una-parka-impermeable": {
    titulo: "cómo lavar una parka impermeable",
    url: "/blogs/noticias/como-lavar-una-parka-impermeable",
  },
};

// que articulos van en cada destino
const DESTINOS = {
  parkas: ["diferencia-entre-parka-y-casaca", "parka-o-cortaviento-impermeable", "como-lavar-una-parka-impermeable"],
  casacas: ["diferencia-entre-parka-y-casaca"],
  cortavientos: ["como-elegir-cortaviento-impermeable", "parka-o-cortaviento-impermeable"],
  impermeables: ["diferencia-entre-parka-y-casaca", "como-elegir-cortaviento-impermeable", "parka-o-cortaviento-impermeable", "como-lavar-una-parka-impermeable"],
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

  // los articulos tienen que estar publicados
  const ja = await gql(`{ blog(id: "gid://shopify/Blog/83483230431") { articles(first: 30) { nodes { handle isPublished publishedAt } } } }`);
  const arts = new Map(ja.blog.articles.nodes.map((a) => [a.handle, a]));
  const sinPublicar = Object.keys(ARTICULOS).filter((h) => !arts.get(h) || !arts.get(h).isPublished);
  if (sinPublicar.length) {
    console.log("  ESTOS ARTICULOS AUN NO ESTAN PUBLICADOS: " + sinPublicar.join(", "));
    console.log("  Sus URLs devuelven 404. Espera a que se publiquen y vuelve a correr el script.");
    Object.keys(ARTICULOS).forEach((h) => {
      const a = arts.get(h);
      if (a) console.log("    " + h + " -> " + a.publishedAt);
    });
    return;
  }
  console.log("  los 4 articulos estan publicados: ok");

  const parrafo = (claves) => {
    const lista = claves.map((k) => `<a href="${ARTICULOS[k].url}">${ARTICULOS[k].titulo}</a>`);
    return (
      "<p>¿Todavía estás decidiendo? Te lo explicamos en el blog: " +
      lista.slice(0, -1).join(", ") +
      " y " +
      lista[lista.length - 1] +
      ".</p>"
    );
  };

  let errores = 0;
  for (const [destino, claves] of Object.entries(DESTINOS)) {
    const texto = parrafo(claves);
    if (destino === "impermeables") {
      const jp = await gql(`{ pages(first: 50) { nodes { id handle title body } } }`);
      const p = jp.pages.nodes.find((x) => x.handle === "impermeables");
      if (!p) {
        console.log("  ERROR: no existe la pagina impermeables");
        errores++;
        continue;
      }
      if (p.body.includes(ARTICULOS[claves[0]].url)) {
        console.log("  /pages/impermeables: ya tiene los links");
        continue;
      }
      console.log("  /pages/impermeables: agregaria " + claves.length + " links");
      if (!APLICAR) continue;
      const r = await gql(
        `mutation($id: ID!, $p: PageUpdateInput!) {
          pageUpdate(id: $id, page: $p) { page { id handle } userErrors { message } }
        }`,
        { id: p.id, p: { body: p.body.trim() + "\n" + texto } }
      );
      console.log("    -> " + (r && r.pageUpdate && !r.pageUpdate.userErrors.length ? "OK" : "ERROR " + JSON.stringify(r).slice(0, 180)));
      if (!r || !r.pageUpdate || r.pageUpdate.userErrors.length) errores++;
      continue;
    }
    const jc = await gql(`{ collections(first: 40) { nodes { id handle title descriptionHtml } } }`);
    const c = jc.collections.nodes.find((x) => x.handle === destino);
    if (!c) {
      console.log("  ERROR: no existe la coleccion " + destino);
      errores++;
      continue;
    }
    if (c.descriptionHtml.includes(ARTICULOS[claves[0]].url)) {
      console.log("  /collections/" + destino + ": ya tiene los links");
      continue;
    }
    console.log("  /collections/" + destino + ": agregaria " + claves.length + " links");
    if (!APLICAR) continue;
    const r = await gql(
      `mutation($c: CollectionInput!) {
        collectionUpdate(input: $c) { collection { id handle } userErrors { message } }
      }`,
      { c: { id: c.id, descriptionHtml: c.descriptionHtml.trim() + "\n" + texto } }
    );
    console.log("    -> " + (r && r.collectionUpdate && !r.collectionUpdate.userErrors.length ? "OK" : "ERROR " + JSON.stringify(r).slice(0, 180)));
    if (!r || !r.collectionUpdate || r.collectionUpdate.userErrors.length) errores++;
  }

  console.log("\n  errores: " + errores + (APLICAR ? "" : "\n  (dry-run: no se escribio nada. Usa --aplicar)"));
})();
