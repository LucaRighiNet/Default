# Portale Fornitori Righi

Portale per mettere in comunicazione **Righi** e i suoi **fornitori**
sui lavori di subappalto di manodopera: **cablaggio e costruzione di quadri
elettrici** (automazione, distribuzione, potenza).

Non è un portale di approvvigionamento materiali: è un portale di **delega di
lavori a progetto**, pensato per gare piccole e brevi (3–5 settimane), con due
obiettivi di design — **ridurre il testo scritto** e **accelerare
l'assegnazione**. Include la **qualifica dei fornitori** per la parte che incide
sull'operatività — con un **registro dei tipi di documento configurabile**, dove
per ciascuno si decide se è richiesto, se è **bloccante**, chi può vederlo e come
avvisa prima della scadenza — non come sistema completo di gestione della
conformità aziendale.

Quattro **profili di accesso**: responsabile di produzione, OTL/caposquadra,
**responsabile QHSE** (presidio documentale, senza accesso alle commesse) e
fornitore. Ciascuno vede e può fare cose diverse, e il confine è applicato nelle
funzioni, non solo nascondendo i pulsanti.

**Documento di riferimento**: [`SPECIFICHE.md`](SPECIFICHE.md) raccoglie in un
unico posto le specifiche **funzionali, organizzative e tecniche**, con diagrammi
di stato, di flusso e del modello dati. Ne esiste anche la versione **Word**
(`Specifiche_Portale_Fornitori_Righi.docx`), con copertina, indice e diagrammi
come immagini, per la condivisione e la stampa. Vedi anche
[`PIANO_PRODOTTO.md`](PIANO_PRODOTTO.md) (visione e roadmap) e
[`BACKEND.md`](BACKEND.md) (contratto per il server).

## Avvio

È una web-app statica offline-first (PWA), senza dipendenze da installare.

- **File unico** (per provarlo su un altro PC): usa **`Portale_Fornitori_Righi.html`**
  — un singolo file autosufficiente. Copialo dove vuoi e **fai doppio clic**: si
  apre nel browser e funziona anche senza connessione (i dati restano sul PC). È
  il modo più semplice per una prova offline.
- **Subito**: apri `index.html` in un browser. Al primo accesso scegli un utente
  (lato Righi — responsabile di produzione, caposquadra o **QHSE** — oppure lato
  Fornitore): gli accessi sono già predisposti per la demo.
- **Come sito** (consigliato per la PWA / installazione su telefono): servi la
  cartella con un web server statico, es.:

  ```bash
  cd portale-fornitori && python3 -m http.server 8080
  # poi apri http://localhost:8080
  ```

Con il bottone **"cambia utente"** in alto a destra passi al volo tra il lato
Righi e il lato fornitore per vedere entrambe le prospettive.

**Se vedi una versione vecchia**: il portale salva i dati **nel browser**, quindi
un dispositivo che l'ha già usato può conservare i dati di una versione
precedente. Ora il portale se ne accorge da solo (i dati hanno una **versione del
modello**) e li **rigenera** quando l'app si aggiorna. In più, da *cambia utente*
c'è **Ripristina dati dimostrativi** per tornare ai dati iniziali della versione
corrente senza toccare le impostazioni del browser — riservato al **responsabile
di produzione**, perché azzera i dati di tutti gli accessi. Se apri il portale online da
un link salvato nei preferiti, usa sempre l'indirizzo del portale e fai un
**ricaricamento forzato** (`Ctrl+Shift+R`): un link "fotografato" in precedenza
può servire una copia vecchia.

## Cosa puoi provare

**Lato Righi**
- **Dashboard** (per profilo, vedi sotto): commesse pubblicate/assegnate,
  **ritardi**, accettazioni da valutare, richieste dei fornitori (le celle del
  **cartiglio** sono cliccabili e portano al filtro) e la lista
  **Assegnati / in corso** (la commessa appena
  assegnata compare in cima, evidenziata: così dopo l'assegnazione la si vede
  subito senza cambiare scheda).
- **Commesse — vista massiva**: pensata per **centinaia di commesse in parallelo**
  (~150 assegnate + ~40 da assegnare nel seed dimostrativo). **Elenco** a tabella
  densa con **ricerca**, **filtri** (stato, tipologia, settore, caposquadra,
  fornitore, solo ritardi), **ordinamento** e paginazione; in alternativa la
  **bacheca Kanban**. Apri una scheda per pubblicare, **notificare**, **assegnare**.
- **Ore stimate di produzione**: campo **riservato a Righi** (mai visibile al
  fornitore) su ogni commessa; alimenta il **carico fornitori** — nella scheda
  **Fornitori** un **istogramma** mostra, per il mese scelto, le ore attive di
  ogni fornitore rispetto alla sua **capacità** (barre ordinate per carico, linea
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
  con **Nuovo fornitore** accrediti un fornitore (specializzazioni, settori, zona,
  capacità, certificazioni, attrezzature, preferenze OTL) che entra subito in
  suggerimenti, mappa e carico; tocca il nome per aprire la **scheda** con le
  metriche. Dalla scheda, il **responsabile di produzione** può **Modifica
  scheda** e aggiornare tutti i dati (il caposquadra non può: creazione e
  modifica dell'anagrafica sono riservate al responsabile).

**Qualifica dei fornitori (documenti)**: il portale presidia anche la domanda
*«questo fornitore **può** lavorare per noi?»*, distinta da *«a chi conviene
affidare questo lavoro?»*.

**Non tutti i documenti sono bloccanti**, ed è la distinzione che regge tutto: un
DURC scaduto ferma il lavoro, un'informativa privacy non firmata va sollecitata
ma non ferma niente. Confonderle porta o a bloccare troppo (e la regola viene
aggirata) o a non bloccare mai (e la regola non esiste). Per questo l'elenco dei
tipi **non è scritto nel programma**: si configura.

**Menu Tipi di documento** — da *Fornitori · Tipi di documento* (o da *Qualifica*
per il QHSE, o dalla scheda di un fornitore), riservato al **responsabile QHSE**
e al **responsabile di produzione**. Per ogni tipo si definisce:

| Campo | Effetto |
|---|---|
| **Tipo di documento** | Il nome mostrato a Righi e, se visibile, al fornitore |
| **Caratteristiche** | Riga di dettaglio: norma di riferimento, ente, contenuto |
| **Richiesto** a tutti / facoltativo | Se facoltativo, la sua assenza non segnala nulla |
| **Bloccante** sì/no | Se manca, è scaduto o respinto rende il fornitore **non assegnabile**. Vale solo per i richiesti: *facoltativo e bloccante* è contraddittorio e il portale lo corregge dicendolo |
| **Chi può vederlo** | *Righi e il fornitore* oppure *solo Righi*: un tipo riservato sparisce dal profilo del fornitore, che non lo vede e non lo può inviare |
| **Avviso di scadenza** sì/no | Spento, il documento resta «in regola» fino al giorno della scadenza |
| **Giorni di anticipo** | Per tipo, non globale: un DURC quadrimestrale e una polizza annuale non si preavvisano allo stesso modo |
| **Validità (mesi)** | Propone la nuova scadenza quando si registra un rinnovo |

Prima di salvare, il portale dice **quanti fornitori cambiano stato** (es. *«8
diventano non assegnabili»*): una regola che cambia la qualifica di decine di
fornitori non deve farlo di nascosto. Un tipo che non serve più si **disattiva**
(esce dalla qualifica, ma i documenti già registrati restano e tornano a contare
se lo si riattiva); si **elimina** solo se nessun fornitore l'ha mai consegnato.

Di partenza: **bloccanti** DURC, polizza RCT/RCO, idoneità tecnico-professionale
(art. 26 D.Lgs. 81/08) e visura camerale; **richiesti non bloccanti** informativa
privacy firmata e — riservata a Righi — la scheda di valutazione fornitore;
**facoltativi** ISO 9001 e ISO 45001.

La qualifica **non è un campo che si digita**: è calcolata dai documenti e dal
registro, e **agisce sull'operatività**:

- un **bloccante** mancante, scaduto o respinto rende il fornitore **non
  assegnabile**: sparisce dai **fornitori suggeriti**, viene saltato
  dall'**assegnazione ottima** e l'**assegnazione manuale è bloccata** con il
  motivo esplicito (il controllo vale anche sulla chiamata diretta, non solo
  nascondendo il pulsante);
- un **richiesto non bloccante** che manca lascia il fornitore *qualificato con
  riserva*: si segnala, il lavoro non si ferma;
- gli esclusi **non spariscono in silenzio**: nel modulo di invito compare quanti
  sono e perché;
- un documento **in scadenza** (nei giorni di preavviso del suo tipo) **avvisa**
  ma non blocca;
- in **Dashboard** un indicatore conta i *fornitori non in regola* e porta
  all'elenco già filtrato; nell'elenco ogni scheda ha il proprio badge.

**Chi fa cosa**: il **fornitore** vede **solo i propri** documenti — e fra questi
solo i tipi non riservati — con scadenze, stato e l'etichetta che dice se quel
documento è bloccante; può **comunicare un rinnovo**, che entra *in verifica*. Il
**responsabile QHSE** è il titolare della materia: configura il registro,
registra, **verifica o respinge** (il fornitore riceve la notifica con il
motivo). Il **responsabile di produzione** può fare le stesse cose. Il
**caposquadra consulta** ma non modifica, in linea con la regola
dell'anagrafica.

I **motivi sono filtrati per chi legge**: se a bloccare o a mettere in riserva è
un documento riservato, il fornitore è avvisato che *esiste* un documento gestito
da Righi non in regola, ma **non ne legge il nome** — la valutazione interna resta
interna. Se un fornitore non è in regola lo vede scritto dal suo profilo, con
l'avviso che non riceverà nuove commesse finché non provvede: quelle in corso
proseguono.

**L'intestazione dei numeri (il cartiglio)**: in cima ai cruscotti non c'è la
fila di riquadri con il numerone — la firma di qualunque pannello generato, che
informa poco. C'è il **cartiglio**, il riquadro che ogni tavola di disegno
tecnico porta con sé: campi etichettati e incolonnati, filetti sottili, numeri a
spaziatura fissa. Occupa **la metà dello spazio**, sta su una riga sola, ed è
raggiungibile da tastiera (ogni cella è un pulsante). Sopra le celle una
**striscia proporzionale** mostra come è distribuito il lavoro — da approvare, da
assegnare, attive, consegnate — cosa che i quattro numeri non dicevano.

**Ruoli e accessi (lato Righi)**
- **Responsabile di produzione**: vede **tutte** le commesse, pubblica, assegna,
  importa/esporta, governa il carico dei fornitori e **approva** le commesse
  proposte dai capisquadra.
- **Caposquadra**: vede in Dashboard e Commesse **solo i progetti che segue** e
  le relative richieste. Può **proporre un nuovo lavoro**, che invia al
  responsabile per l'approvazione (non pubblica direttamente). Vede inoltre il
  **carico di tutti i fornitori** (scheda Fornitori) per capire chi è libero.
- **Responsabile QHSE** (Qualità, Sicurezza, Ambiente): presidia **solo la parte
  documentale**. Vedi sotto.

**Profilo QHSE — il presidio documentale**

Decidere *chi può* lavorare per Righi e decidere *chi riceve* il lavoro sono due
mestieri diversi. Il portale li tiene separati: il QHSE ha un profilo suo, con
tre schede e nessun accesso alle commesse.

| Scheda | Cosa contiene |
|---|---|
| **Qualifica** | Il cruscotto e la coda di lavoro: quanti fornitori sono fermi, quanti con riserva, quanti documenti attendono verifica, quanti stanno per scadere. Sotto, i documenti **da verificare** con i pulsanti per farlo e i **fornitori fermi** con il motivo e le commesse che hanno già in corso |
| **Scadenzario** | Tutti i documenti dei fornitori attivi in un elenco solo, **ordinato per urgenza**: prima gli scaduti e i respinti, poi i mancanti, le verifiche pendenti, le scadenze in arrivo. Filtri per stato, ricerca per fornitore o documento, filtro **solo bloccanti** |
| **Fornitori** | L'anagrafica in sola lettura, da cui aprire la scheda documentale di ciascuno. Niente carico ore: è pianificazione di produzione, non materia sua |

**Cosa può fare**: definire i **tipi di documento** (compreso quali bloccano),
**registrare** e **rinnovare** documenti, **verificarli o respingerli**,
esportare in CSV lo scadenzario (per i solleciti) e il riepilogo qualifica (per
audit e riesame della direzione).

**Cosa non può fare**: pubblicare, assegnare, approvare commesse, extra,
slittamenti o consegne; modificare l'anagrafica commerciale (tariffe, capacità,
preferenze). Non è solo una questione di pulsanti nascosti: le funzioni di
produzione **rifiutano** la sua chiamata anche se raggiunte per altra via.

Il **responsabile di produzione** conserva l'accesso documentale — è il ruolo
apicale, e un'azienda piccola non può fermarsi quando il QHSE è assente. Quando
un fornitore comunica un rinnovo, l'avviso arriva a **entrambi**: la notifica
segue chi ha il potere di agire, non un ruolo fissato nel codice.

**Anagrafica profili e accessi**

I profili non sono etichette sparse: vivono in un **registro unico** da cui
derivano l'etichetta nella barra in alto, la voce che si legge nella schermata di
accesso e in *cambia utente*, i pulsanti del modulo di creazione e la legenda
dell'anagrafica. Aggiungere un profilo vuol dire aggiungere **una riga lì**, non
toccare cinque punti e dimenticarne uno.

Da **cambia utente · Anagrafica profili e accessi** (riservato al responsabile di
produzione) vedi tutti gli accessi con il loro profilo, più la legenda di cosa
ciascun profilo può e non può fare. Due azioni, entrambe con effetto immediato:

- **Cambia profilo** — i permessi seguono subito. Passando a caposquadra
  l'accesso riceve una squadra; uscendone la perde, perché non se la porta dietro.
- **Disattiva / riattiva** — un accesso disattivato **non entra** (il rifiuto è
  nella funzione di accesso, non solo nella riga grigia), non ha alcun permesso e
  **non riceve notifiche**. Resta in elenco, marcato *non attivo*, e si riattiva
  quando serve.

Due protezioni: non puoi agire sull'**accesso che stai usando**, e non puoi
lasciare il portale **senza un responsabile di produzione attivo** — né
disattivandolo né declassandolo.

Anche la schermata di accesso è ora **raggruppata per profilo**: chi entra vede
subito in che veste sta entrando.

**Flusso di approvazione**: quando un caposquadra compila *Nuovo lavoro* e preme
**Invia per approvazione**, la commessa entra in stato **Da approvare** (mai
visibile ai fornitori). Il responsabile la trova in Dashboard e nel filtro
omonimo: **Approva e pubblica** (diventa visibile ai fornitori, con notifica al
caposquadra) oppure **Rimanda** con una nota di revisione. Nessun passaggio
resta scoperto: la commessa rimanda sempre a un'azione possibile.

**Stati della commessa**: il ciclo di vita è **Bozza** (in preparazione, non
visibile ai fornitori) → **Da approvare** (proposta di un caposquadra in attesa
del responsabile) → **Da assegnare** (pubblicata ai fornitori, raccoglie le
accettazioni) → **Assegnato** (affidata a un fornitore: da qui valgono le date
operative e gli alert di ritardo) → **In corso** (ci passa **da sola** al primo
aggiornamento di avanzamento del fornitore, che avvisa il caposquadra) →
**Consegnato** (quadro finito rientrato in Righi) → **Chiuso** (Righi preme
**Chiudi la pratica**: esce dalle attive e resta consultabile col filtro
*Chiuse*). Ogni passaggio ha chi lo compie: nessuno stato è irraggiungibile. Il
badge colorato è lo stesso in bacheca, in cima a ogni commessa e nella guida in
app, che ora **spiega ogni stato** in una sezione dedicata per ciascun ruolo (il
fornitore la vede dalla sua prospettiva: *Proposta → In attesa di Righi →
Assegnata a te → Consegnata*).

**Guida in app**: il pulsante **?** in alto apre una guida **passo-passo**
diversa per Responsabile, Caposquadra e Fornitore. Quella del **fornitore** è
esaustiva (bacheca, quotazione, accettazione con firma, avanzamento, richieste
guidate con foto, profilo e metriche) e include una sezione **domande frequenti**.
Chiude, per tutti i ruoli, la legenda dei **suoni**.

**Suoni**: **tredici** suoni, uno per tipo di evento, così si capisce cosa è
successo **senza guardare lo schermo** — mentre si è al telefono o si cammina in reparto. Sono
tutti **sintetizzati** dal portale (nessun file audio da scaricare) e seguono
una grammatica semplice: **chi sale è andato avanti** (accettazione,
approvazione, avanzamento, richiesta inviata), **chi scende è stato fermato**
(diniego, azione bloccata). L'**assegnazione** è l'unico suono con la coda
lunga — tre note che salgono e si chiudono in alto: è il momento per cui il
portale esiste. Sono brevi per scelta (90 ms per un tocco, 250–350 ms per una
conferma) e a volume basso: confermano, non annunciano. L'**altoparlante** nella
barra in alto li spegne e li riaccende, e la scelta resta memorizzata sul
dispositivo. Nulla suona al caricamento o navigando tra le schede: il suono
segue solo un'azione. Il repertorio completo, con la forma di ogni suono, è in
[`SPECIFICHE.md` §3.11](SPECIFICHE.md).

**Notifiche ed email**: ogni evento (pubblicazione, notifica mirata, richiesta
guidata, risposta) genera una **notifica in app**; dove serve comunicare fuori
dal portale è disponibile l'**email precompilata** (destinatario, oggetto e
corpo pronti) verso fornitori e caposquadra. Quando l'email è rivolta a **più
fornitori** non si usa una copia nascosta: si prepara **un messaggio personale
per ciascuno**, con il **suo** link diretto e il **solo** suo indirizzo — ancora
più riservato del Ccn, perché ogni email ha un unico destinatario. L'invio
automatico lato server è la naturale evoluzione (vedi `BACKEND.md`).

**Extra (lavorazioni in più)**: se durante la produzione serve qualcosa che non
era nell'accordo (materiale aggiuntivo, lavorazione non prevista, modifica del
layout, rilavorazione), il fornitore invia una **richiesta di extra** con
**importo** e una **descrizione obbligatoria** — senza descrizione non è
valutabile. Righi la approva, la rifiuta oppure **conferma un importo diverso**
(la contro-proposta è il caso più frequente). Regole:

- **Soglia del 10%**: fino al 10% dell'importo concordato decide il
  **caposquadra**; oltre serve il **responsabile di produzione**, così le
  decisioni che pesano davvero sul valore della commessa restano centrali.
- **Le ore contano**: approvando, Righi indica anche le **ore aggiuntive** (dato
  riservato, mai esposto al fornitore). Entrano in **carico e capacità**: senza,
  la pianificazione mostrerebbe più spazio libero di quanto ce n'è davvero. Se
  l'extra sposta la riconsegna, si può aggiornare il **rientro** nello stesso
  passaggio (con storico e notifica).
- **Niente conti aperti a lavoro finito**: un extra ancora da decidere **blocca
  l'approvazione a consegnare**. Si chiude prima, quando c'è ancora margine per
  discuterne.
- L'extra approvato entra nell'**importo della commessa** e nell'**export per
  l'ERP**, che ora distingue `importo_base`, `extra_approvati` e
  `importo_finale`. Nelle metriche compaiono **quota di commesse con extra** e
  **scostamento dal concordato**: numeri oggettivi, uguali per Righi e fornitore.

**Risposte al fornitore — avviso automatico**: quando Righi invia una **risposta
rapida**, approva/rifiuta uno **slittamento** o l'**approvazione a consegnare**,
il fornitore riceve *due* cose: la **notifica nel portale** e, in automatico,
un'**email di avviso** che contiene il testo della risposta e il **link diretto**
a quella richiesta. Così anche chi vive nella posta elettronica vede la risposta
e con un clic torna nel portale per replicare. L'avviso si può disattivare per la
singola richiesta con l'interruttore *Avviso automatico via email*; la notifica
in app parte comunque. Nel prototipo l'email si apre già compilata nel programma
di posta (basta premere Invia); in produzione parte da sola lato server.

**Consegna delle notifiche garantita**: le notifiche ai fornitori venivano perse
se il fornitore non aveva ancora un accesso al portale (solo alcuni sono
pre-creati nella demo). Ora la notifica viene **indirizzata comunque**, senza
creare accessi in anticipo: l'accesso nasce quando il fornitore entra con il suo
link e trova le notifiche **già lì ad aspettarlo**. Così assegnazioni, risposte,
cambi data ed esiti arrivano **sempre**, e la schermata di accesso resta pulita.

**Il link non è una scorciatoia ai permessi**: un codice commessa non è una
password. Aprendo un link, il portale verifica sempre che quell'utente abbia il
diritto di vedere quella commessa (o quella richiesta): un fornitore **non** può
aprire il lavoro di un altro nemmeno conoscendone il codice, e riceve un avviso
esplicito invece del contenuto. Allo stesso modo un **accesso disattivato non
rientra dal link**: il collegamento identifica, non riapre una porta chiusa.

**Link diretto al portale (magic link)**: ogni email contiene, nel corpo, un
**link che apre il portale già identificati e direttamente sulla pagina finale**
— la commessa da accettare, la richiesta da gestire — pronta all'azione, **senza
passare dal login**. Un solo clic, niente password. Serve a portare dentro al
portale anche chi è abituato a lavorare via email: dall'email si arriva subito al
punto in cui rispondere. Anche l'invio a **più fornitori** è personalizzato: ogni
destinatario riceve il **suo** link diretto (e non vede gli indirizzi degli
altri), così nessuno finisce sul login. Il link vale sia per i fornitori sia per
gli utenti Righi (es. il caposquadra che apre una richiesta da gestire). Nel
prototipo l'accesso è sul dispositivo; in produzione il link porta un **token
firmato e a scadenza** verificato dal server (vedi `BACKEND.md`).

**Visibilità dei lavori**: un fornitore vede i lavori proposti secondo la
visibilità (*tutti* o *selezionati*), ma **appena un lavoro viene assegnato
resta visibile solo all'assegnatario** — gli altri fornitori non vedono le
commesse affidate a terzi. Lato Righi vedono le commesse il **responsabile di
produzione** (tutte) e il **caposquadra** (le proprie); il **QHSE** non le vede
affatto, perché il suo perimetro è documentale.

**Mobile**: interfaccia mobile-first. Su smartphone la vista massiva dei lavori
diventa una **lista di schede compatte tap-friendly** (niente tabelle da
scorrere in orizzontale), le finestre si aprono come *bottom sheet* e i comandi
rispettano le aree di sicurezza del dispositivo.

**Metriche fornitore — oggettive e condivisibili**: sono **calcolate dai
lavori** (nessun voto soggettivo), quindi **trasparenti** e **identiche** lato
Righi e lato fornitore: **puntualità**, **lavori/mese**, **richieste sollevate**,
**tasso di accettazione**, **tempo di risposta** e **ritardo medio**, con
mini-trend. Le **ore** e la **saturazione via ore** restano **solo a Righi**
(che governa il carico): al fornitore, al loro posto, si mostra l'**importo**
dei progetti (valore attivo e consegnato). Nessuna "valutazione" arbitraria —
se un dato non è oggettivo e verificabile, non viene mostrato.

**Tre date per commessa (e chi le vede)**: ogni commessa distingue
**inizio lavori stimato** (quando si prevede di avviare la produzione),
**rientro in Righi richiesto** (riconsegna del quadro finito) e **consegna al
cliente**. Le prime due sono **visibili anche al fornitore**; la **consegna al
cliente è riservata a Righi** e non compare mai lato fornitore. Gli **alert di
ritardo** si basano sulle date operative del fornitore — *inizio in ritardo*
(assegnata ma non avviata oltre l'inizio stimato) e *rientro in ritardo* (oltre
la data di rientro) — **mai** sulla consegna al cliente. Carico fornitori,
puntualità e ordinamento seguono la data di **rientro**. A queste si aggiunge la
**data di pubblicazione** (quando la commessa è pubblicata ai fornitori),
impostata **in automatico** e **riservata a Righi** (sostituisce la vecchia
"data richiesta", che era solo informativa).

**Slittamenti e modifica date**: dal dettaglio commessa il fornitore può
chiedere uno **slittamento** (nuova data di **rientro** + motivo) che il
caposquadra **approva/rifiuta** (se approvato sovrascrive il rientro e notifica);
Righi può **modificare direttamente** rientro, inizio stimato e consegna al
cliente. Ogni cambio di rientro resta nello **storico**.

**Dati reali dei fornitori**: l'anagrafica è popolata dalla *Mappatura fornitori
2026* — **54 fornitori** (di cui **28 attivi**, flag `attivo`), con **capacità
ore/mese**, **cablatori**, **risorse dedicate a Righi**, **costo orario**,
**contatti**, note e — dato chiave — la **percentuale di utilizzo preferenziale
per ciascun OTL/caposquadra**. I dati mancanti nel file (tipologie, ingombro,
attrezzature, sede per alcuni) sono "non specificati" e completabili in app;
dove le note lo permettono sono dedotti.

**Assegnazione intelligente**: in assegnazione il portale ordina i fornitori per
idoneità combinando la **preferenza dell'OTL della commessa** (la % del file:
chi ha % più alta per quel caposquadra sale in classifica), specializzazione,
settore, certificazioni, **limite di spazio** (con avviso "**spazio
insufficiente**" se la commessa indica l'ingombro previsto), **attrezzature**,
**capacità libera** nel mese, **costo** e **puntualità**. Concorrono **solo i
fornitori attivi**; i sovraccarichi sono segnalati e il **semaforo**
verde/giallo/rosso anticipa i ritardi. Per evitare click accidentali, l'azione
**Assegna** chiede sempre una **conferma** ("Assegnare la commessa X a Y?")
prima di procedere.

**Assegnazione ottima (in blocco)**: dal riquadro *Da valutare* il responsabile
può premere **Assegna in modo ottimo**: il portale risolve un **matching di peso
massimo sul grafo bipartito** commesse–fornitori (solo chi ha accettato),
rispettando le **ore libere per fornitore e mese di rientro**, e presenta la
**proposta** (assegnazioni, idoneità totale, commesse non collocabili) da
**confermare** in un colpo solo. Il fornitore aggiorna l'**avanzamento con un
tocco** (materiale, cablaggio, collaudo, pronto).

**Mappa fornitori** (in *Fornitori → Mappa*): pin colorati per carico del mese
su tutto il **Nord-Centro Italia** (i fornitori sono accreditabili in oltre 35
città, dal Piemonte alle Marche); tocca un pin per scheda e capacità libera. Da
caposquadra evidenzia le **zone già presidiate** per accorpare i lavori e ridurre
le trasferte.

**Analisi** (scheda dedicata, scopata per ruolo): un **cruscotto** con sei
grafici sulle commesse — **consegne per mese** (carico pianificato e quota ancora
da assegnare), **pipeline per stato**, **salute** delle commesse attive (semaforo
aggregato), **andamento puntualità**, **mix per tipologia** e **carico per
caposquadra**, più il **collo di bottiglia della capacità**. I grafici
categoriali sono **cliccabili** e aprono l'elenco già filtrato. Colori validati
per la leggibilità (anche in caso di daltonismo o stampa: etichette, trama sulle
barre critiche e gap tra i segmenti).

**Collo di bottiglia della capacità (max-flow / min-cut)**: sulle commesse da
assegnare con accettazioni, per **mese di rientro**, il portale risolve un
**flusso a costo di capacità** (sorgente → commesse → fornitori → pozzo con
capacità = ore libere) e ne calcola il **taglio minimo**: dice **quante ore di
domanda non sono collocabili** e **quali fornitori sono il vincolo** (saturi e
determinanti). Se lo scoglio non è la capacità ma lo **spazio/le accettazioni**,
lo segnala. Serve a decidere dove **aumentare capacità o accreditare** fornitori.

**Lato Fornitore**
- **Bacheca**: i lavori proposti da Righi con le **lavorazioni** previste; **fai
  una domanda** con un tocco oppure **Accetta**, confermando con una **firma
  leggera** a tuo nome (Righi vede il timbro *firmato* con data e ora); il
  **layout** per la quotazione è in evidenza.
- **I miei lavori**: commesse acquisite e consegne, con **avanzamento a un
  tocco**. Per consegnare serve l'**approvazione del caposquadra**: premi
  **Richiedi approvazione consegna**; solo dopo l'ok compare **Segna consegnato**
  (senza approvazione la consegna è bloccata).
- **Richieste guidate**: contatta il **caposquadra** seguendo la prassi Righi
  (dubbio tecnico, mancanza materiale, ritardo, chiarimento layout, **richiesta
  di approvazione consegna**…) — la notifica arriva subito al referente. Con il
  tipo **Altro** la nota di testo diventa **obbligatoria** (il campo si segna
  come tale), così una richiesta generica arriva sempre con una descrizione utile.

**Nuovo utente / accesso**: dalla schermata di accesso o dal menu *cambia
utente* si crea un nuovo accesso scegliendo il **profilo** — responsabile di
produzione, OTL/caposquadra, **QHSE** o fornitore collegato a un fornitore. Il
modulo spiega uno per uno cosa ciascun profilo può fare, e l'accesso nasce con
l'etichetta presa dal registro dei profili, non scritta a mano.

## Struttura

| Percorso | Contenuto |
|---|---|
| `index.html` | L'app (PWA) — CSS e JS inline, nessun asset esterno. **Sorgente unico di verità** |
| `manifest.json`, `sw.js`, `logo.svg` | PWA: installazione, offline, icona |
| `Portale_Fornitori_Righi.html` | Copia autosufficiente per la prova offline: è una **fotografia**, va rigenerata a ogni modifica |
| `SPECIFICHE.md` | Specifiche funzionali, organizzative e tecniche, con i diagrammi |
| `Specifiche_Portale_Fornitori_Righi.docx` | Le stesse specifiche in Word, con copertina, indice e diagrammi come immagini |
| `PIANO_PRODOTTO.md` | Piano di prodotto, sintesi ricerca, roadmap avanzata |
| `BACKEND.md` | Contratto backend: accessi (auth) + sync multi-utente |
| `tests/` | Suite native Node (`node tests/run_all.js`) |

## Test

```bash
cd portale-fornitori && node tests/run_all.js
```

Nessuna dipendenza esterna: le suite estraggono i blocchi puri da `index.html` e
li eseguono in un sandbox, senza DOM.

| Suite | Copre |
|---|---|
| `node --check` | La sintassi dello script estratto da `index.html` |
| **`model_test.js`** (96) | Visibilità dei lavori, ritardi e alert, metriche, capacità, **qualifica** e registro dei tipi di documento, **profili di accesso** e permessi, scadenzario, matching ottimo, flusso massimo e taglio minimo, integrità del seed |
| **`sync_test.js`** (6) | Il contratto del seam remoto (pull/push, versioni) |
| **`sfx_test.js`** (26) | I **suoni**, registrando la sintesi voce per voce: scala, timbro, durate, volumi, direzione melodica e firma distinta per ogni funzionalità |

Oltre alle suite native, lo sviluppo usa prove **end-to-end** in browser vero
(Playwright) e tre **passate di audit** che percorrono tutte le schermate di
tutti i profili controllando riservatezza, invarianti, persistenza e coerenza dei
numeri. Non stanno nel repository perché richiedono un browser; i loro esiti sono
riassunti in [`SPECIFICHE.md` §4.6](SPECIFICHE.md).

**Criteri fissi** applicati a ogni modifica: nessuna funzione vuota, nessun
pulsante privo di effetto, nessun gestore orfano, nessuna emoji in `index.html`,
nessun elemento fuori schermo da 320 a 1600 px.

## Dati e privacy

Prototipo dimostrativo: i dati (utenti demo, lavori, richieste) restano **sul
dispositivo** nello storage del browser. Nessun invio a server. Il passaggio a
un backend cloud multi-utente è descritto in [`BACKEND.md`](BACKEND.md); il
client ha già il *seam* di sync pronto e testato.
