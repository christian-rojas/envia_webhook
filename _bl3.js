require("dotenv").config();
(async () => {
  const SHOP = process.env.SHOPIFY_SHOP;
  const t = await (await fetch("https://" + SHOP + ".myshopify.com/admin/oauth/access_token", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_id: process.env.SHOPIFY_ADMIN_CLIENT_ID, client_secret: process.env.SHOPIFY_ADMIN_CLIENT_SECRET, grant_type: "client_credentials" }),
  })).json();
  const H = { "X-Shopify-Access-Token": t.access_token, "Content-Type": "application/json" };
  const A = "https://" + SHOP + ".myshopify.com/admin/api/2026-01/graphql.json";
  const gql = async (q) => {
    const r = await (await fetch(A, { method: "POST", headers: H, body: JSON.stringify({ query: q }) })).json();
    if (r.errors) { console.log("  err " + JSON.stringify(r.errors).slice(0, 200)); return null; }
    return r.data;
  };
  const b = await gql('{ articles(first: 20) { nodes { title handle publishedAt md: metafield(namespace:"seo", key:"description") { value } blog { title } } } }');
  console.log("=== ARTICULOS DEL BLOG ===");
  (b.articles ? b.articles.nodes : []).forEach((a) => {
    const md = (a.md && a.md.value) ? a.md.value.length : 0;
    console.log("  " + (a.publishedAt ? "ON " : "OFF") + " " + a.title.padEnd(40) + " meta_desc=" + String(md).padStart(4) + (md < 70 ? "  <-- CORTA O FALTA" : ""));
  });
  const ps = [];
  let after = null;
  for (let i = 0; i < 4; i++) {
    const q = '{ products(first: 40' + (after ? ', after: "' + after + '"' : "") + ', query: "status:active") { nodes { title rating: metafield(namespace:"reviews", key:"rating") { value } count: metafield(namespace:"reviews", key:"rating_count") { value } } pageInfo { hasNextPage endCursor } } }';
    const r = await gql(q);
    if (!r || !r.products) break;
    ps.push(...r.products.nodes);
    if (!r.products.pageInfo.hasNextPage) break;
    after = r.products.pageInfo.endCursor;
  }
  const conR = ps.filter((x) => x.rating).length;
  const conC = ps.filter((x) => x.count).length;
  console.log("\n  productos con rating: " + conR + "/" + ps.length + " | con conteo de resenas: " + conC);
})();
