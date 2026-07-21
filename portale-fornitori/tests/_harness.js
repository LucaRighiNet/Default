"use strict";
/* Harness condiviso per le suite native.
   Estrae un blocco di funzioni pure da index.html tra due ancore testuali e lo
   esegue in un sandbox con new Function, iniettando gli stub richiesti.
   Stesso pattern del prodotto hub-nozze: testare la logica pura senza DOM. */
const fs = require("fs");
const path = require("path");

function loadHtml() {
  return fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
}

// startAnchor incluso; endAnchor escluso (è l'inizio del codice DOPO il blocco).
function sandbox(startAnchor, endAnchor, exportsList, globals) {
  const html = loadHtml();
  const s = html.indexOf(startAnchor);
  const e = html.indexOf(endAnchor, s + 1);
  if (s < 0) throw new Error("ancora iniziale non trovata: " + startAnchor);
  if (e <= s) throw new Error("ancora finale non trovata: " + endAnchor);
  const block = html.slice(s, e);
  const gk = Object.keys(globals || {});
  const fn = new Function(...gk, block + "\nreturn {" + exportsList.join(",") + "};");
  return fn(...gk.map(k => globals[k]));
}

// Mini runner sincrono: raccoglie ok/fail e ritorna il conteggio.
function runner(suiteName) {
  let pass = 0, fail = 0;
  return {
    ok(name, fn) {
      try { fn(); pass++; }
      catch (e) { fail++; console.error("  FAIL [" + suiteName + "] " + name + " :: " + e.message); }
    },
    done() {
      const total = pass + fail;
      console.log(suiteName + ": " + pass + "/" + total + (fail ? "  (" + fail + " FAIL)" : ""));
      if (fail) process.exitCode = 1;
      return { pass, fail, total };
    }
  };
}

module.exports = { loadHtml, sandbox, runner };
