# agente-core

Cerebro central del ecosistema de agentes de Luis.

Este servicio es **independiente** de cualquier proyecto que los agentes operen
(la web del ministerio, los pipelines de contenido, etc.). Su responsabilidad es:

1. Coordinar misiones entre agentes (bot de Telegram, Claude en Cowork, workers en background).
2. Revisar acciones de riesgo antes de que se ejecuten (pushes, borrados, publicaciones).
3. Notificar al humano (Luis) por Telegram cuando algo necesita aprobacion.
4. Mantener una bitacora compartida que sobreviva a cortes de sesion.

## Arquitectura

```
+-------------------+        +----------------------+
|   bot-telegram    | -----> |                      |
+-------------------+        |                      |
                             |    agente-core API   |
+-------------------+        |  (este repo)         |
|   claude-cowork   | -----> |                      |
+-------------------+        |  /api/agent/*        |
                             |                      |
+-------------------+        |  Postgres compartida |
|  worker-content   | -----> |                      |
+-------------------+        +----------+-----------+
                                        |
                                        v
                                +-------+-----+
                                |  Telegram   |
                                |  (Luis)     |
                                +-------------+
```

Los agentes operan SOBRE distintos targets (la web del ministerio, redes sociales,
archivos locales). Este servicio NO toca esos targets directamente: solo
coordina, revisa y notifica.

## Endpoints

Todos requieren `Authorization: Bearer $AGENT_API_KEY` y `X-Agent-Id: <agentId>`.

- `GET  /api/agent/health` — ping y diagnostico
- `POST /api/agent/missions` — crear mision
- `GET  /api/agent/missions` — listar misiones (filtros: status, assignedTo)
- `GET  /api/agent/missions/:id` — detalle
- `PATCH /api/agent/missions/:id` — actualizar estado / append note
- `POST /api/agent/reviews` — pedir revision de accion de riesgo
- `GET  /api/agent/reviews/:id` — polear estado de revision
- `POST /api/agent/reviews/:id/decision` — Luis aprueba/deniega
- `GET  /api/agent/activity` — bitacora cronologica

## Desarrollo local

```bash
cp .env.example .env
# rellena DATABASE_URL, AGENT_API_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_OWNER_CHAT_ID
npm install
npm run dev
```

## Despliegue en Render

El `render.yaml` ya esta configurado. Conecta el repo en Render y:

1. Setea `DATABASE_URL` apuntando a la **misma** Postgres del ministerio (Internal URL).
2. Setea `TELEGRAM_BOT_TOKEN` y `TELEGRAM_OWNER_CHAT_ID`.
3. `AGENT_API_KEY` se genera automaticamente.
4. Health check: `/api/agent/health`.

## Reglas que el ecosistema impone

Lee `AGENT_MEMORY.md` para el protocolo completo. En corto:

- Antes de cualquier accion de riesgo (push a main, borrar archivo, publicar
  contenido, cambiar env vars, migrar DB destructivo), el agente DEBE pedir
  revision via `POST /api/agent/reviews`.
- El revisor automatico (`server/reviewer.ts`) clasifica: `approve` / `block`
  / `needs_human`.
- Si `needs_human`, Luis recibe un mensaje en Telegram con resumen del cambio
  y debe responder `/aprobar N` o `/denegar N razon`.
- El agente polea `GET /api/agent/reviews/:id` cada 30s hasta que Luis decida
  o pasen 24h (auto-deny).
