"use strict";
/* PLAYLIST — link musicali per momento della scaletta: parsing/validazione URL
   (solo http/https, niente javascript:) ed etichetta del servizio dal dominio. */
const assert = require("assert");
const { sandbox } = require("./_harness");

const START = "// Suggerimenti guidati per il run-of-show.";
const END = "// Scaletta standard:";
const EXPORTS = ["musicUrl","musicLabel"];
const S = sandbox(START, END, EXPORTS, {});

let __pass = 0, __fail = 0, __q = [];
const ok = (n, f) => __q.push([n, f]);
function run(){
  for (const [n, f] of __q){ try{ f(); __pass++; } catch(e){ __fail++; console.error("  FAIL [playlist_test] " + n + " :: " + e.message); } }
  console.log("playlist_test: " + __pass + "/" + (__pass + __fail) + (__fail ? "  (" + __fail + " FAIL)" : ""));
  if (__fail) process.exitCode = 1;
}

ok("musicUrl: URL https valido resta invariato", () => {
  assert.strictEqual(S.musicUrl("https://open.spotify.com/playlist/37i9"), "https://open.spotify.com/playlist/37i9");
});
ok("musicUrl: dominio senza schema -> https:// aggiunto", () => {
  assert.strictEqual(S.musicUrl("open.spotify.com/playlist/x"), "https://open.spotify.com/playlist/x");
});
ok("musicUrl: vuoto -> vuoto", () => {
  assert.strictEqual(S.musicUrl(""), "");
  assert.strictEqual(S.musicUrl("   "), "");
});
ok("musicUrl: testo non-URL -> vuoto", () => {
  assert.strictEqual(S.musicUrl("la mia playlist"), "");
});
ok("musicUrl: schema pericoloso (javascript:) -> vuoto", () => {
  assert.strictEqual(S.musicUrl("javascript:alert(1)"), "");
  assert.strictEqual(S.musicUrl("data:text/html,x"), "");
});
ok("musicUrl: http resta http", () => {
  assert.strictEqual(S.musicUrl("http://deezer.com/playlist/1"), "http://deezer.com/playlist/1");
});
ok("musicLabel: riconosce i servizi principali", () => {
  assert.strictEqual(S.musicLabel("https://open.spotify.com/playlist/1"), "Spotify");
  assert.strictEqual(S.musicLabel("https://music.apple.com/it/playlist/1"), "Apple Music");
  assert.strictEqual(S.musicLabel("https://music.youtube.com/playlist?list=1"), "YouTube Music");
  assert.strictEqual(S.musicLabel("https://music.amazon.it/playlists/1"), "Amazon Music");
  assert.strictEqual(S.musicLabel("https://www.deezer.com/playlist/1"), "Deezer");
});
ok("musicLabel: dominio sconosciuto -> 'Playlist'", () => {
  assert.strictEqual(S.musicLabel("https://example.com/x"), "Playlist");
});

run();
