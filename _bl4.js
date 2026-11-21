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
  const b = await gql("{ articles(first: 20) { nodes { title handle blog { handle title } summary } } }");
  console.log("=== ARTICULOS: urls reales ===");
  (b.articles ? b.articles.nodes : []).forEach((a) => {
    const txt = (a.summary || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    console.log("  " + a.title.padEnd(42) + " " + "/blogs/" + (a.blog ? a.blog.handle : "?") + "/" + a.handle);
    console.log("        texto=" + txt.length + " | resumen(1er parrafo)=" + (a.summary || "").length + " chars");
  });
})();
