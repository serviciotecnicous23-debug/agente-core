# Siguiente paso — instrucciones para Luis

Hola Luis. El repo `agente-core` ya esta listo en tu PC en:

```
C:\Users\Luis2\agente-autonomo\agente-core\
```

(o donde tengas tu carpeta `agente-autonomo`).

Para que el ecosistema entre en funcionamiento, necesitas hacer 4 cosas en este orden.
Cada paso es copiar y pegar.

---

## Paso 1 — abandonar el branch viejo en `mi-web-proyecto`

El trabajo que estaba en `feat/agent-ecosystem-phase1` se va al basurero porque
ahora vive en `agente-core`. Para que tu repo de la web quede limpio:

```cmd
cd C:\Users\Luis2\agente-autonomo\repos\mi-web-proyecto
git checkout main
git branch -D feat/agent-ecosystem-phase1
```

Si te dice "branch not found", perfecto, ya estaba limpio.
La web del ministerio queda intacta, sin codigo de agentes mezclado.

---

## Paso 2 — crear el repo en GitHub

1. Ve a https://github.com/new
2. Nombre del repo: `agente-core`
3. **No** marques "Add README", **no** marques `.gitignore`, **no** marques licencia (ya tenemos los nuestros).
4. Privado o publico, lo que prefieras (yo recomiendo **privado** — este es tu cerebro de agentes).
5. Crear.

Te dara una URL tipo `https://github.com/serviciotecnicous23-debug/agente-core.git`.
Copiala.

---

## Paso 3 — pushear el codigo desde tu PC

```cmd
cd C:\Users\Luis2\agente-autonomo\agente-core
git init -b main
git add .
git commit -m "feat: agente-core fase 1 - misiones, revisor, telegram"
git remote add origin https://github.com/serviciotecnicous23-debug/agente-core.git
git push -u origin main
```

Si te pide credenciales, usa tu username de GitHub y como password tu Personal
Access Token (el `GITHUB_TOKEN` que tienes en `.env` del bot).

---

## Paso 4 — desplegar en Render

1. Entra a https://dashboard.render.com
2. Click en `New +` -> `Web Service`
3. Conecta tu repo `agente-core` (te pedira permiso a GitHub).
4. Render leera el `render.yaml` automaticamente. Confirma:
   - Name: `agente-core`
   - Region: Oregon
   - Branch: `main`
   - Plan: Free
5. **MUY IMPORTANTE** — antes de hacer click en Create, ve a la seccion
   `Environment Variables` y agrega TRES variables:

   | Variable | De donde sacar el valor |
   |---|---|
   | `DATABASE_URL` | Ve al servicio `ministerio-avivando-el-fuego` en Render -> Environment -> copia el valor de `DATABASE_URL` (el Internal URL si esta) y pegalo aqui. **Es la misma Postgres**, no una nueva. |
   | `TELEGRAM_BOT_TOKEN` | El que ya tienes en tu `.env` del bot (`7966971422:AAEo8...`). |
   | `TELEGRAM_OWNER_CHAT_ID` | Tu chat ID de Telegram. Si no lo tienes, mandale `/whoami` a tu bot y te lo da. |

6. `AGENT_API_KEY` se genera automaticamente — la veras despues del primer
   deploy en la pestana Environment.

7. Click en `Create Web Service`. Render va a buildear (`npm install && npm run build`)
   y arrancar (`node dist/server/index.js`). Tarda unos 3-5 min.

---

## Paso 5 — verificar

Cuando el deploy termine (status: `Live`), Render te dara una URL tipo
`https://agente-core.onrender.com`. Abre en el navegador:

```
https://agente-core.onrender.com/api/agent/health
```

Debes ver:

```json
{
  "ok": true,
  "agentApiConfigured": true,
  "telegramConfigured": true,
  "databaseConfigured": true,
  "now": "2026-04-24T..."
}
```

Si los tres son `true`, todo esta funcionando.

---

## Paso 6 — actualizar el bot de Telegram

Ve al servicio del bot en Render (o donde lo tengas corriendo) y agrega
2 variables de entorno:

| Variable | Valor |
|---|---|
| `AGENT_API_KEY` | Copia el valor del dashboard de Render del servicio `agente-core` (Environment -> AGENT_API_KEY -> click en el ojito para verla). |
| `AGENT_API_BASE` | `https://agente-core.onrender.com/api/agent` |

Tambien copia el contenido de `BOT_INSTRUCTIONS.md` al system prompt del bot
(o donde le pases instrucciones a Claude en el bot).

---

## Listo

Cuando estes en este punto, el ecosistema esta vivo. Cualquier agente
(empezando por el bot de Telegram) puede:

1. Crear misiones que sobreviven a reinicios.
2. Pedir revision antes de pushear codigo.
3. Recibir aprobacion tuya por Telegram con `/aprobar 42`.

Si algo no funciona en Paso 5 (alguno de los flags es `false`), avisame y
te ayudo a debuggearlo.
