// Entry point del servicio agente-core.
// Express app standalone — no comparte proceso con ningun otro servicio.

import express from "express";
import { registerAgentRoutes } from "./routes.js";
import { ensureAgentSchema } from "./ensure-schema.js";

const PORT = Number(process.env.PORT || 5050);

async function main(): Promise<void> {
  const app = express();
  app.use(express.json({ limit: "10mb" }));

  // Crear tablas si no existen (idempotente)
  if (process.env.DATABASE_URL) {
    try {
      await ensureAgentSchema(process.env.DATABASE_URL);
      console.log("[agente-core] schema verificado / creado");
    } catch (err) {
      console.error("[agente-core] ensureAgentSchema fallo (continua igual)", err);
    }
  }

  registerAgentRoutes(app);

  // Catch-all 404
  app.use((req, res) => {
    res.status(404).json({ error: "not_found", path: req.path });
  });

  app.listen(PORT, () => {
    console.log(`[agente-core] escuchando en puerto ${PORT}`);
    console.log(`  agentApiConfigured: ${!!process.env.AGENT_API_KEY}`);
    console.log(`  telegramConfigured: ${!!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_OWNER_CHAT_ID)}`);
    console.log(`  databaseConfigured: ${!!process.env.DATABASE_URL}`);
  });
}

main().catch((err) => {
  console.error("[agente-core] arranque fallo", err);
  process.exit(1);
});
