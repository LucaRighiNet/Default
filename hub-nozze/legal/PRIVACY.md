# Informativa privacy — Hub Nozze (bozza)

Bozza/template da completare e validare con un legale prima della vendita in UE.
Segnaposto tra [ ].

Titolare del trattamento: [Ragione sociale / nome, indirizzo, email].

## Dati trattati
- Dati dell'account (email) per autenticazione e sincronizzazione.
- Dati dell'evento inseriti dagli sposi: budget, fornitori, tavoli, timeline.
- Dati degli ospiti inseriti dagli sposi: nome, lato, nucleo, RSVP, menù,
  intolleranze/allergie, esigenze di accessibilità, +1. Alcuni possono essere
  dati particolari (salute/dieta): raccogliere solo se necessario e con base
  giuridica adeguata (consenso dell'interessato).

## Basi giuridiche
- Esecuzione del servizio (art. 6.1.b GDPR) per i dati degli sposi.
- Consenso (art. 6.1.a) e, per i dati particolari, art. 9.2.a, per i dati degli
  ospiti raccolti dagli sposi. Gli sposi sono responsabili di informare gli ospiti.

## Conservazione
Per la durata dell'account/evento; cancellazione su richiesta o alla chiusura.

## Sub-responsabili (quando attivi)
- Hosting/DB e autenticazione: [Supabase, regione UE].
- Pagamenti: [Stripe].
- Error tracking: [servizio], solo dati tecnici.
Con ciascuno va stipulato un DPA. Dati in UE.

## Diritti dell'interessato
Accesso, rettifica, cancellazione, portabilità, opposizione. L'app offre export
dei dati (JSON) e cancellazione dell'evento. Contatti: [email].

## Sicurezza
Cifratura in transito e at-rest; isolamento per-evento (RLS); backup.

## Minori
Dati di bambini (es. menù bambino) trattati solo come parte della lista ospiti
fornita dagli sposi.
