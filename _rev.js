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
  const j = await gql('{ products(first: 60, query: "status:active") { nodes { handle title rating: metafield(namespace:"reviews", key:"rating") { value } count: metafield(namespace:"reviews", key:"rating_count") { value } } } }');
  const conRes = j.products.nodes.filter((p) => p.count);
  console.log("  productos con resenas (muestra):");
  conRes.slice(0, 6).forEach((p) => console.log("    " + p.handle + " -> " + p.count.value + " resenas (" + p.title + ")"));
})();
