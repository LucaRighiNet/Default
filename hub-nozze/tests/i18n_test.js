"use strict";
/* P3 — fondamenta i18n: t(), dizionari it/en, parità chiavi. */
const assert = require("assert");
const { sandbox, runner } = require("./_harness");

const START = "/* ============ I18N (fondamenta P3) ============ */";
const END = "/* ==== fine blocco i18n ==== */";
const mk = (state) => sandbox(START, END, ["t", "appLang", "I18N"], { STATE: state });

const r = runner("i18n_test");

r.ok("default it: etichette in italiano", () => {
  const S = mk({ lang: "it" });
  assert.strictEqual(S.appLang(), "it");
  assert.strictEqual(S.t("tab.seating"), "Tavoli");
  assert.strictEqual(S.t("tab.vendors"), "Fornitori");
});
r.ok("lang en: etichette in inglese", () => {
  const S = mk({ lang: "en" });
  assert.strictEqual(S.appLang(), "en");
  assert.strictEqual(S.t("tab.seating"), "Tables");
  assert.strictEqual(S.t("tab.vendors"), "Vendors");
});
r.ok("lang assente -> default it", () => {
  const S = mk({});
  assert.strictEqual(S.appLang(), "it");
  assert.strictEqual(S.t("tab.guests"), "Ospiti & RSVP");
});
r.ok("chiave mancante -> ritorna la chiave", () => {
  const S = mk({ lang: "en" });
  assert.strictEqual(S.t("non.esiste"), "non.esiste");
});
r.ok("parità chiavi it/en", () => {
  const S = mk({ lang: "it" });
  const it = Object.keys(S.I18N.it).sort(), en = Object.keys(S.I18N.en).sort();
  assert.deepStrictEqual(it, en);
});

r.done();
