# Trampas de las APIs (lo que costó tiempo descubrir)

Este documento es el que hay que leer ANTES de tocar algo. Casi todos los
problemas queiocurrieron en esta sesión tienen su causa acá.

---

## Meta / Graph API

### 1. `req.waitUntil` no existe en el runtime de Vercel

```js
const waitUntil = req.waitUntil ? req.waitUntil.bind(req) : null;  // → SIEMPRE null
```

Sin `waitUntil`, **Vercel congela la función en cuanto envías la respuesta**
y el trabajo pendiente nunca avanza. Parece un bug del webhook, pero es esto.

```js
const { waitUntil } = require("@vercel/functions");
waitUntil(task);        // registra el trabajo pendiente
res.status(200).send("EVENT_RECEIVED");
```

Síntoma: los logs cortan a la mitad y no aparece nada más.

### 2. Generar un token nuevo DEJA INVÁLIDO el anterior

Cuando generas un token nuevo para un System User, Meta revoca el viejo.
Los síntomas cambian según el caso:

| Mensaje | Causa |
|---|---|
| `The access token could not be decrypted` | Token revocado |
| `Session has expired on Sunday, 08-Nov-26 18:00:00 PST` | Token de sesión con expiración corta |
| `Invalid OAuth access token - Cannot parse access token` | Token vacío o de otro proveedor |

Si aparece "could not be decrypted", **el token es correcto pero Meta lo
revocó**: no es un typo. Se compara carácter por carácter para confirmarlo.

### 3. Cada token sirve para UNA cosa

| Token | Sirve en | No sirve en |
|---|---|---|
| `client_credentials` (Shopify) | `mondano-chile.myshopify.com` | `graph.facebook.com` |
| `client_credentials` (Meta) | `graph.facebook.com` | `mondano-chile.myshopify.com` |
| MCP de Meta (`docs/mcp-whatsapp-token.json`) | Solo el servidor MCP | `graph.facebook.com` → *"restricted to MCP server access only"* |

### 4. `conversations`: el límite es 25

```sh
GET /{ig-user-id}/conversations?limit=25   → 25 conversaciones
GET /{ig-user-id}/conversations?limit=50   → 0 conversaciones  (¡y no da error!)
```

### 4b. El detalle de un hilo agota el limite de llamadas; la lista no

El endpoint `GET /{conversation-id}` (los mensajes de UN hilo) llega muy
rapido al tope de la app:

```
(#4) Application request limit reached
```

En cambio `GET /{ig-user-id}/conversations?fields=...,messages{...}&limit=10`
funciona sin problema. Por eso el historial se lee **paginado de 10 en 10**
(3 llamadas para los 25 hilos) y se cachea 15 minutos, en vez de pedir el
detalle de cada hilo.

Ademas las llamadas se serializan (`GRAPH_MIN_INTERVALO_MS`, 1,5 s entre una
y otra): varios pedidos seguidos activan el limite.

### 5. No pidas los mensajes de las 25 conversaciones de una vez

```sh
fields=id,messages{...}&limit=25
→ "Please reduce the amount of data you're asking for, then retry your request"
```

Solución (la que usa `conversations.js`): **lista ligera + detalle de un hilo**

```sh
# 1) lista ligera: 1 llamada, 5 s
GET /{ig-user-id}/conversations?fields=id,participants{id,username}&limit=25
# 2) detalle del hilo que interesa: 1 llamada, 4-5 s
GET /{conversation-id}?fields=id,messages{message,from{id,username},created_time}
```

Presupuesto: Instagram limita a **200 llamadas por hora y por cuenta**. Por eso
el detalle se cachea 15 minutos (`CONVOS_DETALLE_TTL_MS`).

### 6. El texto del mensaje es `message`, no `text`

```sh
fields=messages{message,from{id,username},created_time}   # ← message
fields=messages{text,...}                                 # ← text devuelve null
```

### 7. `platform` se ignora en `conversations`

`?platform=instagram` y `?platform=whatsapp` devuelven **lo mismo**: Instagram y
WhatsApp mezclados. No se puede filtrar por plataforma.

### 8. Los participantes de WhatsApp NO tienen el teléfono

Un cliente de WhatsApp aparece con su **identidad de Instagram** (`username` +
IGSID), aunque viniera de WhatsApp. El `from` del webhook de WhatsApp es el
teléfono, y **no hay forma de mapear teléfono → conversación**.

Workaround implementado: se busca el hilo por el **texto exacto** del mensaje
o por un **número de pedido** que el cliente ya haya dado (revisando el detalle
de los primeros N hilos, con tope).

### 9. `/{ig-user-id}/messages` no existe en el login de Facebook

Solo existe en `graph.instagram.com` (Instagram API with Instagram Login). En
nuestro caso (Facebook Login for Business) hay que usar `conversations` y
detectar "sin responder" mirando el último mensaje de cada hilo.

### 10. Instagram: ventana de 24 horas

```
(#10) Este mensaje se envió fuera del período permitido.
```

Se puede responder **solo dentro de las 24 h** desde el último mensaje del
cliente. Los mensajes viejos se aceptan en el webhook pero no se pueden
contestar. Por eso el lector de bandeja filtra a 23 h.

### 11. La app tiene que estar PUBLICADA

```
app en modo desarrollo → "An app in development mode may not be sent real webhooks"
```

Se publica en `https://developers.facebook.com/apps/{app-id}/go_live/`. Lo que
más se atora: falta la **URL de política de privacidad** en Basic Settings.

### 12. Sin método de pago los mensajes no se ven

```
"billable messages are accepted but the recipient will most likely not see them"
```

### 13. Las callback URLs son POR CASO DE USO

```
object: instagram                 → /webhook/instagram
object: whatsapp_business_account → /webhook/meta
```

**Cambiar una no afecta a la otra.** Se verifica con:

```sh
node scripts/ver_webhooks.js
```

### 14. Scopes que hacen falta

| Canal | Scopes |
|---|---|
| Instagram | `instagram_manage_messages`, `pages_messaging`, `pages_manage_metadata`, `instagram_basic` |
| WhatsApp | `whatsapp_business_messaging`, `whatsapp_business_management`, `business_management` |
| Shopify | `read_orders`, `read_all_orders`, `read_content` (páginas), `read_products` (descripciones) |

Los de Instagram y WhatsApp **pueden ir en el mismo token** (es lo que
recomienda Meta para apps que hacen ambos).

### 15. La API de Graph de Shopify no tiene `Shop.refundPolicy`

Las políticas están en **Pages**, no en el objeto `Shop`:
`politica-de-cambio-y-devoluciones` (2363 chars) y `guia-de-tallas`.

### 15b. "MON3007" y "MON-3007" son el mismo numero

El bot viejo escribia "MON-3007" (con guion) y el nuevo "MON3007". Al
comparar marcas de mensajes hay que quitar los guiones, o el bot se toma sus
propios mensajes por mensajes de un asesor humano.

### 15c. "En confección" y "número de seguimiento" se contradicen

Si el pedido ya tiene etiqueta, **no** esta en confección: esta preparado y
esperando que la transportista lo retire. La etiqueta se genera cuando el
pedido esta listo, asi que:

```
Estado del envio "Created" + tracking number  -> "preparado"
Sin envio (todavia no hay etiqueta)           -> "en confección"
```

Decir "en confección" y mostrar el numero de seguimiento al mismo tiempo
deja al cliente sin saber si su pedido salio o no.

### 15d. El limite de la app es de 200 llamadas por HORA (lecturas y envios)

Las llamadas de lectura (conversations) y las de envio (messages) consumen el
MISMO presupuesto de la app. Con varias pruebas seguidas se llega al tope:

```
(#4) Application request limit reached
x-app-usage: {"call_count":40,...}     # 40% del presupuesto, y aun asi falla
```

La cabecera `x-app-usage` NO refleja el bloqueo del envio: puede marcar 40% y
aun asi no dejar mandar. Y el error es el mismo para todos los
destinatarios (no es por cliente).

Por eso el historial se lee **paginado y cacheado** (3 llamadas cada 15
minutos en vez de 2 por cada mensaje), y cuando el envio falla con #4 se
pausan los envios 10 minutos (`ENVIO_BLOQUEADO_MIN`) para no llenarle al
cliente de copias del mismo mensaje cuando se libere el limite.

OJO: ese pausa es en memoria de la instancia. En Vercel cada invocacion
puede caer en una instancia distinta, asi que es una proteccion "a mejor
hacer" y no una garantia.

### 16. Versión de la API

`v23.0` ya está deprecada (sale el aviso `x-ad-api-version-warning`). Se usa
`v27.0` (`META_GRAPH_VERSION`).

---

## x.ai

### 17. Sin `temperature: 0` la respuesta es ALEATORIA

Esto costó horas de debugging: el mismo mensaje con el mismo contexto daba
"responder" unas veces y `NO_RESPONDER` otras.

```js
body: JSON.stringify({
  model: modelId,
  input: [...],
  store: false,
  temperature: 0,      // ← sin esto, decide al azar
});
```

Verificado con 5 llamadas idénticas: con `temperature: 0` las 5 dio lo mismo.

### 18. Timeout obligatorio

Sin `AbortSignal.timeout()` una llamada lenta a x.ai deja la función colgada
hasta que Vercel la mata por `maxDuration` (y se pierden los logs).

---

## Shopify

### 19. La búsqueda por título no entiende tildes

```sh
title:*poleron*   →  0 resultados   (el catálogo tiene "Polerón")
```

Y en el catálogo coexisten **"Poleron" y "Polerón"**. Por eso `shopify.js`
descarga el catálogo a memoria y compara **en local y sin tildes**.

### 20. Los plurales rompen el match por tipo

El tipo en el catálogo es `Chaqueta`, el cliente escribe "chaquetas". Se
prueba también en singular.

### 21. `GET /orders.json` sin `status=any` devuelve solo los abiertos

```
sin status=any  →  ~80 pedidos (los que no están cerrados)
con status=any  →  todos
```

### 22. Las tablas de medidas son IMÁGENES

En las descripciones: `<h4>Talla:</h4>` + `<img src=".../talla-parkas_480x480.jpg">`.

El modelo es de texto → **no puede leerlas**. Se comparte el **link** de la
imagen. La guía general (`/pages/guia-de-tallas`) es solo una imagen también.

### 23. El token de client_credentials de Shopify se renueva solo

A diferencia de Meta, este no expira: `POST /oauth/access_token` con
`grant_type=client_credentials` y se cachea. Es la mejor opción para leer
Shopify desde el servidor.

---

## Infraestructura

### 24. Plan Hobby: los crons corren 1 vez al día

```
"Hobby accounts are limited to daily cron jobs. This cron expression
(*/15 * * * *) would run more than once per day."
```

### 25. Cambiar una env var exige redesplegar

`vercel env add` + `vercel deploy --prod --yes`. Las funciones serverless leen
las variables al desplegar.

### 26. Si la función muere, se pierden los logs

Vercel agrupa los logs por invocación. Si la función se mata a los 60 s
(`maxDuration`), solo se ven los logs del primer flush.

Por eso: **topes de tiempo en todas las llamadas externas** y un log final
antes de terminar.

### 27. Supabase desde Vercel es intermitente

Algunas consultas tardan **65-90 s**. Se cacheó el mapa pedido→seguimiento en
memoria (TTL 5 min) y se refresca en segundo plano, así el camino crítico
no toca Supabase.

### 28. El `rawBody` para la firma HMAC

```js
app.use(bodyParser.json({
  verify: (req, res, buf) => { req.rawBody = buf ? buf.toString() : ""; },
}));
```

Sin el `verify`, no hay forma de verificar `X-Hub-Signature-256`.
