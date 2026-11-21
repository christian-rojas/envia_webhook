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
  const j = await gql("{ collections(first: 30) { nodes { id title handle ruleSet { appliedDisjunctively rules { column relation conditionObject { ... on CollectionRuleTextCondition { value } } } } products(first: 60) { nodes { title status } } } } }");
  j.collections.nodes.filter((c) => /dia-de-la-madre|chiporros|poleras|mike/i.test(c.handle)).forEach((c) => {
    console.log("\n  " + c.title + " (" + c.handle + ") - " + (c.ruleSet ? "INTELIGENTE: " + (c.ruleSet.rules || []).map((r) => r.column + " " + r.relation + " " + JSON.stringify(r.conditionObject)).join(" / ") : "manual"));
    c.products.nodes.filter((p) => p.status === "ACTIVE").forEach((p) => console.log("      - " + p.title));
  });
})();
