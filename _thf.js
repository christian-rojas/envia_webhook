require("dotenv").config();
(async () => {
  const SHOP = process.env.SHOPIFY_SHOP;
  const t = await (await fetch("https://" + SHOP + ".myshopify.com/admin/oauth/access_token", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_id: process.env.SHOPIFY_ADMIN_CLIENT_ID, client_secret: process.env.SHOPIFY_ADMIN_CLIENT_SECRET, grant_type: "client_credentials" }),
  })).json();
  const H = { "X-Shopify-Access-Token": t.access_token, "Content-Type": "application/json" };
  const A = "https://" + SHOP + ".myshopify.com/admin/api/2026-01";
  for (const id of [187221082335, 186870825183]) {
    const r = await (await fetch(A + "/themes/" + id + "/files.json", { headers: H })).json();
    const todos = (r.files || []);
    console.log("    archivos devueltos: " + todos.length + " | con visor: " + todos.filter(x => /visor/i.test(x.filename)).map(x => x.filename).join(", "));
    const f = todos.find((x) => x.filename === "sections/visor-tallas.liquid");
    console.log("  theme " + id + ": " + (f ? "archivo presente, " + f.size + " bytes" : "NO ENCONTRADO"));
    if (f) {
      const c = await (await fetch(A + "/themes/" + id + "/files.json", { headers: H })).json();
      const ff = (c.files || []).find((x) => x.filename === "sections/visor-tallas.liquid");
      console.log("     tiene scrollToSizePicker: " + JSON.stringify(ff.body || "").includes("scrollToSizePicker"));
    }
  }
})();
