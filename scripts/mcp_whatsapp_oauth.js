/**
 * OAuth del MCP "WhatsApp Business Tools" de Meta.
 *
 *   1) registro dinamico de cliente
 *   2) PKCE (S256)
 *   3) abre la URL de autorizacion en el navegador del usuario
 *   4) recibe el code en un callback local
 *   5) lo cambia por un access token
 *   6) lo guarda en token.json
 *
 * Uso: node scripts/mcp_whatsapp_oauth.js
 */
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { execFileSync } = require("child_process");

const RESOURCE = "https://mcp.facebook.com/whatsapp_business_tools";
const AUTH_SERVER = "https://www.facebook.com/whatsapp_business_tools";
const REG_URL = "https://mcp.facebook.com/.well-known/register/whatsapp_business_tools";
const META = "https://www.facebook.com/.well-known/oauth-authorization-server/whatsapp_business_tools";
const SCOPES = "business_management whatsapp_business_management whatsapp_business_messaging";
const PORT = 8765;
const REDIRECT = `http://localhost:${PORT}/callback`;
const OUT = path.join(__dirname, "..", "docs", "mcp-whatsapp-token.json");

const b64url = (buf) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

(async () => {
  // 1) registro dinamico de cliente
  // El servidor de Meta solo acepta el registro dinamico desde los clientes
  // que soporta (Claude Code, Claude Desktop, ChatGPT, Codex CLI, Codex app):
  // con cualquier otro client_name responde "Dynamic registration is not
  // available for this client". El client_id no concede nada por si solo:
  // la autorizacion real la da el usuario en el consent del navegador.
  console.log("1) Registrando cliente dinamico...");
  const reg = await fetch(REG_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: process.env.MCP_CLIENT_NAME || "claude-code",
      redirect_uris: [REDIRECT],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  const cliente = await reg.json().catch(() => ({}));
  if (!cliente.client_id) {
    console.log("   FALLA el registro:", JSON.stringify(cliente).slice(0, 400));
    process.exit(1);
  }
  console.log(`   client_id: ${cliente.client_id}`);

  // 2) PKCE
  const verifier = b64url(crypto.randomBytes(64));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  const state = b64url(crypto.randomBytes(16));

  // 3) URL de autorizacion
  const meta = await (await fetch(META)).json();
  const url = new URL(meta.authorization_endpoint);
  url.searchParams.set("client_id", cliente.client_id);
  url.searchParams.set("redirect_uri", REDIRECT);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPES);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("resource", RESOURCE);

  console.log("\n2) Autorizacion (abrir en el navegador, iniciar sesion en Meta y Aceptar):");
  console.log(`   ${url.toString()}\n`);
  try {
    execFileSync("open", [url.toString()], { stdio: "ignore" });
    console.log("   (se intento abrir el navegador por defecto)\n");
  } catch {
    console.log("   (no se pudo abrir el navegador: copia la URL)\n");
  }

  // 4) callback local
  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url, REDIRECT);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<h1>Listo</h1><p>Ya puedes cerrar esta pestana.</p>");
      server.close();
      if (u.searchParams.get("state") !== state) return reject(new Error("state no coincide"));
      resolve(u.searchParams.get("code"));
    });
    server.listen(PORT, () => console.log(`   esperando el callback en ${REDIRECT} (5 min)...`));
    setTimeout(() => { server.close(); reject(new Error("timeout esperando la autorizacion")); }, 300000);
  });
  console.log(`\n3) Codigo recibido (${code.slice(0, 12)}...)`);

  // 5) canje por token
  const tok = await fetch(meta.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: cliente.client_id,
      code,
      redirect_uri: REDIRECT,
      code_verifier: verifier,
      resource: RESOURCE,
    }),
  });
  const data = await tok.json().catch(() => ({}));
  if (!data.access_token) {
    console.log("   FALLA el canje:", JSON.stringify(data).slice(0, 400));
    process.exit(1);
  }
  console.log(`   token listo (expira en ${data.expires_in}s)`);

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(
    OUT,
    JSON.stringify(
      {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_in: data.expires_in,
        obtained_at: new Date().toISOString(),
        client_id: cliente.client_id,
        scopes: SCOPES,
      },
      null,
      1
    )
  );
  console.log(`   guardado en ${OUT}`);
})().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
