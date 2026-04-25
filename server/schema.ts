// Schema del ecosistema de agentes.
// Estas tablas viven en la misma Postgres que la web del ministerio,
// pero son COMPLETAMENTE INDEPENDIENTES de las tablas del ministerio
// (users, events, etc.) y solo este servicio las lee/escribe.

import { pgTable, serial, text, integer, timestamp, index } from "drizzle-orm/pg-core";

// ---------- Constantes ----------

export const AGENT_MISSION_STATUSES = [
  "pending",
  "in_progress",
  "blocked",
  "done",
  "cancelled",
] as const;
export type AgentMissionStatus = (typeof AGENT_MISSION_STATUSES)[number];

export const AGENT_REVIEW_DECISIONS = [
  "pending",
  "approved",
  "denied",
  "expired",
] as const;
export type AgentReviewDecision = (typeof AGENT_REVIEW_DECISIONS)[number];

export const AGENT_ACTION_TYPES = [
  "git_push",
  "git_force_push",
  "file_delete",
  "file_overwrite_critical",
  "db_migration",
  "db_destructive",
  "social_post",
  "email_send_bulk",
  "env_change",
  "deploy",
  "custom",
] as const;
export type AgentActionType = (typeof AGENT_ACTION_TYPES)[number];

// ---------- Tablas ----------

export const agentMissions = pgTable(
  "agent_missions",
  {
    id: serial("id").primaryKey(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    status: text("status").notNull().default("pending"),
    createdBy: text("created_by").notNull(),
    assignedTo: text("assigned_to"),
    progressNotes: text("progress_notes").notNull().default(""),
    metadata: text("metadata").notNull().default("{}"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => ({
    statusIdx: index("idx_agent_missions_status").on(t.status),
    assignedIdx: index("idx_agent_missions_assigned").on(t.assignedTo),
  })
);

export const agentReviewRequests = pgTable(
  "agent_review_requests",
  {
    id: serial("id").primaryKey(),
    missionId: integer("mission_id"),
    requestedBy: text("requested_by").notNull(),
    actionType: text("action_type").notNull(),
    summary: text("summary").notNull(),
    payload: text("payload").notNull(),
    riskScore: integer("risk_score").notNull().default(0),
    riskReasons: text("risk_reasons").notNull().default("[]"),
    decision: text("decision").notNull().default("pending"),
    decidedBy: text("decided_by"),
    decidedAt: timestamp("decided_at", { mode: "date" }),
    decisionReason: text("decision_reason"),
    telegramMessageId: integer("telegram_message_id"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { mode: "date" }).notNull(),
  },
  (t) => ({
    decisionIdx: index("idx_agent_reviews_decision").on(t.decision),
    missionIdx: index("idx_agent_reviews_mission").on(t.missionId),
  })
);

export const agentActivityLog = pgTable(
  "agent_activity_log",
  {
    id: serial("id").primaryKey(),
    agentId: text("agent_id").notNull(),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: integer("target_id"),
    details: text("details").notNull().default("{}"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => ({
    createdIdx: index("idx_agent_activity_created").on(t.createdAt),
    agentIdx: index("idx_agent_activity_agent").on(t.agentId),
  })
);

export type AgentMission = typeof agentMissions.$inferSelect;
export type NewAgentMission = typeof agentMissions.$inferInsert;
export type AgentReviewRequest = typeof agentReviewRequests.$inferSelect;
export type NewAgentReviewRequest = typeof agentReviewRequests.$inferInsert;
export type AgentActivity = typeof agentActivityLog.$inferSelect;
export type NewAgentActivity = typeof agentActivityLog.$inferInsert;
