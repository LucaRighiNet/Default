# Portale Fornitori Righi

Portale per mettere in comunicazione **Righi** e i suoi **fornitori terzisti**
sui lavori di subappalto di manodopera: **cablaggio e costruzione di quadri
elettrici** (automazione, distribuzione, potenza).

Non è un portale di qualifica fornitori né di approvvigionamento materiali: è un
portale di **delega di lavori a progetto**, pensato per gare piccole e brevi
(3–5 settimane), con due obiettivi di design — **ridurre il testo scritto** e
**accelerare l'assegnazione**. Vedi [`PIANO_PRODOTTO.md`](PIANO_PRODOTTO.md).

## Avvio

È una web-app statica offline-first (PWA), senza dipendenze da installare.

- **File unico** (per provarlo su un altro PC): usa **`Portale_Fornitori_Righi.html`**
  — un singolo file autosufficiente. Copialo dove vuoi e **fai doppio clic**: si
  apre nel browser e funziona anche senza connessione (i dati restano sul PC). È
  il modo più semplice per una prova offline.
- **Subito**: apri `index.html` in un browser. Al primo accesso scegli un utente
  (lato Righi o lato Fornitore) — gli accessi sono già predisposti per la demo.
- **Come sito** (consigliato per la PWA / installazione su telefono): servi la
  cartella con un web server statico, es.:

  ```bash
  cd portale-fornitori && python3 -m http.server 8080
  # poi apri http://localhost:8080
  ```

Con il bottone **"cambia utente"** in alto a destra passi al volo tra il lato
Righi e il lato fornitore per vedere entrambe le prospettive.

## Cosa puoi provare

**Lato Righi**
- **Dashboard** (per ruolo, vedi sotto): commesse pubblicate/assegnate,
  **ritardi**, accettazioni da valutare, richieste dei fornitori (KPI cliccabili
  che portano al filtro).
- **Commesse — vista massiva**: pensata per **centinaia di commesse in parallelo**
  (~150 assegnate + ~40 da assegnare nel seed dimostrativo). **Elenco** a tabella
  densa con **ricerca**, **filtri** (stato, tipologia, settore, caposquadra,
  fornitore, solo ritardi), **ordinamento** e paginazione; in alternativa la
  **bacheca Kanban**. Apri una scheda per pubblicare, **notificare**, **assegnare**.
- **Ore stimate di produzione**: campo **riservato a Righi** (mai visibile al
  fornitore) su ogni commessa; alimenta il **carico terzisti** — nella scheda
  **Fornitori** un **istogramma** mostra, per il mese scelto, le ore attive di
  ogni terzista rispetto alla sua **capacità** (barre ordinate per carico, linea
  di capacità, semaforo *sotto capacità / quasi saturo / oltre capacità*); il
  toggle **Tabella** dà la vista multi-mese e la somma per fornitore.
- **Nuovo lavoro**: form a input guidati (tipologia, settore, **lavorazioni
  industrializzate** a selezione multipla — carpenteria esterna, foratura piastre,
  piastra con barre e canale, sbroglio fili, piastra con componenti —, budget,
  **ore**, date, caposquadra, layout; visibilità *tutti / selezionati*; notifica
  anche via **email**). Scegliendo *solo selezionati* il portale propone i
  **fornitori suggeriti** (auto-matching per specializzazione, capacità libera e
  puntualità), invitabili con un tocco. In alternativa **import massivo da
  Excel/CSV** (con template scaricabile): le commesse entrano come bozze. Ogni
  commessa può essere **duplicata** per ripartire dagli stessi dati.
- **Esporta ordini (ERP)**: da Commesse esporti in **CSV** gli ordini accettati
  (fornitore, importo, ore, consegna…) per l'emissione ordine in amministrazione.
- **Richieste** e anagrafica **Fornitori** accreditati (con contatto **email**):
  con **Nuovo fornitore** accrediti un terzista (specializzazioni, settori, zona,
  capacità, certificazioni) che entra subito in suggerimenti, mappa e carico;
  tocca il nome per aprire la **scheda** con le metriche.

**Ruoli e accessi (lato Righi)**
- **Responsabile di produzione**: vede **tutte** le commesse, pubblica, assegna,
  importa/esporta, governa il carico dei terzisti e **approva** le commesse
  proposte dai capisquadra.
- **Caposquadra**: vede in Dashboard e Commesse **solo i progetti che segue** e
  le relative richieste. Può **proporre un nuovo lavoro**, che invia al
  responsabile per l'approvazione (non pubblica direttamente). Vede inoltre il
  **carico di tutti i fornitori** (scheda Fornitori) per capire chi è libero.

**Flusso di approvazione**: quando un caposquadra compila *Nuovo lavoro* e preme
**Invia per approvazione**, la commessa entra in stato **Da approvare** (mai
visibile ai fornitori). Il responsabile la trova in Dashboard e nel filtro
omonimo: **Approva e pubblica** (diventa visibile ai fornitori, con notifica al
caposquadra) oppure **Rimanda** con una nota di revisione. Nessun passaggio
resta scoperto: la commessa rimanda sempre a un'azione possibile.

**Guida in app**: il pulsante **?** in alto apre una guida **passo-passo**
diversa per Responsabile, Caposquadra e Fornitore. Quella del **fornitore** è
esaustiva (bacheca, quotazione, accettazione con firma, avanzamento, richieste
guidate con foto, profilo e metriche) e include una sezione **domande frequenti**.

**Notifiche ed email**: ogni evento (pubblicazione, notifica mirata, richiesta
guidata, risposta) genera una **notifica in app**; dove serve comunicare fuori
dal portale è disponibile l'**email precompilata** (destinatario, oggetto e
corpo pronti) verso fornitori e caposquadra. L'invio automatico lato server è
la naturale evoluzione (vedi `BACKEND.md`).

**Visibilità dei lavori**: un fornitore vede i lavori proposti secondo la
visibilità (*tutti* o *selezionati*), ma **appena un lavoro viene assegnato
resta visibile solo all'assegnatario** — gli altri fornitori non vedono le
commesse affidate a terzi. **Righi vede sempre tutto.**

**Mobile**: interfaccia mobile-first. Su smartphone la vista massiva dei lavori
diventa una **lista di schede compatte tap-friendly** (niente tabelle da
scorrere in orizzontale), le finestre si aprono come *bottom sheet* e i comandi
rispettano le aree di sicurezza del dispositivo.

**Metriche fornitore** (uguali per Righi e fornitore): nel profilo (lato
fornitore) e nella *Scheda & metriche* (lato Righi) trovi **puntualità**,
**lavori/mese**, **carico ore**, **richieste sollevate**, **tasso di
accettazione**, **tempo di risposta** e **ritardo medio**, con mini-trend.

**Slittamenti e modifica consegna**: dal dettaglio commessa il fornitore può
chiedere uno **slittamento** (nuova data + motivo) che il caposquadra
**approva/rifiuta** (se approvato sovrascrive la consegna e notifica); Righi può
anche **modificare direttamente** la data. Ogni cambio resta nello **storico**.

**Dati reali dei terzisti**: l'anagrafica è popolata dalla *Mappatura terzisti
2026* — **54 terzisti** (di cui **28 attivi**, flag `attivo`), con **capacità
ore/mese**, **cablatori**, **risorse dedicate a Righi**, **costo orario**,
**contatti**, note e — dato chiave — la **percentuale di utilizzo preferenziale
per ciascun OTL/caposquadra** (Casadei, Matteucci, Gregori, Smeraldi, Foschi,
Chiaruttini). I dati mancanti nel file (tipologie, ingombro, attrezzature, sede
per alcuni) sono "non specificati" e completabili in app; dove le note lo
permettono sono dedotti.

**Assegnazione intelligente**: in assegnazione il portale ordina i terzisti per
idoneità combinando la **preferenza dell'OTL della commessa** (la % del file:
chi ha % più alta per quel caposquadra sale in classifica), specializzazione,
settore, certificazioni, **limite di spazio** (con avviso "**spazio
insufficiente**" se la commessa indica l'ingombro previsto), **attrezzature**,
**capacità libera** nel mese, **costo** e **puntualità**. Concorrono **solo i
terzisti attivi**; i sovraccarichi sono segnalati e il **semaforo**
verde/giallo/rosso anticipa i ritardi. Il fornitore aggiorna l'**avanzamento con
un tocco** (materiale, cablaggio, collaudo, pronto).

**Mappa fornitori** (in *Fornitori → Mappa*): pin colorati per carico del mese
su tutto il **Nord-Centro Italia** (i terzisti sono accreditabili in oltre 35
città, dal Piemonte alle Marche); tocca un pin per scheda e capacità libera. Da
caposquadra evidenzia le **zone già presidiate** per accorpare i lavori e ridurre
le trasferte.

**Analisi** (scheda dedicata, scopata per ruolo): un **cruscotto** con sei
grafici sulle commesse — **consegne per mese** (carico pianificato e quota ancora
da assegnare), **pipeline per stato**, **salute** delle commesse attive (semaforo
aggregato), **andamento puntualità**, **mix per tipologia** e **carico per
caposquadra**. I grafici categoriali sono **cliccabili** e aprono l'elenco già
filtrato. Colori validati per la leggibilità (anche in caso di daltonismo o
stampa: etichette, trama sulle barre critiche e gap tra i segmenti).

**Lato Fornitore**
- **Bacheca**: i lavori proposti da Righi con le **lavorazioni** previste; **fai
  una domanda** con un tocco oppure **Accetta**, confermando con una **firma
  leggera** a tuo nome (Righi vede il timbro *firmato* con data e ora); il
  **layout** per la quotazione è in evidenza.
- **I miei lavori**: commesse acquisite e consegne.
- **Richieste guidate**: contatta il **caposquadra** seguendo la prassi Righi
  (dubbio tecnico, mancanza materiale, ritardo, chiarimento layout, pronto per
  collaudo…) — la notifica arriva subito al referente della commessa.

## Struttura

| Percorso | Contenuto |
|---|---|
| `index.html` | L'app (PWA) — CSS e JS inline, nessun asset esterno |
| `manifest.json`, `sw.js`, `logo.svg` | PWA: installazione, offline, icona |
| `PIANO_PRODOTTO.md` | Piano di prodotto, sintesi ricerca, roadmap avanzata |
| `BACKEND.md` | Contratto backend: accessi (auth) + sync multi-utente |
| `tests/` | Suite native Node (CI: `node tests/run_all.js`) |

## Test

```bash
cd portale-fornitori && node tests/run_all.js
```

Verifica la sintassi dell'app (`node --check`) e la logica pura di dominio
(regole di **visibilità** dei lavori, **ritardi**, integrità del seed, helper) e
il contratto di **sync**. Nessuna dipendenza esterna.

## Dati e privacy

Prototipo dimostrativo: i dati (utenti demo, lavori, richieste) restano **sul
dispositivo** nello storage del browser. Nessun invio a server. Il passaggio a
un backend cloud multi-utente è descritto in [`BACKEND.md`](BACKEND.md); il
client ha già il *seam* di sync pronto e testato.
