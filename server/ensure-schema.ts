// Crea las tablas del ecosistema de agentes si no existen.
// Idempotente: se puede correr en cada arranque sin riesgo.
// No toca tablas que no son del ecosistema.

import postgres from "postgres";

export async function ensureAgentSchema(connectionString: string): Promise<void> {
  const sql = postgres(connectionString, { max: 1 });

  try {
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS agent_missions (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_by TEXT NOT NULL,
        assigned_to TEXT,
        progress_notes TEXT NOT NULL DEFAULT '',
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    await sql.unsafe(`
      CREATE INDEX IF NOT EXISTS idx_agent_missions_status ON agent_missions (status);
      CREATE INDEX IF NOT EXISTS idx_agent_missions_assigned ON agent_missions (assigned_to);
    `);

    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS agent_review_requests (
        id SERIAL PRIMARY KEY,
        mission_id INTEGER,
        requested_by TEXT NOT NULL,
        action_type TEXT NOT NULL,
        summary TEXT NOT NULL,
        payload TEXT NOT NULL,
        risk_score INTEGER NOT NULL DEFAULT 0,
        risk_reasons TEXT NOT NULL DEFAULT '[]',
        decision TEXT NOT NULL DEFAULT 'pending',
        decided_by TEXT,
        decided_at TIMESTAMP,
        decision_reason TEXT,
        telegram_message_id INTEGER,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMP NOT NULL
      );
    `);

    await sql.unsafe(`
      CREATE INDEX IF NOT EXISTS idx_agent_reviews_decision ON agent_review_requests (decision);
      CREATE INDEX IF NOT EXISTS idx_agent_reviews_mission ON agent_review_requests (mission_id);
    `);

    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS agent_activity_log (
        id SERIAL PRIMARY KEY,
        agent_id TEXT NOT NULL,
        action TEXT NOT NULL,
        target_type TEXT,
        target_id INTEGER,
        details TEXT NOT NULL DEFAULT '{}',
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    await sql.unsafe(`
      CREATE INDEX IF NOT EXISTS idx_agent_activity_created ON agent_activity_log (created_at);
      CREATE INDEX IF NOT EXISTS idx_agent_activity_agent ON agent_activity_log (agent_id);
    `);
  } finally {
    await sql.end();
  }
}
