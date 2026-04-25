# AGENT MEMORY — protocolo del ecosistema de agentes

**Este archivo es la primera cosa que CUALQUIER agente debe leer al arrancar una sesion.**

Vives en un ecosistema con otros agentes (bot de Telegram, Claude en Cowork, futuros workers en background). Comparten memoria a traves de la base de datos Postgres del proyecto. El objetivo es que el trabajo sobreviva a cortes de sesion, creditos agotados, laptops apagadas.

El dueno y unico autorizante humano es **Luis** (luis27182454@gmail.com). Es el quien aprueba/deniega acciones de riesgo.

El servicio que coordina todo se llama `agente-core`. Su URL base de produccion es:

```
https://agente-core.onrender.com/api/agent
```

(En local: `http://localhost:5050/api/agent`.)

---

## 1. Al empezar cualquier tarea

Haz esto en orden, SIEMPRE:

1. Lee este archivo completo (`AGENT_MEMORY.md`).
2. Identificate con un `agentId` unico (ejemplos: `bot-telegram`, `claude-cowork`, `claude-worker-content`).
3. Consulta las misiones abiertas: `GET /api/agent/missions?status=in_progress` y `GET /api/agent/missions?status=pending`.
4. Si Luis te esta asignando una tarea nueva, **crea una mision** antes de ejecutar:
   `POST /api/agent/missions` con `{ title, description, createdBy: "luis", assignedTo: "<tu agentId>" }`.
5. Toma el `id` devuelto. Todo lo que hagas a partir de ahi se asocia a ese id.

## 2. Durante la tarea

- Cuando avances, **appendea notas** a la mision:
  `PATCH /api/agent/missions/:id` con `{ appendNote: "descripcion corta del paso completado", status: "in_progress" }`.
- Los `appendNote` se concatenan con timestamp y agentId; son la bitacora del trabajo.
- Si te bloqueas (esperando input, error externo), marca `status: "blocked"` con una nota explicando que necesitas.

## 3. Antes de cualquier accion de riesgo — OBLIGATORIO

Antes de ejecutar cualquier accion de la siguiente lista, DEBES llamar al **Revisor**:

- `git_push` (cualquier push, pero especialmente a `main`)
- `git_force_push` (siempre, nunca se permite sobre main)
- `file_delete` (borrar archivos del repo)
- `file_overwrite_critical` (sobrescribir `package.json`, `render.yaml`, `.env`, `shared/schema.ts`, etc.)
- `db_migration` (cambios de schema que alteren datos)
- `db_destructive` (DROP, TRUNCATE, DELETE sin WHERE)
- `social_post` (publicar en YouTube, TikTok, Instagram, Facebook)
- `email_send_bulk` (envio masivo de correos)
- `env_change` (cambios a variables de entorno en Render)
- `deploy` (triggers manuales de deploy fuera del auto-deploy de Render)
- `custom` (cualquier otra cosa que pueda ser irreversible)

**Como pedir revision:**

```
POST https://agente-core.onrender.com/api/agent/reviews
Authorization: Bearer $AGENT_API_KEY
X-Agent-Id: <tu agentId>
Body: {
  "actionType": "git_push",
  "summary": "push de 2 commits a main: bump Node a 20.19 + roadmap",
  "payload": "<diff completo o contenido a publicar>",
  "missionId": 42
}
```

La respuesta tiene **3 formas posibles**:

| Respuesta | Que hacer |
|---|---|
| `{ "status": "approve" }` | Proceder inmediatamente. El revisor automatico no encontro riesgos. |
| `{ "status": "block", "reasons": [...] }` | **NUNCA ejecutar.** Es un patron que el sistema bloquea de raiz (ej: force push a main). Actualiza la mision con las razones y reporta a Luis. |
| `{ "status": "pending", "reviewId": N }` | La accion necesita aprobacion humana. Luis ya fue notificado por Telegram. **Polea `GET /api/agent/reviews/:id` hasta que `decision` sea `approved` o `denied`.** Timeout por defecto: 24 h -> pasa a `expired` -> tratar como `denied`. |

**NUNCA ejecutes una accion de riesgo sin una review con `decision: approved` o `status: approve`.**

## 4. Al terminar

- Marca la mision `status: "done"` con un `appendNote` de resumen.
- Si fallaste, usa `status: "blocked"` con nota explicando el error. No marques `done` si no terminaste.

## 5. Autenticacion

Todos los endpoints `/api/agent/*` requieren:

- Header `Authorization: Bearer <AGENT_API_KEY>` (valor en Render dashboard del servicio `agente-core`, env `AGENT_API_KEY`).
- Header `X-Agent-Id: <tu identificador>` (recomendado, no obligatorio pero facilita auditar).

## 6. Que NO vive aqui

Este servicio (`agente-core`) NO es la web del ministerio. Son proyectos separados.

- La web del ministerio esta en otro repo (`mi-web-proyecto`) y es uno de los **targets** que los agentes operan.
- Los datos de usuarios de la web del ministerio (tablas `users`, `events`, etc.) viven en la misma Postgres pero NO se mezclan con las tablas del ecosistema (`agent_missions`, `agent_review_requests`, `agent_activity_log`).
- Los secretos, tokens y passwords NO viven aqui ni en ninguna tabla. Esos van en variables de entorno de Render.

## 7. Si algo parece roto

Llama a `GET /api/agent/health` primero. Te dice:

```
{
  "ok": true,
  "agentApiConfigured": true,    // hay AGENT_API_KEY
  "telegramConfigured": true,    // hay TELEGRAM_BOT_TOKEN + TELEGRAM_OWNER_CHAT_ID
  "databaseConfigured": true     // hay DATABASE_URL
}
```

Si alguno es `false`, falta esa env var en Render. Pidele a Luis que la setee.

Si el endpoint entero no responde (503 con `agent_api_disabled`), falta `AGENT_API_KEY`. Render la genera automaticamente en cada deploy porque en `render.yaml` esta como `generateValue: true`.
