"""Makes the beat model file: Beat This (github.com/CPJKU/beat_this) as ONNX.

    python tools/analysis/export_beat_model.py out/beat-this-small0.onnx [small0]

Needs `beat_this` (which brings PyTorch), `onnx` and `onnxruntime`. It exports one of the published
checkpoints, by default `small0` (2 M parameters, 10 MB; `final0` is the large one, 83 MB), with
the spectrogram left out of the graph: the game computes that itself
(src/analysis/beat/spectrogram.ts) and cuts the song into windows (src/analysis/beat/track.ts).

Graph, one window of thirty seconds:
  input    spect     [1, 1500, 128]  the log-mel spectrogram, 50 frames a second
  outputs  beat      [1, 1500]       per frame, the logit of a beat
           downbeat  [1, 1500]       per frame, the logit of the start of a bar

The window length is fixed: the model's rotary position embedding is traced for it.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import torch
from beat_this.inference import load_model
from beat_this.preprocessing import LogMelSpect

FRAMES = 1500
RATE = 22050


class Logits(torch.nn.Module):
    """BeatThis.forward with its two answers as plain outputs."""

    def __init__(self, model: torch.nn.Module) -> None:
        super().__init__()
        self.m = model

    def forward(self, spect: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        out = self.m(spect)
        return out["beat"], out["downbeat"]


def window(seed: int) -> torch.Tensor:
    """Thirty seconds of something like music (clicks twice a second over a chord and noise), as the model's input."""
    rng = np.random.default_rng(seed)
    t = np.arange(FRAMES * RATE // 50) / RATE
    chord = sum(np.sin(2 * np.pi * f * t) for f in rng.choice([110, 165, 220, 277, 330, 440], 3, replace=False)) * 0.1
    clicks = np.sin(2 * np.pi * 60 * t) * np.exp(-30 * (t % 0.5)) * 0.6
    signal = (chord + clicks + rng.normal(0, 0.02, len(t))).astype(np.float32)
    return LogMelSpect()(torch.from_numpy(signal))[:FRAMES].unsqueeze(0)


def main() -> None:
    out = Path(sys.argv[1])
    checkpoint = sys.argv[2] if len(sys.argv) > 2 else "small0"
    out.parent.mkdir(parents=True, exist_ok=True)
    model = load_model(checkpoint, "cpu")
    core = Logits(model).eval()
    with torch.inference_mode():
        torch.onnx.export(core, (window(0),), str(out), dynamo=False, input_names=["spect"], output_names=["beat", "downbeat"], opset_version=17)

    import onnxruntime as ort

    session = ort.InferenceSession(str(out), providers=["CPUExecutionProvider"])
    worst = 0.0
    same = True
    for seed in range(1, 6):
        spect = window(seed)
        with torch.inference_mode():
            beat, downbeat = core(spect)
        got_beat, got_downbeat = session.run(None, {"spect": spect.numpy()})
        worst = max(worst, float(np.abs(got_beat - beat.numpy()).max()), float(np.abs(got_downbeat - downbeat.numpy()).max()))
        same = same and bool(((got_beat > 0) == (beat.numpy() > 0)).all() and ((got_downbeat > 0) == (downbeat.numpy() > 0)).all())
    parameters = sum(p.numel() for p in model.parameters())
    print(f"{out}: {checkpoint}, {parameters / 1e6:.2f} M parameters, {out.stat().st_size / 1e6:.1f} MB")
    print(f"largest difference to PyTorch over 5 windows: {worst:.1e} (logits); frames over the threshold the same: {same}")


if __name__ == "__main__":
    main()
