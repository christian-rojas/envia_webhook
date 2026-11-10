/**
 * Vigilante de logs de Vercel: sigue los mensajes de Instagram (y WhatsApp) en
 * vivo y muestra si el bot responde.
 *
 *   node scripts/vigilar_logs.js [minutos]
 */
const fs = require("fs");
const path = require("path");

const AUTH = path.join(process.env.HOME, "Library/Application Support/com.vercel.cli/auth.json");
const PROJECT = "prj_FTzOPoFEiQfIG1W0mRSLz8HxLzRD";
const TEAM = "team_0LLqjAElLXKka7RRuB6QJpJj";
const MINUTOS = Number(process.argv[2] || 10);

const seen = new Set();

/**
 * El token del CLI caduca cada ~24 h (expira: 1794260633). Si se usa el que
 * quedo cacheado, la API responde 403 y el vigilante se queda mudo sin avisar.
 * Se relee en cada vuelta.
 */
function tokenActual() {
  const auth = JSON.parse(fs.readFileSync(AUTH, "utf8"));
  return auth.token;
}

async function page(p, startDate, endDate) {
  const u = new URL("https://vercel.com/api/logs/request-logs");
  u.searchParams.set("projectId", PROJECT);
  u.searchParams.set("ownerId", TEAM);
  u.searchParams.set("page", String(p));
  u.searchParams.set("startDate", String(startDate));
  u.searchParams.set("endDate", String(endDate));
  u.searchParams.set("teamId", TEAM);
  const r = await fetch(u, { headers: { Authorization: `Bearer ${tokenActual()}` } });
  if (!r.ok) {
    const err = new Error(`la API de logs respondio ${r.status}: ${(await r.text()).slice(0, 120)}`);
    err.status = r.status;
    throw err;
  }
  const d = await r.json().catch(() => ({}));
  return d.rows || [];
}

(async () => {
  console.log(`\x1b[1mVigilando ${MINUTOS} minutos los mensajes de Instagram/WhatsApp\x1b[0m`);
  console.log("Escribile un DM a @mondano.cl desde Instagram y te lo muestro acá.\n");

  // La ventana se recalcula en cada vuelta: si el "fin" queda fijo al arrancar,
  // los mensajes que lleguen despues nunca se ven.
  const arranque = Date.now();

  for (let t = 0; t < MINUTOS * 12; t++) {
    let rows = [];
    try {
      rows = await page(0, arranque - 5 * 60 * 1000, Date.now());
    } catch (e) {
      console.log(`\x1b[31m${e.message}\x1b[0m`);
      console.log(`\x1b[90m   (si es 403, el token del CLI caduco: corre \`vercel whoami\` para refrescarlo)\x1b[0m`);
      await new Promise((r) => setTimeout(r, 5000));
      continue;
    }

    const nuevos = rows
      .filter((r) => /webhook\/(instagram|meta)/.test(r.requestPath || ""))
      .filter((r) => !seen.has(r.requestId))
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    for (const r of nuevos) {
      seen.add(r.requestId);
      const canal = r.requestPath.includes("instagram") ? "Instagram" : "WhatsApp";
      console.log(`\n\x1b[36m── ${new Date(r.timestamp).toLocaleTimeString("es-CL")} · ${canal} · http ${r.responseStatusCode}\x1b[0m`);
      for (const m of r.logs || []) {
        const t2 = String(m.message);
        if (/\[instagram\] mensaje:|\[meta\] mensaje de|IA ok=|respuesta enviada|sin respuesta|error/i.test(t2)) {
          const color = m.level === "error" ? "\x1b[31m" : m.level === "warn" ? "\x1b[33m" : "\x1b[0m";
          console.log(`   ${color}[${m.level}] ${t2.slice(0, 220)}\x1b[0m`);
        }
      }
    }
    if (t % 12 === 0) {
      const faltan = Math.max(0, Math.round((arranque + MINUTOS * 60000 - Date.now()) / 60000));
      console.log(`\x1b[90m   ...esperando (quedan ~${faltan} min)\x1b[0m`);
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  console.log(`\nTerminó la vigilancia. ${seen.size} mensajes vistos.`);
})();

