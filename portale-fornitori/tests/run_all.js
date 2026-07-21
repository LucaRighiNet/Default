"use strict";
/* Runner delle suite native del Portale Fornitori.
   1) node --check sullo <script> estratto da index.html
   2) ogni suite in un processo isolato, con report del totale. */
const { execFileSync, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const dir = __dirname;
const root = path.join(dir, "..");

// 1) node --check sullo <script> estratto da index.html
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const s = html.indexOf("<script>") + "<script>".length;
const e = html.lastIndexOf("</script>");
fs.writeFileSync(path.join(dir, "app_check.js"), html.slice(s, e));
try { execFileSync("node", ["--check", path.join(dir, "app_check.js")], { stdio: "pipe" }); console.log("node --check: OK"); }
catch (err) { console.error("node --check: FAIL\n" + err.stderr); process.exit(1); }

const suites = ["model_test.js", "sync_test.js"];
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
