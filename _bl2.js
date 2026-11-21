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
  const b = await gql('{ articles(first: 20) { nodes { title handle publishedAt blog { title } md: metafield(namespace:"seo", key:"description") { value } bodyHtml tags } } }');
  console.log("=== ARTICULOS ===");
  (b.articles ? b.articles.nodes : []).forEach((a) => {
    const txt = (a.bodyHtml || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const md = (a.md && a.md.value) ? a.md.value.length : 0;
    console.log("  " + (a.publishedAt ? "ON " : "OFF") + " " + a.title.padEnd(38) + " texto=" + String(txt.length).padStart(5) + " meta_desc=" + String(md).padStart(4) + (md < 70 ? "  <-- CORTA" : "") + (txt.length < 500 ? "  <-- CORTO" : ""));
  });
  const p = await gql('{ products(first: 60, query: "status:active") { nodes { title reviewsRating: metafield(namespace:"reviews", key:"rating") { value } } } }');
  const conR = p.products.nodes.filter((x) => x.reviewsRating).length;
  console.log("\n  productos con rating (reviews.rating): " + conR + " en esta pagina");
})();
