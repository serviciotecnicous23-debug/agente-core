// Revisor de acciones de riesgo.
//
// Funcion pura: dado un input describiendo lo que un agente quiere hacer,
// devuelve approve / block / needs_human con razones estructuradas.
//
// Reglas duras (jamas pasan):
//   - git_force_push contra main   -> block
//   - file_overwrite_critical sin backup -> needs_human (siempre)
//   - social_post / email_send_bulk / env_change / db_destructive -> needs_human (siempre)
//
// Reglas heuristicas (sumar riskScore):
//   - archivo critico tocado          (+40)
//   - archivo "vaciado" (>=90% borrado y nuevo <20 lineas) (+50)
//   - net deletion > 100 lineas       (+ hasta 40)
//   - deletion ratio > 80%            (+20)
//
// Threshold: riskScore >= 60 -> needs_human; >= 30 -> needs_human (cauteloso); else approve.
//
// El revisor es la unica linea de defensa entre un agente confiado y un disastre
// como el del 22-abr-2026 donde se vacio package.json.

import type { AgentActionType } from "./schema.js";

export interface ReviewInput {
  actionType: AgentActionType;
  summary: string;
  /** Diff en formato git (texto) para git_*. Para social_post: el texto a publicar. Para env_change: JSON con cambios. */
  payload: string;
  /** Solo aplica a git_*: rama destino. Default: "main". */
  targetBranch?: string;
}

export interface ReviewResult {
  status: "approve" | "block" | "needs_human";
  riskScore: number;
  reasons: string[];
}

/** Archivos cuyo deterioro rompe el ecosistema o pierde datos. */
const CRITICAL_FILES = [
  "package.json",
  "package-lock.json",
  "render.yaml",
  ".env",
  ".env.production",
  ".env.local",
  "drizzle.config.ts",
  "drizzle.config.js",
  "tsconfig.json",
  "vite.config.ts",
  "server/index.ts",
  "server/db.ts",
  "server/routes.ts",
  "shared/schema.ts",
  "client/src/main.tsx",
  "client/src/App.tsx",
  ".nvmrc",
  // Archivos del propio agente-core
  "server/schema.ts",
  "server/reviewer.ts",
  "server/telegram.ts",
];

interface DiffStats {
  filesChanged: string[];
  filesEmptied: string[];
  criticalTouched: string[];
  totalAdded: number;
  totalRemoved: number;
}

/**
 * Parsea un diff en formato `git diff` y extrae estadisticas.
 * No usa libs: split por lineas y conteo manual para mantenerlo dependency-free.
 */
export function parseDiffStats(diff: string): DiffStats {
  const lines = diff.split(/\r?\n/);
  const filesChanged: string[] = [];
  const filesEmptied: string[] = [];
  const criticalTouched: string[] = [];

  let currentFile: string | null = null;
  let currentAdded = 0;
  let currentRemoved = 0;
  let totalAdded = 0;
  let totalRemoved = 0;

  const closeFile = () => {
    if (!currentFile) return;
    if (currentRemoved >= 5 && currentRemoved >= currentAdded * 9) {
      // ratio: borraste >=90% del contenido y casi no agregaste nada
      filesEmptied.push(currentFile);
    }
    if (CRITICAL_FILES.some((cf) => currentFile === cf || currentFile?.endsWith("/" + cf))) {
      criticalTouched.push(currentFile);
    }
  };

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      // cierra el anterior
      closeFile();
      // empieza uno nuevo
      const match = line.match(/^diff --git a\/(.+) b\/(.+)$/);
      currentFile = match ? match[2] : null;
      if (currentFile) filesChanged.push(currentFile);
      currentAdded = 0;
      currentRemoved = 0;
    } else if (line.startsWith("+++") || line.startsWith("---")) {
      // headers, ignore
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      currentAdded++;
      totalAdded++;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      currentRemoved++;
      totalRemoved++;
    }
  }
  closeFile();

  return { filesChanged, filesEmptied, criticalTouched, totalAdded, totalRemoved };
}

export function reviewAction(input: ReviewInput): ReviewResult {
  const reasons: string[] = [];
  let riskScore = 0;

  // ---------- Reglas duras ----------

  if (input.actionType === "git_force_push") {
    const branch = (input.targetBranch ?? "main").toLowerCase();
    if (branch === "main" || branch === "master") {
      return {
        status: "block",
        riskScore: 999,
        reasons: ["force-push a rama protegida (main/master) jamas se permite"],
      };
    }
    // force push a feature branch: aun necesita humano
    return {
      status: "needs_human",
      riskScore: 80,
      reasons: ["force-push a feature branch puede borrar trabajo de otros agentes"],
    };
  }

  if (input.actionType === "social_post") {
    return {
      status: "needs_human",
      riskScore: 70,
      reasons: [
        "publicacion en redes sociales: siempre escala a humano (politica)",
      ],
    };
  }

  if (input.actionType === "email_send_bulk") {
    return {
      status: "needs_human",
      riskScore: 70,
      reasons: ["envio masivo de email: siempre escala a humano (politica)"],
    };
  }

  if (input.actionType === "env_change") {
    return {
      status: "needs_human",
      riskScore: 70,
      reasons: ["cambio de variables de entorno: siempre escala a humano"],
    };
  }

  if (input.actionType === "db_destructive") {
    return {
      status: "needs_human",
      riskScore: 90,
      reasons: ["operacion destructiva en DB (DROP/TRUNCATE/DELETE sin WHERE)"],
    };
  }

  if (input.actionType === "deploy") {
    return {
      status: "needs_human",
      riskScore: 60,
      reasons: ["deploy manual fuera del auto-deploy de Render"],
    };
  }

  if (input.actionType === "file_delete" || input.actionType === "file_overwrite_critical") {
    return {
      status: "needs_human",
      riskScore: 75,
      reasons: [
        input.actionType === "file_delete"
          ? "borrado de archivo del repo"
          : "sobrescritura de archivo critico",
      ],
    };
  }

  if (input.actionType === "db_migration") {
    // migracion de schema: cauteloso pero no bloqueo
    riskScore += 30;
    reasons.push("migracion de schema de DB");
  }

  // ---------- Reglas heuristicas (solo para git_push y custom) ----------

  if (input.actionType === "git_push" || input.actionType === "custom") {
    const stats = parseDiffStats(input.payload || "");

    if (stats.filesEmptied.length > 0) {
      riskScore += 50 * stats.filesEmptied.length;
      reasons.push(
        `archivo(s) "vaciado(s)" (>=90% borrado): ${stats.filesEmptied.join(", ")}`
      );
    }

    if (stats.criticalTouched.length > 0) {
      riskScore += 40 * stats.criticalTouched.length;
      reasons.push(
        `archivo(s) critico(s) tocado(s): ${stats.criticalTouched.join(", ")}`
      );
    }

    const netDeletion = stats.totalRemoved - stats.totalAdded;
    if (netDeletion > 100) {
      const bonus = Math.min(40, Math.floor(netDeletion / 10));
      riskScore += bonus;
      reasons.push(`net deletion alto: -${netDeletion} lineas`);
    }

    const total = stats.totalAdded + stats.totalRemoved;
    if (total > 0) {
      const ratio = stats.totalRemoved / total;
      if (ratio > 0.8 && stats.totalRemoved > 30) {
        riskScore += 20;
        reasons.push(
          `${Math.round(ratio * 100)}% del diff es borrado (${stats.totalRemoved}/${total})`
        );
      }
    }
  }

  // ---------- Decision ----------

  if (riskScore >= 30) {
    return { status: "needs_human", riskScore, reasons };
  }

  return {
    status: "approve",
    riskScore,
    reasons: reasons.length > 0 ? reasons : ["sin patrones de riesgo detectados"],
  };
}

/** Mensaje listo para mandar a Telegram via Markdown. */
export function formatReviewMessageForTelegram(opts: {
  reviewId: number;
  agentId: string;
  actionType: string;
  summary: string;
  riskScore: number;
  reasons: string[];
  expiresAt: Date;
}): string {
  const reasonsList = opts.reasons.map((r) => `\u2022 ${escapeMd(r)}`).join("\n");
  const expires = opts.expiresAt.toISOString().replace("T", " ").slice(0, 16) + " UTC";
  return [
    `\u26A0\uFE0F *Revision #${opts.reviewId}*`,
    ``,
    `*Agente:* ${escapeMd(opts.agentId)}`,
    `*Accion:* ${escapeMd(opts.actionType)}`,
    `*Resumen:* ${escapeMd(opts.summary)}`,
    `*Riesgo:* ${opts.riskScore}`,
    ``,
    `*Razones:*`,
    reasonsList,
    ``,
    `Vence: ${expires}`,
    ``,
    `Responde con \`/aprobar ${opts.reviewId}\` o \`/denegar ${opts.reviewId} razon\``,
  ].join("\n");
}

function escapeMd(s: string): string {
  return s.replace(/([_*`\[\]()])/g, "\\$1");
}
