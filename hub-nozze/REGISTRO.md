# REGISTRO — Hub Nozze Righi × Biondi

Registro di build. Aggiornare e ripresentare a ogni giro.

## Stato workspace (porting su Claude Code)

Baseline importata dall'handoff. ATTENZIONE: l'handoff conteneva solo
`index.html` (~713 KB). Le 7 suite di test elencate alla sezione 4
(sim_engine_test.js, a2_test.js, a4_test.js, import_test.js, b1_test.js,
b2_test.js, bisync_test.js) e i sorgenti `ref/` (App_tavoli_.txt,
Simulatore_aperitivo_.txt) NON sono stati trasferiti. La disciplina di
regressione "rieseguire tutte le suite, bisync 12/12" non è quindi
verificabile finché quei file non vengono caricati.

## Stadi (da handoff, sezione 7)

- A1 motore aperitivo            FATTO
- A2 UI aperitivo                FATTO
- A3 grafici canvas              FATTO (solo browser)
- A4 scenari + rimozione iframe  FATTO
- B1 modello posti/serpentina    FATTO
- B2 optimizer 2-opt + vincoli   FATTO
- B3 planimetria SVG             DA FARE
- B4 drag-drop posti             DA FARE
- B5 export/import + rim. iframe DA FARE
- E1 parser CSV/TSV              FATTO
- E2 wizard import               FATTO (solo browser)
- E3 .xlsx via SheetJS           DA FARE (opzionale)
- bisync (regressione)           NON VERIFICABILE (suite mancante)

## Giri

### Giro 0 — setup baseline
- Importato `index.html` dall'handoff (713199 byte, coerente con ~713 KB atteso).
- Estratto lo `<script>` in `tests/app_check.js`; `node --check` = OK (sintassi valida).
- Suite di test assenti: baseline verde NON stabilibile per regressione.
