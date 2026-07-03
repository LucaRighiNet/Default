"use strict";
/* P2 — ruoli e permessi: Session (owner/editor/viewer) + gating delle azioni. */
const assert = require("assert");
const { sandbox, runner } = require("./_harness");

const START = "/* ============ RUOLI E PERMESSI (P2) ============ */";
const END = "/* ==== fine blocco permessi ==== */";
const EXPORTS = ["Session","actIsMutating","permBlocks","READONLY_ACTS"];
const S = sandbox(START, END, EXPORTS, {});
const r = runner("perm_test");

r.ok("Session: default owner, canEdit true", () => {
  S.Session.setRole("owner");
  assert.strictEqual(S.Session.role(), "owner");
  assert.strictEqual(S.Session.canEdit(), true);
});
r.ok("Session: editor può modificare", () => {
  S.Session.setRole("editor");
  assert.strictEqual(S.Session.canEdit(), true);
});
r.ok("Session: viewer NON può modificare", () => {
  S.Session.setRole("viewer");
  assert.strictEqual(S.Session.canEdit(), false);
});
r.ok("Session: ruolo ignoto ricade su owner", () => {
  S.Session.setRole("qualcosa");
  assert.strictEqual(S.Session.role(), "owner");
});
r.ok("actIsMutating: azioni di aiuto/navigazione non mutano", () => {
  assert.strictEqual(S.actIsMutating("openGuide"), false);
  assert.strictEqual(S.actIsMutating("openAccount"), false);
  assert.strictEqual(S.actIsMutating("openDiag"), false);
  assert.strictEqual(S.actIsMutating("hideTip"), false);
});
r.ok("actIsMutating: azioni di modifica mutano", () => {
  ["addTable","editGuest","delVendor","assignSeat","optimizeAll","addRule","importGuests","resetEvent","autoAssign"].forEach(a=>{
    assert.strictEqual(S.actIsMutating(a), true, a);
  });
});
r.ok("permBlocks: viewer bloccato sulle mutazioni, non sulle azioni safe", () => {
  S.Session.setRole("viewer");
  assert.strictEqual(S.permBlocks("addTable"), true);
  assert.strictEqual(S.permBlocks("assignSeat"), true);
  assert.strictEqual(S.permBlocks("openGuide"), false);
  assert.strictEqual(S.permBlocks("openAccount"), false);
});
r.ok("permBlocks: owner/editor non bloccati", () => {
  S.Session.setRole("owner");
  assert.strictEqual(S.permBlocks("addTable"), false);
  S.Session.setRole("editor");
  assert.strictEqual(S.permBlocks("delGuest"), false);
  S.Session.setRole("owner");
});

r.done();
