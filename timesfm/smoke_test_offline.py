#!/usr/bin/env python3
"""Verifica offline della pipeline TimesFM 3.0, senza scaricare i pesi.

Costruisce un modello TimesFM3 con l'architettura del codice sorgente e pesi
casuali, lo salva come checkpoint locale e ci fa girare sopra l'intero percorso
di inferenza (univariato, multivariato, covariate, quantili).

Serve a rispondere a una sola domanda: "il modello gira in questo ambiente?".
NON produce previsioni sensate - i pesi sono casuali, non quelli addestrati da
Google. Per previsioni vere serve il checkpoint `google/timesfm-3.0-pytorch`.

  python smoke_test_offline.py            # architettura ridotta, veloce
  python smoke_test_offline.py --full     # architettura reale 3.0 (20x1280)
"""

from __future__ import annotations

import argparse
import tempfile
import time
from pathlib import Path

import numpy as np
import torch

from timesfm3 import ModelConfig, TimesFM3Evaluator, TimesFM3Torch, configs


def build_model(full: bool) -> TimesFM3Torch:
  """Modello con pesi casuali: architettura reale 3.0 oppure una ridotta."""
  if full:
    # Valori di default del costruttore = architettura del checkpoint 3.0.
    return TimesFM3Torch()
  dims, layers = 128, 2
  return TimesFM3Torch(
    residual_block_config=configs.ResidualBlockConfig(
      hidden_dims=dims, output_dims=dims, use_bias=False, activation="relu"
    ),
    transformer_config=configs.StackedTransformersConfig(
      num_layers=layers,
      transformer=configs.TransformerConfig(
        model_dims=dims, hidden_dims=dims, num_heads=4,
        attention_norm="rms", feedforward_norm="rms", qk_norm="rms",
        use_bias=False, use_rope_seq=True, use_rope_var=False,
        ff_activation="relu", deterministic=True,
      ),
    ),
  )


def main() -> int:
  ap = argparse.ArgumentParser(description=__doc__,
                               formatter_class=argparse.RawDescriptionHelpFormatter)
  ap.add_argument("--full", action="store_true",
                  help="usa l'architettura completa di TimesFM 3.0 (piu' lenta)")
  ap.add_argument("--device", default="cpu")
  ap.add_argument("--horizon", type=int, default=24)
  ap.add_argument("--context", type=int, default=256)
  args = ap.parse_args()

  print(f"torch {torch.__version__} | device={args.device} | "
        f"cuda={'si' if torch.cuda.is_available() else 'no'}")

  t0 = time.perf_counter()
  modello = build_model(args.full)
  n_par = sum(p.numel() for p in modello.parameters())
  print(f"[1/4] Modello costruito: {n_par / 1e6:.1f}M parametri "
        f"({time.perf_counter() - t0:.1f}s)"
        + ("  <- architettura reale 3.0" if args.full else "  <- architettura ridotta"))

  with tempfile.TemporaryDirectory() as tmp:
    t0 = time.perf_counter()
    modello.save_pretrained(tmp)
    print(f"[2/4] Checkpoint locale salvato in {Path(tmp).name}/ "
          f"({time.perf_counter() - t0:.1f}s): "
          + ", ".join(sorted(p.name for p in Path(tmp).iterdir())))

    t0 = time.perf_counter()
    forecaster = TimesFM3Evaluator(ModelConfig(
      checkpoint_path=tmp, device=args.device, per_core_batch_size=4,
      local_files_only=True,
    ))
    print(f"[3/4] Forecaster caricato dal disco, nessuna rete "
          f"({time.perf_counter() - t0:.1f}s)")

    rng = np.random.default_rng(7)
    t = np.arange(args.context, dtype=np.float32)
    uni_a = (100 + 10 * np.sin(2 * np.pi * t / 24) + rng.normal(0, 1, t.size)).astype(np.float32)
    uni_b = np.sin(np.linspace(0, 24, args.context // 2)).astype(np.float32)
    multi = rng.standard_normal((3, args.context)).astype(np.float32)
    cov_p = rng.standard_normal((1, args.context)).astype(np.float32)
    cov_pf = rng.standard_normal((2, args.context + args.horizon)).astype(np.float32)

    casi = [
      ("univariato, lunghezze diverse",
       dict(contexts=[uni_a, uni_b], horizon=args.horizon, return_quantiles=True),
       [(args.horizon,), (args.horizon,)]),
      ("multivariato 3 variate + covariate",
       dict(contexts=[multi], horizon=args.horizon, past_only_covariates=[cov_p],
            past_future_covariates=[cov_pf], return_quantiles=True),
       [(3, args.horizon)]),
      ("multivariato trattato come univariato",
       dict(contexts=[multi], horizon=args.horizon, return_quantiles=True, univariate=True),
       [(3, args.horizon)]),
    ]

    print("[4/4] Inferenza:")
    esiti = []
    for nome, kwargs, attese in casi:
      t0 = time.perf_counter()
      out = list(forecaster.predict_batch(**kwargs))
      dt = time.perf_counter() - t0
      ok = True
      for o, attesa in zip(out, attese):
        f = np.asarray(o.forecast)
        q = np.asarray(o.quantiles)
        ok &= f.shape == attesa
        ok &= q.shape == attesa + (len(forecaster.config.quantiles),)
        ok &= bool(np.isfinite(f).all() and np.isfinite(q).all())
      esiti.append(ok)
      forme = " ".join(str(np.asarray(o.forecast).shape) for o in out)
      print(f"      {'OK  ' if ok else 'KO  '}{nome}: forme {forme}, {dt:.2f}s")

  buono = all(esiti)
  print("\nEsito: " + ("pipeline funzionante" if buono else "PROBLEMI RILEVATI"))
  print("Nota: pesi casuali - i numeri previsti non hanno significato. "
        "Con i pesi ufficiali cambia solo il checkpoint.")
  return 0 if buono else 1


if __name__ == "__main__":
  raise SystemExit(main())
