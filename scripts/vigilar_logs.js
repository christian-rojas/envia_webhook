/**
 * Vigilante de logs de Vercel: sigue los mensajes de Instagram (y WhatsApp) en
 * vivo y muestra si el bot responde.
 *
 *   node scripts/vigilar_logs.js [minutos]
 */
const fs = require("fs");
const path = require("path");

const AUTH = path.join(process.env.HOME, "Library/Application Support/com.vercel.cli/auth.json");
const auth = JSON.parse(fs.readFileSync(AUTH, "utf8"));
const TOKEN = auth.token;
const PROJECT = "prj_FTzOPoFEiQfIG1W0mRSLz8HxLzRD";
const TEAM = "team_0LLqjAElLXKka7RRuB6QJpJj";
const MINUTOS = Number(process.argv[2] || 10);

const seen = new Set();

async function page(p, startDate, endDate) {
  const u = new URL("https://vercel.com/api/logs/request-logs");
  u.searchParams.set("projectId", PROJECT);
  u.searchParams.set("ownerId", TEAM);
  u.searchParams.set("page", String(p));
  u.searchParams.set("startDate", String(startDate));
  u.searchParams.set("endDate", String(endDate));
  u.searchParams.set("teamId", TEAM);
  const r = await fetch(u, { headers: { Authorization: `Bearer ${TOKEN}` } });
  const d = await r.json().catch(() => ({}));
  return d.rows || [];
}

(async () => {
  console.log(`\x1b[1mVigilando ${MINUTOS} minutos los mensajes de Instagram/WhatsApp\x1b[0m`);
  console.log("Escribile un DM a @mondano.cl desde Instagram y te lo muestro acá.\n");

  const fin = Date.now();
  const inicio = fin - 5 * 60 * 1000;
  let ultimo = 0;

  for (let t = 0; t < MINUTOS * 12; t++) {
    const rows = await page(0, inicio, fin);
    const nuevos = rows
      .filter((r) => /webhook\/(instagram|meta)/.test(r.requestPath || ""))
      .filter((r) => !seen.has(r.requestId))
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    for (const r of nuevos) {
      seen.add(r.requestId);
      const canal = r.requestPath.includes("instagram") ? "Instagram" : "WhatsApp";
      console.log(`\n\x1b[36m── ${new Date(r.timestamp).toLocaleTimeString("es-CL")} · ${canal} · http ${r.responseStatusCode}\x1b[0m`);
      for (const m of r.logs || []) {
        const t = String(m.message);
        if (/\[instagram\] mensaje:|\[meta\] mensaje de|IA ok=|respuesta enviada|respuesta enviada a|sin respuesta|error/i.test(t)) {
          const color = m.level === "error" ? "\x1b[31m" : m.level === "warn" ? "\x1b[33m" : "\x1b[0m";
          console.log(`   ${color}[${m.level}] ${t.slice(0, 220)}\x1b[0m`);
        }
      }
      ultimo = Date.now();
    }
    if (t % 12 === 0) {
      const faltan = Math.round((fin + MINUTOS * 60000 - Date.now()) / 60000);
      console.log(`\x1b[90m   ...esperando (quedan ~${Math.max(0, faltan)} min)\x1b[0m`);
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  console.log(`\nTerminó la vigilancia. ${seen.size} mensajes vistos.`);
})();
