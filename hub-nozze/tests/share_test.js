"use strict";
/* P2 — condivisione: token invito, URL invito/RSVP, payload RSVP. */
const assert = require("assert");
const { sandbox, runner } = require("./_harness");

const START = "/* ============ CONDIVISIONE (P2): inviti collaboratori + RSVP pubblico ============ */";
const END = "/* ==== fine blocco condivisione ==== */";
const EXPORTS = ["makeInviteToken","inviteURL","rsvpURL","buildRsvpPayload","rsvpParam","inviteRoleParam"];
const S = sandbox(START, END, EXPORTS, {});
const r = runner("share_test");

r.ok("makeInviteToken: prefisso inv_ e token univoci", () => {
  const a = S.makeInviteToken(), b = S.makeInviteToken();
  assert(/^inv_/.test(a));
  assert.notStrictEqual(a, b);
});
r.ok("inviteURL: include token e ruolo (viewer/editor)", () => {
  const u = S.inviteURL("https://x.it", "/index.html", "inv_abc", "viewer");
  assert(u.indexOf("https://x.it/index.html?invite=inv_abc") === 0);
  assert(u.indexOf("role=viewer") >= 0);
});
r.ok("inviteURL: ruolo ignoto -> editor", () => {
  assert(S.inviteURL("https://x.it", "/", "t", "boh").indexOf("role=editor") >= 0);
});
r.ok("rsvpURL: include il token", () => {
  assert.strictEqual(S.rsvpURL("https://x.it", "/index.html", "rsvp_9"), "https://x.it/index.html?rsvp=rsvp_9");
});
r.ok("buildRsvpPayload: normalizza rsvp/plusOne/campi", () => {
  const p = S.buildRsvpPayload("rsvp_1", { name: "  Anna Verdi ", rsvp: "conf", meal: "vegano", plusOne: "2", intolerances: " noci " });
  assert.strictEqual(p.token, "rsvp_1");
  assert.strictEqual(p.name, "Anna Verdi");
  assert.strictEqual(p.rsvp, "conf");
  assert.strictEqual(p.meal, "vegano");
  assert.strictEqual(p.plusOne, 2);
  assert.strictEqual(p.intolerances, "noci");
  assert(typeof p.ts === "string" && p.ts.length > 0);
});
r.ok("buildRsvpPayload: rsvp fuori dominio -> attesa; plusOne negativo -> 0", () => {
  const p = S.buildRsvpPayload("t", { name: "x", rsvp: "boh", plusOne: "-5" });
  assert.strictEqual(p.rsvp, "attesa");
  assert.strictEqual(p.plusOne, 0);
});
r.ok("buildRsvpPayload: 'no' preservato", () => {
  assert.strictEqual(S.buildRsvpPayload("t", { name: "x", rsvp: "no" }).rsvp, "no");
});

r.done();
