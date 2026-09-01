# TimesFM 3.0 — runner

Ambiente pronto per eseguire [`google/timesfm-3.0-pytorch`](https://huggingface.co/google/timesfm-3.0-pytorch),
il modello fondazionale per serie storiche di Google Research (TimesFM 3.0,
agosto 2026): decoder-only, multivariato nativo, con covariate past-only e
past-and-future, previsione puntuale + 9 quantili (0.1 … 0.9).

| | |
|---|---|
| Pacchetto | `timesfm==3.0.0` (PyPI), API `timesfm3` |
| Architettura checkpoint 3.0 | 20 layer × 1280 dim, 16 teste — **330,7 M parametri** |
| Patch | input 32, output 64 · contesto massimo **15 360** passi |
| Codice | Apache-2.0 |
| **Pesi 3.0** | **`timesfm-non-commercial-license-v1.0` — solo uso non commerciale e non di produzione** |

> La licenza dei pesi 3.0 è il vincolo più importante: per un uso commerciale
> servono i checkpoint fino alla 2.5 (Apache-2.0) o un accordo con Google.

## Stato in questo ambiente (sessione remota Claude Code)

| Passo | Esito |
|---|---|
| Installazione `timesfm[torch]==3.0.0` (torch 2.13.0, Python 3.11) | ✅ |
| Costruzione dell'architettura reale 3.0 (330,7 M parametri) | ✅ |
| Percorso di inferenza completo: univariato, multivariato, covariate, quantili | ✅ `smoke_test_offline.py` |
| Inferenza CPU (contesto 256, orizzonte 24, 3 serie) | ✅ 0,4–0,6 s per batch |
| Download dei pesi da `huggingface.co` | ❌ **403 Forbidden** |

`huggingface.co` non è raggiungibile: il proxy di egress della sessione
risponde `403` alla CONNECT (criterio di rete dell'organizzazione, non un
errore transitorio). Tutto il resto gira; manca solo il checkpoint, quindi qui
**non esistono previsioni reali** — solo la verifica che la pipeline funziona.

Per sbloccare, una delle due:

1. **Abilitare `huggingface.co`** nella policy di rete dell'ambiente
   (Claude Code on the web → impostazioni ambiente / rete), poi
   `python run_timesfm.py --demo --horizon 24`.
2. **Portare i pesi a mano**: scaricarli su una macchina con rete e passarli
   come directory locale (vedi sotto). Il repo dei pesi 3.0 è soggetto ad
   accettazione della licenza: serve un token HF (`--hf-token` o `HF_TOKEN`).

```bash
# su una macchina con accesso a Hugging Face
pip install -U huggingface_hub
hf download google/timesfm-3.0-pytorch --local-dir ./pesi-timesfm3
# poi, ovunque, senza rete:
python run_timesfm.py --demo --horizon 24 --checkpoint ./pesi-timesfm3 --local-only
```

## Installazione

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

Su macchine senza GPU conviene la ruota CPU di PyTorch (~4 GB in meno di
librerie CUDA), se l'indice è raggiungibile:

```bash
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install "timesfm==3.0.0" pandas
```

## Uso

```bash
# serie sintetiche di prova
python run_timesfm.py --demo --horizon 24 --report report.html

# una serie da CSV
python run_timesfm.py --csv examples/vendite.csv --time-col data \
    --value-col vendite --id-col negozio --horizon 28 --out previsioni.csv

# backtest: gli ultimi 28 punti diventano verità, con metriche
python run_timesfm.py --csv examples/vendite.csv --id-col negozio \
    --value-col vendite --horizon 28 --backtest --seasonality 7

# multivariato congiunto su più colonne
python run_timesfm.py --csv serie_wide.csv --value-cols milano,torino --horizon 14

# covariate note nel futuro (promo pianificate, meteo previsto):
# il CSV ha 28 righe finali con `vendite` vuoto e le covariate valorizzate
python run_timesfm.py --csv examples/vendite_con_covariate.csv \
    --value-col vendite --future-cov-cols promo,meteo --horizon 28
```

Opzioni principali: `--horizon`, `--context` (max 15 360), `--batch-size`,
`--device`, `--no-quantiles`, `--allow-negative`, `--univariate`,
`--out` (CSV), `--report` (HTML autosufficiente con grafico), `--json`.
`python run_timesfm.py --help` per l'elenco completo.

### Formato di output

`--out` produce una riga per (serie, variabile, passo) con `forecast`
(mediana), `q10 … q90` e, in backtest, la colonna `reale`.
Le metriche del backtest sono MAE, RMSE, sMAPE, MASE (naive stagionale con
periodo `--seasonality`) e WQL (weighted quantile loss).

## File

| File | Ruolo |
|---|---|
| `run_timesfm.py` | CLI di previsione (CSV o demo, backtest, report) |
| `smoke_test_offline.py` | verifica che il modello giri senza scaricare nulla: costruisce l'architettura 3.0 con pesi casuali, la salva e ci fa girare l'inferenza |
| `examples/vendite.csv` | 2 negozi × 400 giorni, stagionalità settimanale e annuale |
| `examples/vendite_con_covariate.csv` | serie singola + covariate note nel futuro (`promo`, `meteo`) |
| `requirements.txt` | dipendenze fissate |

```bash
python smoke_test_offline.py          # architettura ridotta, ~3 s
python smoke_test_offline.py --full   # architettura reale 3.0, ~30 s su CPU
```

`smoke_test_offline.py` usa **pesi casuali**: verifica che il codice giri,
non produce previsioni sensate.
