#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const PROFILE = process.env.DATABRICKS_PROFILE || "databricks-sanus";
const runId = Number(process.argv[2]);
if (!runId) {
  console.error("uso: node scripts/poll-job-run.mjs <run_id>");
  process.exit(1);
}

function dbApi(method, path) {
  const out = execFileSync("databricks", [
    "api", method, path, "--profile", PROFILE, "--output", "json",
  ], { encoding: "utf8" });
  return JSON.parse(out);
}

const start = Date.now();
let lastState = "";
while (true) {
  const data = dbApi("get", `/api/2.1/jobs/runs/get?run_id=${runId}`);
  const state = data.state || {};
  const life = state.life_cycle_state;
  const result = state.result_state || "—";
  const seconds = Math.round((Date.now() - start) / 1000);
  const stamp = `${seconds}s`;
  if (life !== lastState) {
    console.log(`[${stamp}] life=${life} result=${result}`);
    lastState = life;
  } else {
    process.stdout.write(`\r[${stamp}] life=${life} result=${result}   `);
  }
  if (life === "TERMINATED" || life === "INTERNAL_ERROR" || life === "SKIPPED") {
    process.stdout.write("\n");
    console.log(`message: ${state.state_message || "(vazio)"}`);
    if (data.tasks?.length) {
      for (const t of data.tasks) {
        console.log(`  • task ${t.task_key}: ${t.state?.life_cycle_state} / ${t.state?.result_state}`);
      }
    }
    process.exit(result === "SUCCESS" ? 0 : 1);
  }
  await sleep(5000);
}
