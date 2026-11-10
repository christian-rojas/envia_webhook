/**
 * Cliente MCP (Streamable HTTP) para el servidor "WhatsApp Business Tools" de Meta.
 *
 * Uso como libreria:
 *   const { call, listTools } = require("./mcp_client.js");
 *   const tools = await listTools();
 *   const r = await call("whatsapp_biz_businesses", {});
 */
const fs = require("fs");
const path = require("path");

const ENDPOINT = "https://mcp.facebook.com/whatsapp_business_tools";
const TOKEN_FILE = path.join(__dirname, "..", "docs", "mcp-whatsapp-token.json");

let sessionId = null;

function token() {
  const t = JSON.parse(fs.readFileSync(TOKEN_FILE, "utf8"));
  if (t.expires_in && t.obtained_at) {
    const exp = new Date(t.obtained_at).getTime() + (t.expires_in - 120) * 1000;
    if (exp < Date.now()) throw new Error("el token del MCP expiro: re-ejecuta scripts/mcp_whatsapp_oauth.js");
  }
  return t.access_token;
}

/** Parsea la respuesta: puede ser JSON plano o SSE (text/event-stream). */
function parseBody(text) {
  const t = (text || "").trim();
  if (!t) return null;
  if (t.startsWith("{")) return JSON.parse(t);
  const lineas = t
    .split("\n")
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice(5).trim())
    .filter(Boolean);
  if (!lineas.length) return null;
  return JSON.parse(lineas[lineas.length - 1]);
}

async function rpc(method, params, { initialize = false } = {}) {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    Authorization: `Bearer ${token()}`,
  };
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });

  const sid = res.headers.get("mcp-session-id");
  if (sid) sessionId = sid;

  const text = await res.text();
  if (!res.ok && res.status !== 200) {
    throw new Error(`MCP ${method} -> ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = parseBody(text);
  if (data && data.error) {
    throw new Error(`MCP ${method}: ${JSON.stringify(data.error).slice(0, 400)}`);
  }
  return data && data.result;
}

async function init() {
  const r = await rpc("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "opencode", version: "1.0.0" },
  });
  // aviso de inicializado (notificacion, sin respuesta)
  await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${token()}`,
      ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  });
  return r;
}

async function listTools() {
  if (!sessionId) await init();
  const r = await rpc("tools/list", {});
  return (r && r.tools) || [];
}

async function call(name, args = {}) {
  if (!sessionId) await init();
  const r = await rpc("tools/call", { name, arguments: args });
  const contenido = (r && r.content) || [];
  const texto = contenido
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");
  return { isError: !!(r && r.isError), texto, raw: r };
}

module.exports = { call, listTools, init, ENDPOINT, TOKEN_FILE };

// CLI: node scripts/mcp_client.js <tool_name> [json_args]
if (require.main === module) {
  const [, , tool, argsJson] = process.argv;
  (async () => {
    try {
      if (!tool || tool === "tools") {
        const tools = await listTools();
        console.log(`${tools.length} tools:`);
        for (const t of tools) {
          console.log(`\n  ${t.name}`);
          if (t.description) console.log(`     ${String(t.description).replace(/\s+/g, " ").slice(0, 220)}`);
          if (t.inputSchema?.properties) {
            console.log(`     params: ${Object.keys(t.inputSchema.properties).join(", ")}`);
          }
        }
      } else {
        const r = await call(tool, argsJson ? JSON.parse(argsJson) : {});
        console.log(r.isError ? `ERROR: ${r.texto}` : r.texto);
      }
    } catch (e) {
      console.error("ERROR:", e.message);
      process.exit(1);
    }
  })();
}
