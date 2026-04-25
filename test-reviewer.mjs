// Smoke test del reviewer.
// Reproduce las funciones puras sin necesidad de instalar deps.
// Si esto pasa, sabemos que el corazon del sistema funciona.

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
  "server/schema.ts",
  "server/reviewer.ts",
  "server/telegram.ts",
];

function parseDiffStats(diff) {
  const lines = diff.split(/\r?\n/);
  const filesChanged = [];
  const filesEmptied = [];
  const criticalTouched = [];

  let currentFile = null;
  let currentAdded = 0;
  let currentRemoved = 0;
  let totalAdded = 0;
  let totalRemoved = 0;

  const closeFile = () => {
    if (!currentFile) return;
    if (currentRemoved >= 5 && currentRemoved >= currentAdded * 9) {
      filesEmptied.push(currentFile);
    }
    if (CRITICAL_FILES.some((cf) => currentFile === cf || currentFile.endsWith("/" + cf))) {
      criticalTouched.push(currentFile);
    }
  };

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      closeFile();
      const match = line.match(/^diff --git a\/(.+) b\/(.+)$/);
      currentFile = match ? match[2] : null;
      if (currentFile) filesChanged.push(currentFile);
      currentAdded = 0;
      currentRemoved = 0;
    } else if (line.startsWith("+++") || line.startsWith("---")) {
      // headers
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

function reviewAction(input) {
  const reasons = [];
  let riskScore = 0;

  if (input.actionType === "git_force_push") {
    const branch = (input.targetBranch ?? "main").toLowerCase();
    if (branch === "main" || branch === "master") {
      return {
        status: "block",
        riskScore: 999,
        reasons: ["force-push a rama protegida (main/master) jamas se permite"],
      };
    }
    return {
      status: "needs_human",
      riskScore: 80,
      reasons: ["force-push a feature branch puede borrar trabajo de otros agentes"],
    };
  }
  if (input.actionType === "social_post") {
    return { status: "needs_human", riskScore: 70, reasons: ["publicacion en redes sociales: siempre escala a humano (politica)"] };
  }
  if (input.actionType === "email_send_bulk") {
    return { status: "needs_human", riskScore: 70, reasons: ["envio masivo de email: siempre escala a humano (politica)"] };
  }
  if (input.actionType === "env_change") {
    return { status: "needs_human", riskScore: 70, reasons: ["cambio de variables de entorno: siempre escala a humano"] };
  }
  if (input.actionType === "db_destructive") {
    return { status: "needs_human", riskScore: 90, reasons: ["operacion destructiva en DB"] };
  }
  if (input.actionType === "deploy") {
    return { status: "needs_human", riskScore: 60, reasons: ["deploy manual"] };
  }
  if (input.actionType === "file_delete" || input.actionType === "file_overwrite_critical") {
    return { status: "needs_human", riskScore: 75, reasons: [input.actionType === "file_delete" ? "borrado de archivo" : "sobrescritura critica"] };
  }
  if (input.actionType === "db_migration") {
    riskScore += 30;
    reasons.push("migracion de schema");
  }

  if (input.actionType === "git_push" || input.actionType === "custom") {
    const stats = parseDiffStats(input.payload || "");

    if (stats.filesEmptied.length > 0) {
      riskScore += 50 * stats.filesEmptied.length;
      reasons.push(`archivo(s) "vaciado(s)": ${stats.filesEmptied.join(", ")}`);
    }
    if (stats.criticalTouched.length > 0) {
      riskScore += 40 * stats.criticalTouched.length;
      reasons.push(`archivo(s) critico(s): ${stats.criticalTouched.join(", ")}`);
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
        reasons.push(`${Math.round(ratio * 100)}% del diff es borrado`);
      }
    }
  }

  if (riskScore >= 30) {
    return { status: "needs_human", riskScore, reasons };
  }
  return { status: "approve", riskScore, reasons: reasons.length > 0 ? reasons : ["sin patrones de riesgo"] };
}

// ===== Tests =====

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function eq(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg || "assertion"}: esperado ${JSON.stringify(expected)} obtuve ${JSON.stringify(actual)}`);
  }
}
function gte(actual, threshold, msg) {
  if (actual < threshold) {
    throw new Error(`${msg || "assertion"}: esperado >=${threshold} obtuve ${actual}`);
  }
}

test("force-push a main siempre se bloquea", () => {
  const r = reviewAction({ actionType: "git_force_push", summary: "x", payload: "" });
  eq(r.status, "block", "status");
  eq(r.riskScore, 999, "riskScore");
});

test("social_post siempre escala a humano", () => {
  const r = reviewAction({ actionType: "social_post", summary: "post tiktok", payload: "Mira mi nuevo video" });
  eq(r.status, "needs_human", "status");
});

test("git_push de cambio chico se aprueba", () => {
  const diff = `diff --git a/README.md b/README.md
--- a/README.md
+++ b/README.md
+Una linea nueva
+Otra linea`;
  const r = reviewAction({ actionType: "git_push", summary: "doc", payload: diff });
  eq(r.status, "approve", "status");
});

test("DESASTRE 22-abr-2026: package.json wipe DEBE escalar a humano", () => {
  // Reproduce el diff que vacio package.json ese dia
  const dummyDeleted = Array.from({ length: 40 }, (_, i) => `-  "linea-${i}": "valor",`).join("\n");
  const diff = `diff --git a/package.json b/package.json
--- a/package.json
+++ b/package.json
${dummyDeleted}
+{}`;
  const r = reviewAction({ actionType: "git_push", summary: "limpieza", payload: diff });
  eq(r.status, "needs_human", "status");
  gte(r.riskScore, 90, "riskScore alto esperado");
  // debe mencionar package.json
  const allReasons = r.reasons.join(" ");
  if (!allReasons.includes("package.json")) {
    throw new Error("debe mencionar package.json en las razones: " + allReasons);
  }
});

test("git_push que toca render.yaml escala", () => {
  const diff = `diff --git a/render.yaml b/render.yaml
--- a/render.yaml
+++ b/render.yaml
-NODE_VERSION: "18.0.0"
+NODE_VERSION: "20.19.0"`;
  const r = reviewAction({ actionType: "git_push", summary: "bump node", payload: diff });
  eq(r.status, "needs_human", "status");
});

test("env_change siempre escala", () => {
  const r = reviewAction({ actionType: "env_change", summary: "agregar TELEGRAM_BOT_TOKEN", payload: "{}" });
  eq(r.status, "needs_human", "status");
});

test("db_destructive: DROP TABLE escala con riesgo alto", () => {
  const r = reviewAction({ actionType: "db_destructive", summary: "DROP users", payload: "DROP TABLE users;" });
  eq(r.status, "needs_human", "status");
  gte(r.riskScore, 80, "riskScore");
});

// Run
let pass = 0, fail = 0;
for (const t of tests) {
  try {
    t.fn();
    console.log(`  PASS: ${t.name}`);
    pass++;
  } catch (e) {
    console.log(`  FAIL: ${t.name}\n    ${e.message}`);
    fail++;
  }
}
console.log(`\n${pass}/${pass + fail} pasaron.`);
if (fail > 0) process.exit(1);
