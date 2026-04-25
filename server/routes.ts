// Endpoints REST del ecosistema de agentes.
//
// TODOS requieren:
//   Authorization: Bearer $AGENT_API_KEY
//   X-Agent-Id: <agentId>     (recomendado, no obligatorio)
//
// Si AGENT_API_KEY no esta seteada en el server, todos los endpoints devuelven 503.

import type { Express, Request, Response, NextFunction } from "express";
import { eq, desc, and } from "drizzle-orm";
import { db } from "./db.js";
import {
  agentMissions,
  agentReviewRequests,
  agentActivityLog,
  AGENT_MISSION_STATUSES,
  AGENT_ACTION_TYPES,
  type AgentMissionStatus,
  type AgentActionType,
} from "./schema.js";
import { reviewAction, formatReviewMessageForTelegram } from "./reviewer.js";
import { notifyOwner, editOwnerMessage, isTelegramConfigured } from "./telegram.js";

// ---------- Auth middleware ----------

function requireAgentAuth(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env.AGENT_API_KEY;
  if (!expected) {
    res.status(503).json({ error: "agent_api_disabled", message: "AGENT_API_KEY no configurada" });
    return;
  }
  const header = req.header("authorization");
  if (!header || !header.startsWith("Bearer ")) {
    res.status(401).json({ error: "unauthorized", message: "Falta header Authorization: Bearer ..." });
    return;
  }
  const token = header.slice("Bearer ".length).trim();
  if (token !== expected) {
    res.status(403).json({ error: "forbidden", message: "Token invalido" });
    return;
  }
  next();
}

function getAgentId(req: Request): string {
  return (req.header("x-agent-id") || "unknown").slice(0, 100);
}

async function logActivity(
  agentId: string,
  action: string,
  targetType: string | null,
  targetId: number | null,
  details: Record<string, unknown> = {}
): Promise<void> {
  try {
    await db.insert(agentActivityLog).values({
      agentId,
      action,
      targetType,
      targetId,
      details: JSON.stringify(details),
    });
  } catch (err) {
    console.error("[agent] logActivity fallo", err);
  }
}

// ---------- Rutas ----------

export function registerAgentRoutes(app: Express): void {
  // Health (sin auth, para que Render pueda chequear)
  app.get("/api/agent/health", (_req: Request, res: Response) => {
    res.json({
      ok: true,
      agentApiConfigured: !!process.env.AGENT_API_KEY,
      telegramConfigured: isTelegramConfigured(),
      databaseConfigured: !!process.env.DATABASE_URL,
      now: new Date().toISOString(),
    });
  });

  // Diagnostico de Telegram. Envia un mensaje de prueba directo y devuelve el resultado crudo de la API.
  // Sirve para detectar: chat_id invalido, token revocado, problema de Markdown, etc.
  app.post("/api/agent/diag/telegram", requireAgentAuth, async (_req: Request, res: Response) => {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_OWNER_CHAT_ID;
    const tokenPresent = !!token;
    const chatIdPresent = !!chatId;
    const chatIdMasked = chatId ? chatId.slice(0, 4) + "***" + chatId.slice(-2) : null;

    if (!tokenPresent || !chatIdPresent) {
      res.status(200).json({
        success: false,
        reason: "missing_env_vars",
        tokenPresent,
        chatIdPresent,
        chatIdMasked,
      });
      return;
    }

    try {
      const apiRes = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: "Test de diagnostico desde agente-core. Si ves esto, Telegram funciona OK.",
        }),
      });
      const data: unknown = await apiRes.json();
      res.json({
        success: apiRes.ok,
        httpStatus: apiRes.status,
        tokenPresent,
        chatIdPresent,
        chatIdMasked,
        telegramApiResponse: data,
      });
    } catch (err) {
      res.status(200).json({
        success: false,
        reason: "fetch_threw",
        tokenPresent,
        chatIdPresent,
        chatIdMasked,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // ===== Missions =====

  app.post("/api/agent/missions", requireAgentAuth, async (req: Request, res: Response) => {
    const agentId = getAgentId(req);
    const body = req.body as {
      title?: unknown;
      description?: unknown;
      createdBy?: unknown;
      assignedTo?: unknown;
      metadata?: unknown;
    };

    if (!body || typeof body.title !== "string" || typeof body.description !== "string") {
      res.status(400).json({ error: "invalid_body", message: "title y description requeridos" });
      return;
    }

    const createdBy = typeof body.createdBy === "string" ? body.createdBy : agentId;
    const assignedTo = typeof body.assignedTo === "string" ? body.assignedTo : null;
    const metadata = body.metadata ? JSON.stringify(body.metadata) : "{}";

    try {
      const [mission] = await db
        .insert(agentMissions)
        .values({
          title: body.title.slice(0, 500),
          description: body.description,
          createdBy,
          assignedTo,
          metadata,
        })
        .returning();
      await logActivity(agentId, "mission_created", "mission", mission.id, {
        title: mission.title,
      });
      res.status(201).json(mission);
    } catch (err) {
      console.error("[agent] create mission fallo", err);
      res.status(500).json({ error: "internal", message: String(err) });
    }
  });

  app.get("/api/agent/missions", requireAgentAuth, async (req: Request, res: Response) => {
    const status = req.query.status as string | undefined;
    const assignedTo = req.query.assignedTo as string | undefined;

    try {
      let rows;
      if (status && assignedTo) {
        rows = await db
          .select()
          .from(agentMissions)
          .where(and(eq(agentMissions.status, status), eq(agentMissions.assignedTo, assignedTo)))
          .orderBy(desc(agentMissions.updatedAt));
      } else if (status) {
        rows = await db
          .select()
          .from(agentMissions)
          .where(eq(agentMissions.status, status))
          .orderBy(desc(agentMissions.updatedAt));
      } else if (assignedTo) {
        rows = await db
          .select()
          .from(agentMissions)
          .where(eq(agentMissions.assignedTo, assignedTo))
          .orderBy(desc(agentMissions.updatedAt));
      } else {
        rows = await db.select().from(agentMissions).orderBy(desc(agentMissions.updatedAt)).limit(100);
      }
      res.json(rows);
    } catch (err) {
      console.error("[agent] list missions fallo", err);
      res.status(500).json({ error: "internal", message: String(err) });
    }
  });

  app.get("/api/agent/missions/:id", requireAgentAuth, async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "invalid_id" });
      return;
    }
    try {
      const [mission] = await db.select().from(agentMissions).where(eq(agentMissions.id, id));
      if (!mission) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      res.json(mission);
    } catch (err) {
      res.status(500).json({ error: "internal", message: String(err) });
    }
  });

  app.patch("/api/agent/missions/:id", requireAgentAuth, async (req: Request, res: Response) => {
    const agentId = getAgentId(req);
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "invalid_id" });
      return;
    }
    const body = req.body as {
      status?: unknown;
      appendNote?: unknown;
      assignedTo?: unknown;
    };

    try {
      const [existing] = await db.select().from(agentMissions).where(eq(agentMissions.id, id));
      if (!existing) {
        res.status(404).json({ error: "not_found" });
        return;
      }

      const updates: Partial<typeof existing> = { updatedAt: new Date() };

      if (typeof body.status === "string") {
        if (!(AGENT_MISSION_STATUSES as readonly string[]).includes(body.status)) {
          res.status(400).json({
            error: "invalid_status",
            message: `Validos: ${AGENT_MISSION_STATUSES.join(", ")}`,
          });
          return;
        }
        updates.status = body.status as AgentMissionStatus;
      }

      if (typeof body.assignedTo === "string") {
        updates.assignedTo = body.assignedTo;
      }

      if (typeof body.appendNote === "string" && body.appendNote.trim().length > 0) {
        const ts = new Date().toISOString();
        const noteLine = `[${ts}] [${agentId}] ${body.appendNote.trim()}`;
        const newNotes = existing.progressNotes
          ? `${existing.progressNotes}\n${noteLine}`
          : noteLine;
        updates.progressNotes = newNotes;
      }

      const [updated] = await db
        .update(agentMissions)
        .set(updates)
        .where(eq(agentMissions.id, id))
        .returning();

      await logActivity(agentId, "mission_updated", "mission", id, {
        status: updates.status,
        appendedNote: typeof body.appendNote === "string",
      });

      res.json(updated);
    } catch (err) {
      console.error("[agent] patch mission fallo", err);
      res.status(500).json({ error: "internal", message: String(err) });
    }
  });

  // ===== Reviews =====

  app.post("/api/agent/reviews", requireAgentAuth, async (req: Request, res: Response) => {
    const agentId = getAgentId(req);
    const body = req.body as {
      actionType?: unknown;
      summary?: unknown;
      payload?: unknown;
      missionId?: unknown;
      targetBranch?: unknown;
    };

    if (
      !body ||
      typeof body.actionType !== "string" ||
      typeof body.summary !== "string" ||
      typeof body.payload !== "string"
    ) {
      res.status(400).json({
        error: "invalid_body",
        message: "actionType, summary, payload requeridos",
      });
      return;
    }

    if (!(AGENT_ACTION_TYPES as readonly string[]).includes(body.actionType)) {
      res.status(400).json({
        error: "invalid_action_type",
        message: `Validos: ${AGENT_ACTION_TYPES.join(", ")}`,
      });
      return;
    }

    const result = reviewAction({
      actionType: body.actionType as AgentActionType,
      summary: body.summary,
      payload: body.payload,
      targetBranch: typeof body.targetBranch === "string" ? body.targetBranch : undefined,
    });

    // Casos rapidos: approve o block, no creamos review_request en DB
    if (result.status === "approve") {
      await logActivity(agentId, "review_auto_approve", null, null, {
        actionType: body.actionType,
        riskScore: result.riskScore,
      });
      res.json({ status: "approve", riskScore: result.riskScore, reasons: result.reasons });
      return;
    }

    if (result.status === "block") {
      await logActivity(agentId, "review_auto_block", null, null, {
        actionType: body.actionType,
        reasons: result.reasons,
      });
      res.json({ status: "block", reasons: result.reasons, riskScore: result.riskScore });
      return;
    }

    // needs_human: persistir, notificar, devolver pending
    const hours = Number(process.env.REVIEW_AUTO_DENY_HOURS || "24");
    const expiresAt = new Date(Date.now() + hours * 3600 * 1000);

    try {
      const [review] = await db
        .insert(agentReviewRequests)
        .values({
          missionId: typeof body.missionId === "number" ? body.missionId : null,
          requestedBy: agentId,
          actionType: body.actionType,
          summary: body.summary.slice(0, 500),
          payload: body.payload.slice(0, 50_000),
          riskScore: result.riskScore,
          riskReasons: JSON.stringify(result.reasons),
          decision: "pending",
          expiresAt,
        })
        .returning();

      // Notificar a Luis por Telegram
      const msgText = formatReviewMessageForTelegram({
        reviewId: review.id,
        agentId,
        actionType: body.actionType,
        summary: body.summary,
        riskScore: result.riskScore,
        reasons: result.reasons,
        expiresAt,
      });
      const messageId = await notifyOwner(msgText);
      if (messageId) {
        await db
          .update(agentReviewRequests)
          .set({ telegramMessageId: messageId })
          .where(eq(agentReviewRequests.id, review.id));
      }

      await logActivity(agentId, "review_pending", "review", review.id, {
        actionType: body.actionType,
        riskScore: result.riskScore,
      });

      res.status(202).json({
        status: "pending",
        reviewId: review.id,
        riskScore: result.riskScore,
        reasons: result.reasons,
        expiresAt: expiresAt.toISOString(),
      });
    } catch (err) {
      console.error("[agent] create review fallo", err);
      res.status(500).json({ error: "internal", message: String(err) });
    }
  });

  app.get("/api/agent/reviews/:id", requireAgentAuth, async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "invalid_id" });
      return;
    }
    try {
      const [review] = await db
        .select()
        .from(agentReviewRequests)
        .where(eq(agentReviewRequests.id, id));
      if (!review) {
        res.status(404).json({ error: "not_found" });
        return;
      }

      // Auto-expire si vencio y sigue pending
      if (review.decision === "pending" && review.expiresAt < new Date()) {
        const [expired] = await db
          .update(agentReviewRequests)
          .set({ decision: "expired", decidedBy: "system", decidedAt: new Date() })
          .where(eq(agentReviewRequests.id, id))
          .returning();
        res.json(expired);
        return;
      }

      res.json(review);
    } catch (err) {
      res.status(500).json({ error: "internal", message: String(err) });
    }
  });

  app.post(
    "/api/agent/reviews/:id/decision",
    requireAgentAuth,
    async (req: Request, res: Response) => {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) {
        res.status(400).json({ error: "invalid_id" });
        return;
      }
      const body = req.body as {
        decision?: unknown;
        reason?: unknown;
        decidedBy?: unknown;
      };
      if (body.decision !== "approved" && body.decision !== "denied") {
        res
          .status(400)
          .json({ error: "invalid_decision", message: "decision: 'approved' | 'denied'" });
        return;
      }

      try {
        const [existing] = await db
          .select()
          .from(agentReviewRequests)
          .where(eq(agentReviewRequests.id, id));
        if (!existing) {
          res.status(404).json({ error: "not_found" });
          return;
        }
        if (existing.decision !== "pending") {
          res.status(409).json({ error: "already_decided", decision: existing.decision });
          return;
        }

        const decidedBy = typeof body.decidedBy === "string" ? body.decidedBy : "luis";
        const reason = typeof body.reason === "string" ? body.reason : null;

        const [updated] = await db
          .update(agentReviewRequests)
          .set({
            decision: body.decision as "approved" | "denied",
            decidedBy,
            decidedAt: new Date(),
            decisionReason: reason,
          })
          .where(eq(agentReviewRequests.id, id))
          .returning();

        // Editar el mensaje en Telegram si fue enviado
        if (existing.telegramMessageId) {
          const verb = body.decision === "approved" ? "APROBADA" : "DENEGADA";
          const suffix = reason ? `\n\nRazon: ${reason}` : "";
          await editOwnerMessage(
            existing.telegramMessageId,
            `\u2705 *Revision #${id} ${verb}* por ${decidedBy}${suffix}`
          );
        }

        await logActivity("system", "review_decision", "review", id, {
          decision: body.decision,
          decidedBy,
        });

        res.json(updated);
      } catch (err) {
        console.error("[agent] decision fallo", err);
        res.status(500).json({ error: "internal", message: String(err) });
      }
    }
  );

  // ===== Activity log =====

  app.get("/api/agent/activity", requireAgentAuth, async (req: Request, res: Response) => {
    const limit = Math.min(Number(req.query.limit) || 50, 500);
    try {
      const rows = await db
        .select()
        .from(agentActivityLog)
        .orderBy(desc(agentActivityLog.createdAt))
        .limit(limit);
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: "internal", message: String(err) });
    }
  });
}
