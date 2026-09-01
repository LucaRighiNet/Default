#!/usr/bin/env python3
"""Runner da riga di comando per TimesFM 3.0 (`google/timesfm-3.0-pytorch`).

Copre i casi d'uso principali del modello:
  * previsione univariata (una o piu' serie in batch),
  * previsione multivariata congiunta su piu' colonne,
  * covariate past-only e past-and-future,
  * quantili 0.1 ... 0.9 oltre alla previsione puntuale,
  * backtest con holdout finale e metriche (MAE, RMSE, sMAPE, MASE, WQL).

Esempi:
  python run_timesfm.py --demo --horizon 24
  python run_timesfm.py --csv dati.csv --time-col data --value-col vendite --horizon 12
  python run_timesfm.py --csv dati.csv --id-col serie --value-col y --horizon 12 --backtest
  python run_timesfm.py --csv dati.csv --value-cols nord,centro,sud --horizon 24
  python run_timesfm.py --checkpoint ./pesi-timesfm3 --local-only --demo

Il checkpoint di default viene scaricato da Hugging Face; per ambienti senza
rete verso huggingface.co si passa una directory locale con
`--checkpoint /percorso/dir --local-only` (vedi README.md).
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np

# Limite di contesto del modello 3.0 (in passi temporali).
MAX_CONTEXT = 15360
DEFAULT_CHECKPOINT = "google/timesfm-3.0-pytorch"


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #
def build_parser() -> argparse.ArgumentParser:
  p = argparse.ArgumentParser(
    description="Esegue TimesFM 3.0 su una serie storica (CSV o demo sintetica).",
    formatter_class=argparse.ArgumentDefaultsHelpFormatter,
  )
  src = p.add_argument_group("sorgente dati")
  src.add_argument("--csv", type=Path, help="file CSV di input")
  src.add_argument("--demo", action="store_true",
                   help="usa serie sintetiche invece di un CSV")
  src.add_argument("--time-col", help="colonna con il timestamp (solo etichette)")
  src.add_argument("--value-col", help="colonna del valore da prevedere")
  src.add_argument("--value-cols",
                   help="piu' colonne separate da virgola: previsione multivariata congiunta")
  src.add_argument("--id-col",
                   help="colonna identificativa: ogni gruppo e' una serie separata (batch)")
  src.add_argument("--past-cov-cols",
                   help="covariate note solo nel passato, separate da virgola")
  src.add_argument("--future-cov-cols",
                   help="covariate note anche nel futuro, separate da virgola; "
                        "il CSV deve contenere `horizon` righe finali con target vuoto")

  mdl = p.add_argument_group("modello")
  mdl.add_argument("--checkpoint", default=DEFAULT_CHECKPOINT,
                   help="repo Hugging Face, directory locale o file .safetensors/.pth")
  mdl.add_argument("--local-only", action="store_true",
                   help="vieta qualsiasi download: usa solo file gia' presenti in locale")
  mdl.add_argument("--hf-token",
                   help="token Hugging Face (il repo dei pesi 3.0 richiede di accettare "
                        "la licenza); in alternativa la variabile d'ambiente HF_TOKEN")
  mdl.add_argument("--device", help="cuda, cpu, mps... (default: auto)")
  mdl.add_argument("--batch-size", type=int, default=4,
                   help="serie processate insieme in un forward")

  fcs = p.add_argument_group("previsione")
  fcs.add_argument("--horizon", type=int, default=24, help="passi da prevedere")
  fcs.add_argument("--context", type=int, default=MAX_CONTEXT,
                   help=f"passi di storico usati, al massimo {MAX_CONTEXT}")
  fcs.add_argument("--no-quantiles", action="store_true",
                   help="restituisce solo la previsione puntuale (mediana)")
  fcs.add_argument("--univariate", action="store_true",
                   help="con --value-cols: prevede ogni colonna in modo indipendente")
  fcs.add_argument("--allow-negative", action="store_true",
                   help="non azzera le previsioni negative")
  fcs.add_argument("--backtest", action="store_true",
                   help="tiene gli ultimi `horizon` punti come verita' e calcola le metriche")
  fcs.add_argument("--seasonality", type=int, default=1,
                   help="periodo stagionale usato dal naive di riferimento nel MASE")

  out = p.add_argument_group("output")
  out.add_argument("--out", type=Path, help="scrive le previsioni in CSV")
  out.add_argument("--report", type=Path, help="scrive un report HTML autosufficiente")
  out.add_argument("--json", dest="json_out", type=Path, help="scrive metriche/riepilogo in JSON")
  out.add_argument("--quiet", action="store_true", help="stampa solo l'essenziale")
  return p


# --------------------------------------------------------------------------- #
# Dati
# --------------------------------------------------------------------------- #
class Series:
  """Una serie da prevedere: target (V, T) piu' eventuali covariate."""

  def __init__(self, ts_id, target, labels=None, past_cov=None, future_cov=None,
               col_names=None):
    self.ts_id = ts_id
    self.target = np.asarray(target, dtype=np.float32)
    if self.target.ndim == 1:
      self.target = self.target[None, :]
    self.labels = labels
    self.past_cov = None if past_cov is None else np.asarray(past_cov, dtype=np.float32)
    self.future_cov = None if future_cov is None else np.asarray(future_cov, dtype=np.float32)
    self.col_names = col_names or [f"v{i}" for i in range(self.target.shape[0])]
    self.truth = None  # riempito in modalita' backtest


def make_demo_series(horizon: int) -> list[Series]:
  """Tre serie sintetiche con forme diverse (trend, stagionalita', rumore)."""
  rng = np.random.default_rng(20260901)
  t = np.arange(400, dtype=np.float32)

  stagionale = 100 + 20 * np.sin(2 * np.pi * t / 24) + 0.05 * t + rng.normal(0, 2, t.size)
  trend = 50 + 0.4 * t + rng.normal(0, 3, t.size)
  doppia = (
    200
    + 30 * np.sin(2 * np.pi * t / 24)
    + 12 * np.sin(2 * np.pi * t / 168)
    + rng.normal(0, 4, t.size)
  )
  return [
    Series("demo-stagionale", stagionale.astype(np.float32), col_names=["stagionale"]),
    Series("demo-trend", trend.astype(np.float32), col_names=["trend"]),
    Series("demo-doppia-stagionalita", doppia.astype(np.float32), col_names=["doppia"]),
  ]


def _cols(arg: str | None) -> list[str]:
  return [c.strip() for c in arg.split(",") if c.strip()] if arg else []


def load_csv_series(args) -> list[Series]:
  """Costruisce le serie a partire dal CSV secondo le opzioni passate."""
  import pandas as pd

  df = pd.read_csv(args.csv)
  value_cols = _cols(args.value_cols) or ([args.value_col] if args.value_col else [])
  if not value_cols:
    numeric = [c for c in df.columns if np.issubdtype(df[c].dtype, np.number)]
    if len(numeric) != 1:
      raise SystemExit(
        "Indica la colonna da prevedere con --value-col (o --value-cols). "
        f"Colonne numeriche disponibili: {', '.join(numeric) or 'nessuna'}"
      )
    value_cols = numeric
  mancanti = [c for c in value_cols if c not in df.columns]
  if mancanti:
    raise SystemExit(f"Colonne non trovate nel CSV: {', '.join(mancanti)}")

  past_cols, future_cols = _cols(args.past_cov_cols), _cols(args.future_cov_cols)

  def one(sub, ts_id) -> Series:
    # Le righe finali con target vuoto contengono solo le covariate future.
    target_full = sub[value_cols].to_numpy(dtype=np.float32).T  # (V, T)
    is_future = np.all(np.isnan(target_full), axis=0)
    n_future = int(is_future[::-1].argmin()) if is_future.any() else 0
    if n_future and not is_future[-n_future:].all():
      n_future = 0
    n_ctx = target_full.shape[1] - n_future

    target = target_full[:, :n_ctx]
    labels = None
    if args.time_col and args.time_col in sub.columns:
      labels = [str(v) for v in sub[args.time_col].to_numpy()]
    past_cov = sub[past_cols].to_numpy(dtype=np.float32).T[:, :n_ctx] if past_cols else None
    future_cov = sub[future_cols].to_numpy(dtype=np.float32).T if future_cols else None
    return Series(ts_id, target, labels, past_cov, future_cov, col_names=value_cols)

  if args.id_col:
    if args.id_col not in df.columns:
      raise SystemExit(f"Colonna id non trovata: {args.id_col}")
    return [one(sub, str(key)) for key, sub in df.groupby(args.id_col, sort=False)]
  return [one(df, args.csv.stem)]


def prepare(series: list[Series], args) -> list[Series]:
  """Applica il taglio del contesto e, in backtest, isola la verita' finale."""
  ctx = min(args.context, MAX_CONTEXT)
  for s in series:
    if args.backtest:
      if s.target.shape[1] <= args.horizon:
        raise SystemExit(
          f"Serie '{s.ts_id}': servono piu' di {args.horizon} punti per il backtest."
        )
      s.truth = s.target[:, -args.horizon:]
      s.target = s.target[:, :-args.horizon]
      if s.past_cov is not None:
        s.past_cov = s.past_cov[:, :-args.horizon]
      if s.labels:
        s.labels = s.labels[:-args.horizon]
    if s.target.shape[1] > ctx:
      s.target = s.target[:, -ctx:]
      if s.past_cov is not None:
        s.past_cov = s.past_cov[:, -ctx:]
      if s.labels:
        s.labels = s.labels[-ctx:]
    if s.future_cov is not None:
      # Il modello vuole contesto + orizzonte sulle covariate future.
      s.future_cov = s.future_cov[:, -(s.target.shape[1] + args.horizon):]
  return series


# --------------------------------------------------------------------------- #
# Modello
# --------------------------------------------------------------------------- #
def load_forecaster(args, log):
  try:
    import torch
    from timesfm3 import ModelConfig, TimesFM3Evaluator
  except ImportError as exc:  # pragma: no cover - dipende dall'ambiente
    raise SystemExit(
      f"Dipendenza mancante ({exc}). Installa con: pip install 'timesfm[torch]==3.0.0' pandas"
    ) from exc

  device = args.device or ("cuda" if torch.cuda.is_available() else "cpu")
  cfg = ModelConfig(
    checkpoint_path=args.checkpoint,
    per_core_batch_size=args.batch_size,
    device=device,
    local_files_only=args.local_only,
    token=args.hf_token,
  )
  log(f"Carico {args.checkpoint} su {device} ...")
  t0 = time.perf_counter()
  try:
    forecaster = TimesFM3Evaluator(cfg)
  except Exception as exc:  # rete assente, repo non in cache, permessi HF...
    raise SystemExit(
      f"Caricamento del checkpoint fallito: {exc}\n"
      "Se l'ambiente non raggiunge huggingface.co, scarica i pesi altrove e passa\n"
      "  --checkpoint /percorso/alla/directory --local-only"
    ) from exc
  n_par = sum(p.numel() for p in forecaster.model.parameters())
  log(f"Modello pronto in {time.perf_counter() - t0:.1f}s - {n_par / 1e6:.1f}M parametri")
  return forecaster, device, n_par


def forecast(forecaster, series: list[Series], args, log):
  contexts = [s.target if s.target.shape[0] > 1 else s.target[0] for s in series]
  po = [s.past_cov for s in series]
  pf = [s.future_cov for s in series]
  kwargs = dict(
    contexts=contexts,
    horizon=args.horizon,
    ts_ids=[s.ts_id for s in series],
    return_quantiles=not args.no_quantiles,
    make_positive=not args.allow_negative,
    univariate=args.univariate,
  )
  if any(c is not None for c in po):
    kwargs["past_only_covariates"] = po
  if any(c is not None for c in pf):
    kwargs["past_future_covariates"] = pf

  log(f"Previsione: {len(series)} serie x {args.horizon} passi ...")
  t0 = time.perf_counter()
  outputs = list(forecaster.predict_batch(**kwargs))
  dt = time.perf_counter() - t0
  log(f"Fatto in {dt:.2f}s ({dt / max(len(series), 1):.2f}s per serie)")
  return outputs, dt


# --------------------------------------------------------------------------- #
# Metriche
# --------------------------------------------------------------------------- #
def metrics(truth: np.ndarray, pred: np.ndarray, history: np.ndarray,
            quantiles: np.ndarray | None, q_levels: list[float], m: int) -> dict:
  truth = np.asarray(truth, dtype=np.float64).ravel()
  pred = np.asarray(pred, dtype=np.float64).ravel()
  err = pred - truth
  out = {
    "MAE": float(np.mean(np.abs(err))),
    "RMSE": float(np.sqrt(np.mean(err ** 2))),
  }
  denom = np.abs(truth) + np.abs(pred)
  with np.errstate(divide="ignore", invalid="ignore"):
    smape = np.where(denom > 0, 2.0 * np.abs(err) / denom, 0.0)
  out["sMAPE%"] = float(100 * np.mean(smape))

  hist = np.asarray(history, dtype=np.float64).ravel()
  if hist.size > m:
    scala = float(np.mean(np.abs(hist[m:] - hist[:-m])))
    out["MASE"] = float(out["MAE"] / scala) if scala > 0 else float("nan")
  else:
    out["MASE"] = float("nan")

  if quantiles is not None:
    q = np.asarray(quantiles, dtype=np.float64).reshape(-1, len(q_levels))
    perdite = []
    for i, level in enumerate(q_levels):
      d = truth - q[:, i]
      perdite.append(np.mean(np.maximum(level * d, (level - 1) * d)))
    somma = float(np.sum(np.abs(truth)))
    out["WQL"] = float(2 * np.sum(perdite) * truth.size / somma) if somma > 0 else float("nan")
  return out


# --------------------------------------------------------------------------- #
# Output
# --------------------------------------------------------------------------- #
def to_rows(series: list[Series], outputs, q_levels: list[float]) -> list[dict]:
  righe = []
  for s, o in zip(series, outputs):
    f = np.atleast_2d(o.forecast)
    q = None if o.quantiles is None else np.asarray(o.quantiles)
    if q is not None and q.ndim == 2:
      q = q[None, ...]
    for v in range(f.shape[0]):
      nome = s.col_names[v] if v < len(s.col_names) else f"v{v}"
      for h in range(f.shape[1]):
        riga = {"ts_id": s.ts_id, "variabile": nome, "step": h + 1,
                "forecast": float(f[v, h])}
        if q is not None:
          for i, level in enumerate(q_levels):
            riga[f"q{int(level * 100):02d}"] = float(q[v, h, i])
        if s.truth is not None:
          riga["reale"] = float(np.atleast_2d(s.truth)[v, h])
        righe.append(riga)
  return righe


def write_csv(path: Path, righe: list[dict]) -> None:
  import csv
  path.parent.mkdir(parents=True, exist_ok=True)
  with path.open("w", newline="", encoding="utf-8") as fh:
    w = csv.DictWriter(fh, fieldnames=list(righe[0].keys()))
    w.writeheader()
    w.writerows(righe)


def _svg(storia, mediana, lo, hi, reale, larghezza=760, altezza=220) -> str:
  """Grafico a linee inline: coda dello storico, banda 10-90, mediana, reale."""
  n_s, n_f = len(storia), len(mediana)
  tutti = list(storia) + list(mediana) + list(lo) + list(hi) + list(reale or [])
  vmin, vmax = min(tutti), max(tutti)
  span = (vmax - vmin) or 1.0
  vmin, vmax = vmin - 0.08 * span, vmax + 0.08 * span
  pad_l, pad_r, pad_t, pad_b = 46, 10, 12, 22
  w = larghezza - pad_l - pad_r
  h = altezza - pad_t - pad_b
  tot = n_s + n_f - 1 or 1

  def X(i): return pad_l + w * i / tot
  def Y(v): return pad_t + h * (1 - (v - vmin) / (vmax - vmin))
  def path(vals, off): return " ".join(
    f"{'M' if k == 0 else 'L'}{X(off + k):.1f},{Y(v):.1f}" for k, v in enumerate(vals))

  banda = (
    " ".join(f"{X(n_s - 1 + k):.1f},{Y(v):.1f}" for k, v in enumerate(hi))
    + " " + " ".join(f"{X(n_s - 1 + k):.1f},{Y(v):.1f}"
                     for k, v in reversed(list(enumerate(lo))))
  )
  ticks = "".join(
    f'<line x1="{pad_l}" y1="{Y(v):.1f}" x2="{larghezza - pad_r}" y2="{Y(v):.1f}" '
    f'class="grid"/><text x="{pad_l - 6}" y="{Y(v) + 4:.1f}" class="tick">{v:.4g}</text>'
    for v in np.linspace(vmin, vmax, 4)
  )
  reale_path = (f'<path d="{path([storia[-1]] + list(reale), n_s - 1)}" class="reale"/>'
                if reale else "")
  return f"""<svg viewBox="0 0 {larghezza} {altezza}" class="chart" role="img">
  {ticks}
  <polygon points="{banda}" class="banda"/>
  <path d="{path(storia, 0)}" class="storia"/>
  <path d="{path([storia[-1]] + list(mediana), n_s - 1)}" class="mediana"/>
  {reale_path}
  <line x1="{X(n_s - 1):.1f}" y1="{pad_t}" x2="{X(n_s - 1):.1f}" y2="{pad_t + h}" class="taglio"/>
</svg>"""


def write_report(path: Path, series, outputs, q_levels, info, per_serie) -> None:
  blocchi = []
  for s, o in zip(series, outputs):
    f = np.atleast_2d(o.forecast)
    q = None if o.quantiles is None else np.asarray(o.quantiles)
    if q is not None and q.ndim == 2:
      q = q[None, ...]
    for v in range(f.shape[0]):
      nome = s.col_names[v] if v < len(s.col_names) else f"v{v}"
      storia = list(map(float, s.target[v, -min(200, s.target.shape[1]):]))
      mediana = list(map(float, f[v]))
      lo = list(map(float, q[v, :, 0])) if q is not None else mediana
      hi = list(map(float, q[v, :, -1])) if q is not None else mediana
      reale = list(map(float, np.atleast_2d(s.truth)[v])) if s.truth is not None else []
      m = per_serie.get((s.ts_id, nome))
      tabella = ("<dl>" + "".join(f"<dt>{k}</dt><dd>{val:.4g}</dd>"
                                  for k, val in m.items()) + "</dl>") if m else ""
      blocchi.append(
        f'<section><h2>{s.ts_id} <span>{nome}</span></h2>'
        f'{_svg(storia, mediana, lo, hi, reale)}{tabella}</section>'
      )
  meta = "".join(f"<dt>{k}</dt><dd>{v}</dd>" for k, v in info.items())
  path.parent.mkdir(parents=True, exist_ok=True)
  path.write_text(f"""<!doctype html>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>TimesFM 3.0 - previsioni</title>
<style>
  :root {{ color-scheme: light dark; --bg:#fbfbf9; --fg:#1c1b19; --mut:#6b6862;
           --line:#d8d5cf; --acc:#c15f3c; --acc2:#3c6ec1; --band:#c15f3c22; }}
  @media (prefers-color-scheme: dark) {{
    :root {{ --bg:#17161a; --fg:#eceae5; --mut:#a3a09a; --line:#35333a;
             --band:#e8825c2e; --acc:#e8825c; --acc2:#7aa2e8; }} }}
  body {{ margin:0; padding:28px; background:var(--bg); color:var(--fg);
          font:15px/1.5 ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif; }}
  h1 {{ font-size:20px; margin:0 0 4px; }}
  h2 {{ font-size:15px; margin:0 0 8px; }} h2 span {{ color:var(--mut); font-weight:400; }}
  section {{ max-width:820px; margin:0 0 26px; padding:16px; border:1px solid var(--line);
             border-radius:10px; overflow-x:auto; }}
  .chart {{ width:100%; height:auto; }}
  .grid {{ stroke:var(--line); stroke-width:1; }}
  .tick {{ fill:var(--mut); font-size:10px; text-anchor:end; }}
  .storia {{ fill:none; stroke:var(--fg); stroke-width:1.4; }}
  .mediana {{ fill:none; stroke:var(--acc); stroke-width:2; }}
  .reale {{ fill:none; stroke:var(--acc2); stroke-width:1.6; stroke-dasharray:4 3; }}
  .banda {{ fill:var(--band); }}
  .taglio {{ stroke:var(--mut); stroke-dasharray:3 3; }}
  dl {{ display:grid; grid-template-columns:repeat(auto-fit,minmax(110px,1fr));
        gap:6px 14px; margin:12px 0 0; }}
  dt {{ color:var(--mut); font-size:12px; }} dd {{ margin:0 0 6px; font-variant-numeric:tabular-nums; }}
  .legenda {{ color:var(--mut); font-size:12px; max-width:820px; margin:0 0 22px; }}
</style>
<h1>TimesFM 3.0 - previsioni</h1>
<p class="legenda">Linea scura: storico. Arancio: mediana prevista. Banda: quantili 10-90.
Tratteggio blu: valori reali (solo in backtest).</p>
<section><h2>Esecuzione</h2><dl>{meta}</dl></section>
{"".join(blocchi)}
""", encoding="utf-8")


# --------------------------------------------------------------------------- #
def main(argv=None) -> int:
  args = build_parser().parse_args(argv)
  log = (lambda *a: None) if args.quiet else (lambda *a: print(*a, file=sys.stderr))

  if not args.csv and not args.demo:
    build_parser().error("serve --csv PERCORSO oppure --demo")
  if args.horizon < 1:
    build_parser().error("--horizon deve essere >= 1")

  series = make_demo_series(args.horizon) if args.demo else load_csv_series(args)
  series = prepare(series, args)
  log(f"Serie: {len(series)} | contesto: "
      + ", ".join(f"{s.ts_id}={s.target.shape[1]}" for s in series[:6])
      + (" ..." if len(series) > 6 else ""))

  forecaster, device, n_par = load_forecaster(args, log)
  q_levels = list(forecaster.config.quantiles)
  outputs, dt = forecast(forecaster, series, args, log)

  per_serie: dict = {}
  if args.backtest:
    for s, o in zip(series, outputs):
      f = np.atleast_2d(o.forecast)
      q = None if o.quantiles is None else np.asarray(o.quantiles)
      if q is not None and q.ndim == 2:
        q = q[None, ...]
      for v in range(f.shape[0]):
        nome = s.col_names[v] if v < len(s.col_names) else f"v{v}"
        per_serie[(s.ts_id, nome)] = metrics(
          np.atleast_2d(s.truth)[v], f[v], s.target[v],
          None if q is None else q[v], q_levels, max(1, args.seasonality),
        )

  righe = to_rows(series, outputs, q_levels)
  if args.out:
    write_csv(args.out, righe)
    log(f"Previsioni scritte in {args.out}")

  info = {
    "checkpoint": args.checkpoint,
    "device": device,
    "parametri": f"{n_par / 1e6:.1f}M",
    "serie": len(series),
    "orizzonte": args.horizon,
    "tempo inferenza": f"{dt:.2f}s",
  }
  if args.report:
    write_report(args.report, series, outputs, q_levels, info, per_serie)
    log(f"Report HTML scritto in {args.report}")
  if args.json_out:
    args.json_out.parent.mkdir(parents=True, exist_ok=True)
    args.json_out.write_text(json.dumps(
      {"info": info,
       "metriche": {f"{k[0]}|{k[1]}": v for k, v in per_serie.items()},
       "previsioni": righe},
      indent=2, ensure_ascii=False), encoding="utf-8")
    log(f"JSON scritto in {args.json_out}")

  # Riepilogo a schermo.
  for s, o in zip(series, outputs):
    f = np.atleast_2d(o.forecast)
    for v in range(f.shape[0]):
      nome = s.col_names[v] if v < len(s.col_names) else f"v{v}"
      testa = ", ".join(f"{x:.4g}" for x in f[v][:6])
      print(f"{s.ts_id} [{nome}] -> {testa}{' ...' if f.shape[1] > 6 else ''}")
      m = per_serie.get((s.ts_id, nome))
      if m:
        print("    " + "  ".join(f"{k}={val:.4g}" for k, val in m.items()))
  return 0


if __name__ == "__main__":
  raise SystemExit(main())
