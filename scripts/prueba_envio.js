require("dotenv").config();
(async () => {
  const t = process.env.META_ACCESS_TOKEN;
  const r = await fetch("https://graph.facebook.com/v27.0/17841408417156397/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recipient: { id: "2746101999184243" },
      message: { text: "prueba de cuota" },
      access_token: t,
    }),
  });
  const d = await r.json();
  console.log(
    new Date().toISOString(),
    "->",
    d.error ? "ERROR " + d.error.message : "OK " + JSON.stringify(d).slice(0, 80),
    "| usage:",
    r.headers.get("x-app-usage")
  );
})();
