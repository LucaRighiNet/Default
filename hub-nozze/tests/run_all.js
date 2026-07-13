"use strict";
/* Runner di tutte le suite native. Esegue node --check sullo <script> estratto,
   poi ogni suite in un processo isolato, e riporta il totale.
   NOTA: la suite storica "bisync" (sync iframe Tableau) non è qui: testava il
   bridge dell'iframe che lo stadio B5 rimuove. Vedi REGISTRO. */
const { execFileSync, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const dir = __dirname;
const root = path.join(dir, "..");

// 1) node --check sullo <script> estratto da index.html
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
// Lo <script> principale è l'ULTIMO tag <script> (prima ci sono la config
// window.HUB_CLOUD e il tag esterno <script src=...> di supabase-js).
const s = html.lastIndexOf("<script>") + "<script>".length;
const e = html.lastIndexOf("</script>");
fs.writeFileSync(path.join(dir, "app_check.js"), html.slice(s, e));
try { execFileSync("node", ["--check", path.join(dir, "app_check.js")], { stdio: "pipe" }); console.log("node --check: OK"); }
catch (err) { console.error("node --check: FAIL\n" + err.stderr); process.exit(1); }

const suites = ["b1_test.js","b2_test.js","vars_test.js","alerts_test.js","stats_test.js","budget_forecast_test.js","decisions_test.js","event_test.js","import_test.js","sim_engine_test.js","a2_test.js","a4_test.js","storage_test.js","sync_test.js","cloud_test.js","perm_test.js","share_test.js","i18n_test.js","playlist_test.js","scaletta_test.js","timeline_test.js","merge_test.js","merge_fuzz_test.js"];
let failed = 0;
console.log("");
for (const f of suites) {
  const res = spawnSync("node", [path.join(dir, f)], { encoding: "utf8" });
  process.stdout.write(res.stdout || "");
  if (res.stderr) process.stderr.write(res.stderr);
  if (res.status !== 0) failed++;
}
console.log("");
console.log(failed ? ("RISULTATO: " + failed + " suite con FAIL") : "RISULTATO: tutte le suite verdi");
process.exit(failed ? 1 : 0);
