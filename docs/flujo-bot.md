# El flujo del bot de Instagram (y por qué dejó de bombardear)

## El problema

El bot usaba la IA para contestarlo todo, y eso producía "bombardeo":

```
cliente:  hola, mi pedido MON4722
bot:      Hola, gracias por comunicarte con nosotros. Estamos revisando la
          información de tu pedido MON4722, nos comunicaremos contigo en breve.
          Si es urgente, ¿quieres que te pase con un asesor?
cliente:  Sí
bot:      Hola, gracias por comunicarte con nosotros. Estamos revisando la
          información de tu pedido MON4722, ...
cliente:  Sí
bot:      Hola, gracias por comunicarte con nosotros. Estamos revisando la
          información de tu pedido MON4722, ...
```

Tres cosas que pasaba:

1. El bot ofrecía "te paso con un asesor" y tomaba el "Sí" del cliente como
   una pregunta nueva → contestaba lo mismo, una y otra vez.
2. Cada mensaje del cliente re-triggeraba una respuesta completa, aunque el
   bot ya había dicho exactamente lo mismo.
3. Cuando un asesor humano estaba hablando con el cliente, el bot se metía en
   medio y contestaba en paralelo.

## La regla nueva

El bot hace **solo dos cosas**, y cada una con un criterio de "una vez":

| | Cuándo | Qué dice |
|---|---|---|
| **1. Pedir el número** | El cliente pregunta por un pedido pero no hay número | "Para revisar tu pedido, ¿me das el número de pedido (formato MON3007)?" |
| **2. Decir dónde está** | Ya hay número de pedido | "Estado de tu pedido MON4722: en camino." + seguimiento |

En cualquier otro caso **se calla**. Y se calla siempre que un asesor humano
esté hablando con ese cliente.

Se activa con `FEATURE_BOT_AUTOMATICO=1` (por defecto). Con
`FEATURE_BOT_AUTOMATICO=0` vuelve el bot viejo con IA (más flexible, pero
puede repetir respuestas).

## Cómo sabe que ya respondió

No hay base de datos de estado: **la fuente de verdad es el historial** de la
conversación (Graph API). Los mensajes que manda el bot tienen marcas
reconocibles, así que se distinguen de los que escribe una persona:

| Texto | Quién lo escribió |
|---|---|
| "Hola, gracias por comunicarte con nosotros…" | el bot |
| "Estado de tu pedido MON4722: en camino." | el bot |
| "Te paso con un asesor de Mondano…" | el bot |
| cualquier otra cosa de nuestra cuenta | **asesor humano** |

Ojo: los bots y los asesores escriben desde la misma cuenta de Instagram
(`@mondano.cl`). No hay forma de que la API diga quién es quién: la
diferencia se saca del texto.

Además hay una cache en memoria (6 h) por si la Graph API va lenta y el
último mensaje del bot todavía no aparece en el historial.

## Las reglas, en orden

```
1. ¿Hay un asesor humano hablando?        → silencio
2. ¿Ya lo derivamos a un asesor?          → silencio
3. ¿Pide hablar con una persona?          → "Te paso con un asesor…"
4. ¿Tiene un problema con el pedido
   (cambio, devolución, prenda dañada)?    → "Te paso con un asesor…"
5. ¿No hay número de pedido?
   ├─ ya se lo pedimos antes              → silencio
   ├─ no pregunta por un pedido           → silencio
   └─ si                                → pedir el número
6. ¿El pedido no existe?                  → "no encontramos el pedido X"
7. ¿Ya le dijimos este mismo estado?      → silencio
8. ¿Cambió el estado?                     → avisar el estado nuevo
9. En cualquier otro caso                 → el estado del pedido
```

El punto 7 es el que evita el bombardeo: **el estado se avisa una vez**. Solo
se vuelve a avisar si *cambió* (de "en confección" a "preparado", de "en
camino" a "en reparto", etc.).

## Los estados

| slug | Qué pasa |
|---|---|
| `en confección` | No tiene etiqueta todavía: sigue en el taller. Se dice textualmente "Estamos revisando la información, nos comunicaremos contigo en breve." |
| `preparado` | Ya tiene etiqueta: esperando que la transportista lo retire. |
| `en camino` | La transportista ya lo recogió. |
| `en reparto` | Va a ser entregado hoy. |
| `entregado` | Ya llegó (con la fecha si existe). |
| `problema` | Devuelto, perdido o retenido: se deriva a un asesor. |

> OJO: decir "en confección" **y** mostrar el número de seguimiento se
> contradice. Si hay etiqueta, el estado es "preparado".

## Qué pasa si no se puede leer el historial

Por seguridad (y porque la Graph API se topa con el limite de llamadas) puede
fallar la lectura del historial. En ese caso:

- Si el mensaje trae un número de pedido → se responde igual (una respuesta
  por mensaje nunca es bombardeo).
- Si no trae número → **silencio**: no se vuelve a pedir un número que el
  cliente ya dio.

## La trampa del `Sí`

El bot ya no ofrece "quieres que te pase con un asesor", así que el "Sí" del
cliente ya no dispara un loop. Si el cliente pide hablar con una persona
explícitamente, se deriva **una vez**.

## Depende del historial

El flujo necesita leer el historial (`FEATURE_CONVERSATION_HISTORY=1`, que es
el valor por defecto). Si se apaga:

- El bot solo responde cuando el mensaje trae el número de pedido.
- Si el mensaje no trae número → silencio (no se atreve a pedirlo de nuevo).

Es el modo degradado: funciona, pero el bot solo contesta lo que se le
puede resolver sin contexto.

## Pruebas

```sh
node scripts/test_flujo.js        # 30 tests del flujo
node scripts/test_resolucion.js   # 54 tests de resolución de pedidos
```

## Archivos

| Archivo | Qué hace |
|---|---|
| `flow.js` | La máquina de estados, las plantillas y la detección de asesor |
| `index.js` → `handleInstagramFlow()` | El handler que usa el flujo |
| `conversations.js` | Lee el historial (paginado de 10 en 10) |
| `bandeja.js` | Los mensajes sin responder (cron diario) |
