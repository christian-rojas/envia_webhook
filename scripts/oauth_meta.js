#!/usr/bin/env node
/**
 * OAuth de la app de Meta (mondano_mensajes).
 *
 * Genera un token de USUARIO con los scopes que necesita el bot, sin
 * pasar por la "aprobacion de dos personas" de los System Users: el
 * administrador de la app autoriza su propia app en el navegador y listo.
 *
 *   node scripts/oauth_meta.js            # abre el navegador y espera el callback
 *   node scripts/oauth_meta.js --url-only # solo imprime la URL
 *
 * Requisitos (una vez, en el Dev Dashboard):
 *   app mondano_mensajes -> Facebook Login -> Valid OAuth Redirect URIs
 *   -> agregar  http://localhost:8766/callback  -> Save
 *
 * El token se guarda en docs/meta-oauth-token.json (gitignored) y se
 * imprime para poder pegarlo en Vercel.
 */

const fs = require("fs");
const http = require("http");
const path = require("path");
const { execFileSync } = require("child_process");

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v27.0";
const PORT = Number(process.env.META_OAUTH_PORT || 8766);
const REDIRECT = process.env.META_OAUTH_REDIRECT || `http://localhost:${PORT}/callback`;
const OUT = path.join(__dirname, "..", "docs", "meta-oauth-token.json");

const SCOPES = [
  "instagram_manage_messages",
  "pages_messaging",
  "pages_manage_metadata",
  "business_management",
  "whatsapp_business_messaging",
  "whatsapp_business_management",
].join(",");

function loadEnv() {
  const file = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const i = t.indexOf("=");
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[k]) process.env[k] = v;
  }
}

function randomState() {
  return require("crypto").randomBytes(16).toString("hex");
}

async function main() {
  loadEnv();

  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;

  if (!appId || !appSecret) {
    console.error("Faltan META_APP_ID o META_APP_SECRET en .env");
    process.exit(1);
  }

  const state = randomState();
  const url = new URL(`https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`);
  url.searchParams.set("client_id", appId);
  url.searchParams.set("redirect_uri", REDIRECT);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPES);
  url.searchParams.set("state", state);

  console.log("\n\x1b[1m1) Autoriza la app en el navegador\x1b[0m");
  console.log(`   ${url.toString()}\n`);

  if (process.argv.includes("--url-only")) {
    console.log("   (--url-only: no se espera el callback)");
    return;
  }

  try {
    execFileSync("open", [url.toString()], { stdio: "ignore" });
    console.log("   (se intentó abrir el navegador por defecto)\n");
  } catch {
    console.log("   (copia la URL si no se abrió)\n");
  }

  console.log(`2) Esperando el callback en ${REDIRECT} (10 min)...`);
  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url, REDIRECT);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        "<h1>Listo</h1><p>Ya puedes cerrar esta pestaña.</p>" +
          "<p>El token se guardo en docs/meta-oauth-token.json</p>"
      );
      server.close();
      if (u.searchParams.get("state") !== state) {
        return reject(new Error("el state no coincide"));
      }
      const err = u.searchParams.get("error_description");
      if (err) return reject(new Error(err));
      resolve(u.searchParams.get("code"));
    });
    server.listen(PORT, () => {});
    setTimeout(() => {
      server.close();
      reject(new Error("timeout esperando la autorización"));
    }, 600000);
  });

  console.log(`\n3) Código recibido (${code.slice(0, 10)}...)`);

  // Canje corto
  const corto = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token?` +
      new URLSearchParams({
        client_id: appId,
        client_secret: appSecret,
        redirect_uri: REDIRECT,
        code,
      })
  );
  let data = await corto.json().catch(() => ({}));
  if (!data.access_token) {
    console.error("   FALLA el canje:", JSON.stringify(data).slice(0, 400));
    process.exit(1);
  }

  // Canje por token de larga duracion (60 dias)
  const largo = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token?` +
      new URLSearchParams({
        grant_type: "fb_exchange_token",
        client_id: appId,
        client_secret: appSecret,
        fb_exchange_token: data.access_token,
      })
  );
  const final = await largo.json().catch(() => ({}));
  const token = final.access_token || data.access_token;
  const expiraEn = final.expires_in || data.expires_in || 0;

  console.log(`   token listo (expira en ${Math.round(expiraEn / 86400)} días)`);

  // Comprobacion
  const perms = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/me/permissions?` +
      new URLSearchParams({ access_token: token })
  );
  const p = await perms.json().catch(() => ({}));
  const granted = (p.data || []).map((x) => x.permission);
  console.log(`   scopes: ${granted.join(", ") || "(ninguno)"}`);
  const faltan = SCOPES.split(",").filter((s) => !granted.includes(s));
  if (faltan.length) {
    console.log(`   \x1b[33m! Faltan: ${faltan.join(", ")}\x1b[0m`);
    console.log("     (puede que la app no los declare todavia en su version)");
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(
    OUT,
    JSON.stringify(
      {
        access_token: token,
        expires_in: expiraEn,
        obtained_at: new Date().toISOString(),
        client_id: appId,
        scopes: SCOPES,
      },
      null,
      1
    )
  );

  console.log(`\n\x1b[1mTOKEN PARA VERCEL\x1b[0m`);
  console.log(`   ${token}\n`);
  console.log(`   guardado en ${OUT}`);
  console.log(
    "\n   Para subirlo a Vercel:\n" +
      `   vercel env add META_ACCESS_TOKEN production --value "<token>" \\\n` +
      "     --project envia-webhook --sensitive --force --yes\n" +
      "   vercel deploy --prod --yes"
  );
}

main().catch((error) => {
  console.error("ERROR:", error.message);
  process.exit(1);
});
