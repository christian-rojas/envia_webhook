# Mondano Bot — Envíos + Instagram/WhatsApp

Webhook en Vercel que recibe mensajes de Instagram (y prepara WhatsApp),
consulta el estado del envío en Supabase + Envia y responde con x.ai.

## 📚 Documentación

| Documento | Para qué |
|---|---|
| **[docs/setup-meta.md](docs/setup-meta.md)** | **Puesta en marcha / reponer el bot desde cero.** Tokens, scopes, webhooks, variables, deploy y pruebas. |
| **[docs/gotchas.md](docs/gotchas.md)** | **Las trampas de las APIs.** Lo que costó tiempo descubrir: límites, campos que no existen, errores que mienten. **Leer antes de tocar algo.** |
| **[docs/flujo-bot.md](docs/flujo-bot.md)** | **Cómo responde el bot** (las 2 respuestas y por qué no se repite). |
| [docs/estado-whatsapp.md](docs/estado-whatsapp.md) | Estado real de WhatsApp según las herramientas MCP de Meta |
| [docs/app-review-whatsapp.md](docs/app-review-whatsapp.md) | App review de WhatsApp |

### Estado actual

```
Instagram   ✅ funcionando. El bot hace SOLO dos cosas: pedir el número de
                          pedido y decir dónde está. Una vez cada una, y se
                          calla si hay un asesor humano hablando.
WhatsApp    ⏸ en pausa (FEATURE_WHATSAPP=0). App publicada y número
                          registrado; falta método de pago y token.
```

> Ver [docs/flujo-bot.md](docs/flujo-bot.md). Con `FEATURE_BOT_AUTOMATICO=0`
> vuelve el bot con IA (responde de todo, pero puede repetirse).

Los feature toggles permiten apagar cada parte sin tocar código:

```sh
FEATURE_WHATSAPP=0   FEATURE_INSTAGRAM=1   FEATURE_MANUFACTURING=1
FEATURE_PRODUCT_INFO=1   FEATURE_CONVERSATION_HISTORY=1   FEATURE_STORE_POLICIES=1
FEATURE_BOT_AUTOMATICO=1    # flujo determinista (sin IA) en los DMs
FEATURE_REPETIR_ESTADO=0   # 1 = repetir el estado si el cliente insiste
```

## Rutas

| Ruta | Método | Qué hace |
|---|---|---|
| `/webhook/instagram` | `GET` | Handshake de Meta (`hub.challenge`) |
| `/webhook/instagram` | `POST` | Recibe DMs de Instagram, responde con IA |
| `/webhook/meta` | `GET`/`POST` | Webhook genérico de Meta (WhatsApp) |
| `/webhook/shopify` | `POST` | Webhook de Shopify (SMS de confirmación vía Twilio) |
| `/tracking/:order_id` | `GET` | Estado de un pedido (`MON3007`) |
| `/envia/:tracking_id` | `GET` | Estado crudo de Envia (`712913101224`) |
| `/bandeja` | `GET` | Responde lo que quedó sin contestar en la bandeja |
| `/health` | `GET` | Estado del bot y de los feature toggles |
| `/diag/prompt` | `GET` | Prompt activo (para verificar el deploy) |
| `/diag/ctx` | `GET` | Contexto que recibe la IA + su respuesta |
| `/diag/db` | `GET` | Tiempos de la API de Meta |

## Configuración

1. Copiar `.env.example` a `.env` y completar las credenciales.
2. Publicar las variables en Vercel:

```sh
vercel env add META_ACCESS_TOKEN production --value "<token>" \
  --project envia-webhook --sensitive --force --yes
vercel deploy --prod --yes
```

> **Importante:** cambiar `META_ACCESS_TOKEN` en `.env` no cambia nada en
> producción. Hay que volver a publicarlo en Vercel **y** redesplegar.
> Un token viejo produce `(#100) ... subcode 2534014` al enviar.

3. Suscribir los webhooks de Meta (ver más abajo).

## Suscripción de webhooks (Instagram)

La parte que más cuesta encontrar. Hay **dos** suscripciones y ambas hacen falta:

```sh
node scripts/setup_meta_integration.js 17841408417156397
```

**Nivel de app** — sin esto Meta **no entrega ni un solo evento**, aunque la
URL del webhook esté guardada y el panel muestre todo en verde:

```sh
POST /{app-id}/subscriptions
  ?object=instagram
  &callback_url=https://envia-webhook.vercel.app/webhook/instagram
  &verify_token=<META_VERIFY_TOKEN>
  &fields=messages,messaging_postbacks,messaging_seen,message_reactions,messaging_referral
```

Una suscripción **sin `fields`** no entrega nada. Es el error clásico: todo
parece configurado y nunca llega un webhook.

**Nivel de cuenta**:

```sh
POST /{ig-user-id}/subscribed_apps?subscribed_fields=messages,...
```

### Cómo saber si funciona

Meta responde al guardar la suscripción con un `GET` de verificación. Si en los
logs de Vercel no aparece un `GET /webhook/instagram` → `[instagram] webhook
verificado` al guardar, la suscripción no quedó activa.

## Cómo identifica el bot el pedido

El caso real es que el cliente escribe `hola` o `¿qué pasó con mi pedido?` **sin**
dar el número de pedido. El bot lo resuelve en cascada:

| # | Vía | Nota |
|---|---|---|
| 1 | Número de pedido en el texto | `MON3007`, `mon3007`, `pedido 3007`, `3007` |
| 2 | Memoria de la conversación | Lo que el cliente dijo antes (30 min) |
| 3 | Se le pide el número de pedido | Formato `MON3007`, **sin guion** |

**No se pide el teléfono del cliente.** En Instagram el id del usuario no es un
teléfono, así que el número de pedido es la única vía. Pedir el teléfono
complicaría la conversación sin aportar nada.

En **WhatsApp** el `from` del webhook *es* el teléfono del cliente, así que ahí
el bot sabe de quién se trata sin preguntar nada. Eso es identidad del canal,
no un dato que se le recabe.

El teléfono no está en Supabase: vive en Envia (`destination.phone`). Por eso la
búsqueda por teléfono (solo para WhatsApp) consulta los envíos recientes y
compara el teléfono del destinatario de cada uno.

Si el teléfono coincide con **varios** envíos, el bot responde por el más
reciente y pide confirmación.

### Memoria de conversación

`conversation.js` guarda, por cliente, el último número de pedido que nos dio,
para que los mensajes siguientes (`¿y cuándo llega?`) no repitan el dato.

Implementación actual: memoria del proceso (`Map`) con TTL de 30 min. En un cold
start de Vercel se pierde, por eso el bot **siempre** vuelve a pedir el dato si
no lo tiene. Para hacerlo durable, reemplazar el `Map` por una tabla de
Supabase — la interfaz `get / remember / forget` no cambia (ver el SQL sugerido
en el propio archivo).

## WhatsApp (Fase 2)

Ruta: `POST /webhook/meta` (la misma firma HMAC que Instagram).

### Cómo identifica el bot el pedido

En WhatsApp el `from` del webhook **es el teléfono del cliente**, así que el
bot sabe de quién se trata sin preguntarle nada. Cascada:

| # | Vía | Nota |
|---|---|---|
| 1 | Número de pedido en el texto | `MON3007`, `pedido 3007` |
| 2 | Memoria de la conversación | Lo que dijo antes (30 min) |
| 3 | **Pedidos del cliente por su teléfono** | Índice en memoria, TTL 30 min |
| 4 | Se le pide el número de pedido | Formato `MON3007` |

### De dónde sale el teléfono del cliente

**No sirve el de Envia**: ahí va un teléfono de fábrica (el mismo en 20
envíos). La única fuente real es `shipping_address.phone` de Shopify.

Y la búsqueda por `phone:` de GraphQL **no filtra** (devuelve los pedidos más
recientes sin filtrar), así que hay que indexar: `shopify.js` recorre los
~3700 pedidos del historial y arma un `Map<teléfono, pedidos>` en memoria.
Tarda ~7 s la primera vez y se reutiliza 30 minutos.

### Setup

```sh
node scripts/setup_whatsapp.js <waba_id> <phone_number_id>
```

Verifica los scopes, muestra los números del WABA, suscribe la app a los
eventos y comprueba la suscripción.

**Ojo:** `scripts/setup_whatsapp.js` y `scripts/diagnostico_whatsapp.js` usan el
token del **system user**, que solo ve lo que la app tenga aprobado. Mientras la
app no esté publicada, ese token **muestra estados que no son los reales** (por
ejemplo dio `NOT_VERIFIED` para un número que en realidad estaba registrado). Para
ver el estado real hay que usar el **MCP de Meta** (ver más abajo).

#### Estado real (confirmado con el MCP de Meta el 2026-11-10)

| Elemento | Estado |
|---|---|
| Negocio Mondano | ✅ verificado, perfil completo |
| App `mondano_mensajes` conectada | ✅ |
| Número +56 9 2977 3980 | ✅ **registrado y listo para enviar** |
| Webhook (callback + verify token) | ✅ configurado, 5 campos suscritos |
| Suscripción de la cuenta | ✅ |
| **App publicada** | ❌ está en modo desarrollo |
| **Método de pago** | ❌ sin método de pago (los mensajes con plantilla se aceptan pero **no se entregan**) |
| **Token del system user** | ❌ falta generarlo |

Los tres pendientes son manuales (links en la sección siguiente).

#### MCP de WhatsApp Business Tools (Meta)

Meta publica un servidor MCP para administrar la cuenta de WhatsApp Business
(numero, plantillas, webhooks, token del system user). Se usa desde codigo:

```sh
node scripts/mcp_whatsapp_oauth.js     # OAuth con PKCE -> docs/mcp-whatsapp-token.json
node scripts/mcp_client.js tools      # lista las tools
node scripts/mcp_client.js whatsapp_biz_businesses '{"action":"list"}'
```

El registro dinamico de cliente del servidor **solo lo acepta** desde los
clientes que Meta soporta (Claude Code, Claude Desktop, ChatGPT, Codex CLI y
Codex app): con otro `client_name` responde *"Dynamic registration is not
available for this client"*. El `client_id` no concede nada por si solo: la
autorizacion real la da el usuario en el consent del navegador.

Requisitos en el panel de Meta:

1. El número registrado en **WhatsApp Manager** (Business → WhatsApp Manager →
   Phone numbers → Add), verificado por SMS.
2. Scopes `whatsapp_business_messaging` + `whatsapp_business_management` en la
   app, liberados y aprobados en la tienda.
3. `META_WABA_ID` y `META_PHONE_NUMBER_ID` en Vercel.
4. Webhook en `https://envia-webhook.vercel.app/webhook/meta` con el mismo
   verify token, suscrito al evento `messages`.

#### Links de los pendientes

| Pendiente | Link |
|---|---|
| Publicar la app | `https://developers.facebook.com/apps/2595593107610545/go_live/` |
| Método de pago | `https://business.facebook.com/billing_hub/accounts/details/?business_id=111337664819723&asset_id=554629607724135&wizard_name=ADD_PM` |
| Token del system user | `https://business.facebook.com/latest/settings/system_users/?business_id=111337664819723` |

Al generar el token del system user hay que **asignar la app ("Manage app") y la
cuenta de WhatsApp ("Manage WhatsApp Business accounts") en Full control**, y
pedir los scopes `business_management`, `whatsapp_business_messaging` y
`whatsapp_business_management`.

### Aviso de pedido enviado (plantilla)

El aviso al cliente de que su pedido fue recibido sale por la **Cloud API** con
plantilla (fuera de la ventana de 24h no se puede mandar texto libre):

- `WHATSAPP_TEMPLATE_NAME` → plantilla aprobada. Por defecto
  `mondano_hxd04183bb87ff888c98d7131b5ba50dde`
  ("Hola {{1}}, tu pedido #{{2}} fue recibido. ¡Gracias por preferirnos!").
- `WHATSAPP_TEMPLATE_NAME_TRACKING` → opcional, plantilla con el numero de
  seguimiento. Se intenta primero y si falla se cae a la simple.

**Los mensajes con plantilla son facturables:** sin metodo de pago en la cuenta,
Meta los acepta pero el destinatario no los ve.

### Ventana de 24 horas

Meta solo permite responder con texto libre dentro de las 24 h desde el
último mensaje del cliente. Como el bot siempre **responde**, está dentro de
la ventana. Para mensajes proactivos (sin que el cliente escriba antes) hace
falta una plantilla aprobada.


## Alcance de las respuestas (Instagram)

El bot **solo contesta** sobre estos temas; para cualquier otra cosa se queda
mudo (no responde "hola", ni "ok", ni mensajes sobre el catálogo):

| Tema | Qué responde |
|---|---|
| **El pedido** | Estado del envío, fecha estimada, y el proceso de manufactura si el paquete todavía no fue retirado |
| **Cambios y devoluciones** | El paso a paso de la política real de la tienda (página `politica-de-cambio-y-devoluciones`) |
| **Tallas y medidas** | La guía de tallas y la tabla de medidas de las prendas del pedido |
| **Pedir un asesor** | Contacto directo |

Quien decide es el modelo (x.ai), no el código: si el mensaje no es de esos
temas responde `NO_RESPUDER` y el bot no envía nada. El tono es el de la marca:
amable y juvenil, con el saludo *"Hola, gracias por comunicarte con nosotros"* **una sola vez** (al pedir el número de pedido). Cuando el cliente ya dio el código, el bot responde directo con el estado y no vuelve a saludar.

### De dónde sale la información

| Dato | Origen | Scope de Shopify |
|---|---|---|
| Política de cambios y devoluciones | Page `politica-de-cambio-y-devoluciones` | `read_content` |
| Guía de tallas | Page `guia-de-tallas` (es una **imagen**) | `read_content` |
| Tabla de medidas por prenda | Descripción del producto (imagen `talla-*.jpg`) | `read_products` |

Las tablas de medidas son imágenes, así que el modelo no puede leerlas: el bot
comparte el **link** de la imagen para que el cliente la abra.

## Errores frecuentes

| Error | Causa | Solución |
|---|---|---|
| `(#100) subcode 2534014` "No se puede encontrar al usuario solicitado" | Token viejo en Vercel (sin scopes de messaging) | republicar `META_ACCESS_TOKEN` + redesplegar |
| `(#4) Application request limit reached` | Límite de envío por app (transitorio) | se reintenta solo con backoff |
| No llegan logs de Vercel | Suscripción a nivel de app sin `fields` | `POST /{app-id}/subscriptions` |
| `x-ad-api-version-warning: v23.0 has been deprecated` | Versión de Graph API antigua | `META_GRAPH_VERSION=v27.0` |

## Payload de Instagram: `sender` vs `recipient`

```json
"messaging": [{
  "sender":    { "id": "IGSID" },   // el CLIENTE que escribió -> destinatario de la respuesta
  "recipient": { "id": "IGID" },    // nuestra cuenta de negocio -> ig-user-id del path
}]
```

Responder a `recipient.id` es mandarse un mensaje a uno mismo.

## Scripts

### Puesta en marcha
- `scripts/oauth_meta.js` — **token de Meta sin aprobación de dos personas**
  (OAuth de la propia app, 60 días). Requisito: registrar
  `http://localhost:8766/callback` en Facebook Login → Valid OAuth Redirect URIs.
- `scripts/setup_meta_integration.js` — scopes + suscripción + estado final.
- `scripts/setup_whatsapp.js` — setup de WhatsApp Cloud API (suscripción, token,
  código de verificación, plantillas).
- `scripts/ver_webhooks.js` — callback URLs por caso de uso (Instagram y
  WhatsApp son independientes).
- `scripts/verificar_numero.js` — pide el código SMS de verificación.
- `scripts/diagnostico_whatsapp.js` — estado de WhatsApp según el MCP de Meta.
- `scripts/mcp_client.js` / `scripts/mcp_whatsapp_oauth.js` — cliente MCP de las
  herramientas de WhatsApp de Meta.
- `setup_meta_creds.sh` — alta de credenciales en Vercel.

### Pruebas
- `scripts/test_resolucion.js` — **54 tests** de extracción de pedido/teléfono,
  memoria de conversación, contextos y filtrado de notas.
- `scripts/test_flujo.js` — **49 tests** del flujo del bot (saludo de primer
  contacto, pedir el número, no repetir, detección de asesor, estados).
- `scripts/test_conversacion.js` — flujo completo con el handler real y un
  remitente falso (no envía nada a Instagram).
- `scripts/buscar_notas_manufactura.js` — dónde están las notas de taller.
- `scripts/bot-test.js`, `scripts/matriz_tokens.js` — pruebas de tokens y del
  bot en distintos modos.
