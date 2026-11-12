# Puesta en marcha (Meta + Shopify + Vercel)

Checklist para dejar el bot funcionando desde cero, o para **reponerlo** si
se rompe algo. Todas las trampas están en [gotchas.md](gotchas.md).

---

## 0. Lo primero: leer el estado real

```sh
curl -s https://envia-webhook.vercel.app/health | jq
```

```sh
node scripts/ver_webhooks.js          # callback URLs por caso de uso
node scripts/setup_meta_integration.js # scopes del token de Meta
node scripts/setup_whatsapp.js         # (solo si hay que tocar WhatsApp)
```

---

## 1. Shopify (lectura de pedidos, notas, catálogo)

La app de Shopify `mondano_bot_orders` (client_id `14f21e249896cab76101c6890ecc1e47`).

Scopes en la versión de la app:

```
read_orders,read_all_orders,read_content,read_products
```

> `read_content` → las **páginas** (política de cambios, guía de tallas).
> `read_products` → las **descripciones** (tablas de medidas, que son imágenes).

Aprobarlos en la tienda:

```
https://admin.shopify.com/store/mondano-chile/oauth/install?client_id=14f21e249896cab76101c6890ecc1e47&optional_scopes=read_content,read_products
```

El token se renueva solo (client_credentials), no hay que hacer nada más.

---

## 2. Meta — token

La app de Meta `mondano_mensajes` (app_id `2595593107610545`, en la
organización MONDANO `111337664819723`).

### Opción A — System User (permanente, requiere otra persona a veces)

Business Settings → Usuarios → Usuarios del sistema → `mondano_mensajes System User`
→ **Generar token** con:

```
instagram_manage_messages, pages_messaging, pages_manage_metadata,
whatsapp_business_messaging, whatsapp_business_management, business_management
```

> Si aparece *"Otra persona debe aprobar la solicitud"*, Meta exige un segundo
> administrador (regla de dos personas). Ver "Opción B" o invitar a alguien con
> Control total (Business Settings → Usuarios → Personas → Invitar, con acceso
> temporal de 3 a 75 días).

⚠️ **Generar un token nuevo invalida el anterior.** Si se regenera, hay que
volver a subirlo a Vercel.

### Opción B — OAuth de la app (sin aprobación de dos personas)

```sh
node scripts/oauth_meta.js
```

- Requisito previo (una vez): Dev Dashboard → `mondano_mensajes` → **Facebook
  Login** → *Valid OAuth Redirect URIs* → `http://localhost:8766/callback`
- Se abre el navegador, se acepta, y el script entrega el token (60 días)
  en `docs/meta-oauth-token.json` y lo imprime.

Subir a Vercel:

```sh
vercel env add META_ACCESS_TOKEN production --value "<token>" \
  --project envia-webhook --sensitive --force --yes
vercel deploy --prod --yes
```

---

## 3. Meta — webhooks

Cada caso de uso tiene su propia callback URL:

```
object: instagram                 → https://envia-webhook.vercel.app/webhook/instagram
object: whatsapp_business_account → https://envia-webhook.vercel.app/webhook/meta
```

**Ver token** (verify token) en ambas: el `META_VERIFY_TOKEN` del `.env`.

```sh
node scripts/ver_webhooks.js
```

Si hay que (re)configurar el de WhatsApp, el MCP de Meta lo hace (pide
confirmación):

```js
whatsapp_biz_configure_webhooks({
  business_id: "111337664819723",
  callback_url: "https://envia-webhook.vercel.app/webhook/meta",
  verify_token: "<META_VERIFY_TOKEN>",
  fields: ["messages", "message_statuses", "account_update",
           "message_template_status_update", "phone_number_name_update"],
  confirm: true
})
```

---

## 4. Meta — app publicada y pago (solo para WhatsApp)

Checklist oficial (leído con el MCP de Meta):

```
[DONE] Perfil de negocio
[DONE] App conectada
[DONE] Número +56 9 2977 3980 registrado
[DONE] Webhooks
[DONE] Suscripción de la cuenta
[DONE] App publicada            ← https://developers.facebook.com/apps/2595593107610545/go_live/
[TODO] Método de pago         ← https://business.facebook.com/billing_hub/accounts/details/?business_id=111337664819723&asset_id=554629607724135&wizard_name=ADD_PM
[INFO] Token del System User
```

Para ver el estado real:

```sh
node scripts/diagnostico_whatsapp.js
```

---

## 5. Variables de entorno

En `.env` local y en Vercel (producción):

```
META_APP_ID=2595593107610545
META_APP_SECRET=...                     # firma HMAC del webhook
META_ACCESS_TOKEN=...                   # Graph API de Meta (Instagram + conversaciones)
META_WHATSAPP_TOKEN=...                 # envío por WhatsApp (opcional)
META_INSTAGRAM_ACCOUNT_ID=17841408417156397
META_VERIFY_TOKEN=...
META_GRAPH_VERSION=v27.0
SHOPIFY_SHOP=mondano-chile
SHOPIFY_CLIENT_ID=14f21e249896cab76101c6890ecc1e47
SHOPIFY_CLIENT_SECRET=...               # client_credentials, se renueva solo
META_WABA_ID=554629607724135
META_PHONE_NUMBER_ID=530005643535929
XAI_API_KEY=...
XAI_MODEL=grok-4.7
ENVIA_API_KEY=...
SUPABASE_URL=...
SUPABASE_ANON_KEY=...
```

### Feature toggles

```
FEATURE_WHATSAPP=0        # apagar WhatsApp sin tocar código
FEATURE_INSTAGRAM=1
FEATURE_MANUFACTURING=1
FEATURE_PRODUCT_INFO=1
FEATURE_CONVERSATION_HISTORY=1
FEATURE_STORE_POLICIES=1
```

Se cambian en Vercel (sin deploy) o en el `.env`.

---

## 6. Desplegar

```sh
vercel deploy --prod --yes
curl -s https://envia-webhook.vercel.app/health | jq
```

---

## 7. Probar

```sh
# simulando un DM de Instagram
python3 - <<'EOF'
import hmac, hashlib, json, urllib.request, time
env={}
for line in open('.env'):
    line=line.strip()
    if line and not line.startswith('#') and '=' in line:
        k,v=line.split('=',1); env[k]=v.strip().strip('"')
IG="17841408417156397"
payload={"object":"instagram","entry":[{"id":IG,"time":int(time.time()),
 "messaging":[{"sender":{"id":"2746101999184243"},"recipient":{"id":IG},
 "timestamp":int(time.time()*1000),
 "message":{"mid":"test1","text":"cuanto cuesta el poleron azul?"}}]}]}
raw=json.dumps(payload).encode()
sig='sha256='+hmac.new(env['META_APP_SECRET'].encode(),raw,hashlib.sha256).hexdigest()
req=urllib.request.Request('https://envia-webhook.vercel.app/webhook/instagram', data=raw, method='POST',
 headers={'Content-Type':'application/json','X-Hub-Signature-256':sig})
print(urllib.request.urlopen(req, timeout=90).status)
EOF
```

> El envío puede fallar con `(#10) ... fuera del período permitido`: es la
> ventana de 24 h de Instagram. Con un cliente real que escribió hace poco,
> funciona.

Diagnóstico rápido del prompt y del contexto:

```sh
curl -s "https://envia-webhook.vercel.app/diag/prompt" | jq
curl -s "https://envia-webhook.vercel.app/diag/ctx?text=cuanto%20cuesta%20el%20poleron%20azul" | jq
```

---

## 8. Tests

```sh
node scripts/test_resolucion.js        # 54 tests, sin red (salvo la parte [RED])
node scripts/test_conversacion.js       # flujo del handler de Instagram
node scripts/buscar_notas_manufactura.js  # dónde están las notas de taller
```
