"""Inference-only SCNet/BS PolarFormer adapter; model code is pinned under vendor/."""
import argparse
import json
from pathlib import Path
import sys
import time

sys.path.insert(0, str(Path(__file__).parent / 'vendor'))
import numpy as np
import soundfile as sf
import torch
import torch.nn.functional as F
import yaml


class ConfigLoader(yaml.SafeLoader):
    pass


ConfigLoader.add_constructor('tag:yaml.org,2002:python/tuple',
                             lambda loader, node: tuple(loader.construct_sequence(node)))

CONFIGS = {'scnet-large': 'scnet-large.yaml', 'polarformer-four-stem': 'polarformer-four-stem.yaml'}


def load_model(kind, checkpoint, device):
    with (Path(__file__).parent / 'configs' / CONFIGS[kind]).open() as file:
        config = yaml.load(file, Loader=ConfigLoader)
    stems = [s.lower() for s in config['training']['instruments']]
    if len(stems) != 4 or set(stems) != {'vocals', 'drums', 'bass', 'other'}:
        raise ValueError('Expected a four-instrument checkpoint configuration')
    if kind == 'scnet-large':
        from models.scnet import SCNet
        model = SCNet(**config['model'])
    else:
        from models.bs_roformer.bs_roformer import BSRoformer
        if config['model'].get('use_pope') is not True:
            raise ValueError('PolarFormer requires PoPE positional embeddings')
        model = BSRoformer(**config['model'])
    # Never run arbitrary pickle code or silently ignore unmatched model weights.
    weights = torch.load(checkpoint, map_location='cpu', weights_only=True)
    for key in ('state_dict', 'state', 'model_state_dict'):
        if key in weights:
            weights = weights[key]
            break
    model.load_state_dict(weights, strict=True)
    del weights
    return model.eval().to(device), config, stems


def demix(model, mix, chunk_size, overlap, device, on_progress=lambda p: None):
    """Reference MSST generic overlap-add, batch=1 to bound GPU memory."""
    length = mix.shape[-1]
    step = chunk_size // overlap
    border = chunk_size - step
    padded = length > 2 * border
    if padded:
        mix = F.pad(mix, (border, border), mode='reflect')
    total = mix.shape[-1]
    result = torch.zeros((4, 2, total), dtype=torch.float32)
    counter = torch.zeros(total, dtype=torch.float32)
    fade = chunk_size // 10
    base_window = torch.ones(chunk_size)
    base_window[:fade] = torch.linspace(0, 1, fade)
    base_window[-fade:] = torch.linspace(1, 0, fade)
    with torch.inference_mode():
        for start in range(0, total, step):
            part = mix[:, start:start + chunk_size].to(device)
            n = part.shape[-1]
            part = F.pad(part, (0, chunk_size - n), mode='reflect' if n > chunk_size // 2 else 'constant')
            with torch.autocast(device_type=device.type, enabled=device.type == 'cuda'):
                predicted = model(part.unsqueeze(0))[0]
            if predicted.shape != (4, 2, chunk_size):
                raise ValueError(f'Unexpected model output shape: {tuple(predicted.shape)}')
            if not torch.isfinite(predicted).all():
                raise ValueError('Model produced non-finite audio; no stems were exported')
            window = base_window.clone()
            if start == 0:
                window[:fade] = 1
            if start + step >= total:
                window[-fade:] = 1
            result[..., start:start + n] += predicted[..., :n].float().cpu() * window[:n]
            counter[start:start + n] += window[:n]
            on_progress(min(1, (start + step) / total))
    if not torch.all(counter > 0):
        raise ValueError('Uncovered samples in overlap-add')
    result /= counter
    return result[..., border:border + length].numpy() if padded else result.numpy()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--model', choices=CONFIGS, required=True)
    parser.add_argument('--checkpoint', required=True)
    parser.add_argument('--input', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--device', choices=['auto', 'cpu'], default='auto')
    parser.add_argument('--chunk-size', type=int, choices=[176400, 352800, 485100], default=176400)
    parser.add_argument('--overlap', type=int, choices=[2, 4], default=2)
    args = parser.parse_args()
    begin = time.monotonic()
    device = torch.device('cuda' if args.device == 'auto' and torch.cuda.is_available() else 'cpu')
    torch.set_num_threads(min(8, torch.get_num_threads()))
    if device.type == 'cuda':
        torch.cuda.reset_peak_memory_stats()
    print(f'Using backend: {device} ({torch.cuda.get_device_name() if device.type == "cuda" else "CPU"})', flush=True)
    model, config, stems = load_model(args.model, args.checkpoint, device)
    audio, sr = sf.read(args.input, dtype='float32', always_2d=True)
    if sr != 44100 or audio.shape[1] != 2 or len(audio) == 0 or not np.isfinite(audio).all():
        raise ValueError('Input must contain finite, nonempty stereo audio at 44100 Hz')
    mix = audio.T.copy()
    mean, std = 0.0, 1.0
    if config.get('inference', {}).get('normalize'):
        mono = mix.mean(0)
        mean, std = float(mono.mean()), float(mono.std())
        # Silent / phase-inverted stereo input must not divide by zero.
        if std < 1e-8:
            std = max(float(mix.std()), 1e-8)
        mix = (mix - mean) / std
    result = demix(model, torch.from_numpy(mix), args.chunk_size, args.overlap, device,
                   lambda p: print(f'[multistem] {int(p * 100)} %', flush=True))
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    for stem, samples in zip(stems, result):
        samples = samples * std + mean
        if not np.isfinite(samples).all():
            raise ValueError('Non-finite output after restoring audio scale')
        sf.write(output / f'{stem}.wav', samples.T, sr, subtype='FLOAT')
    print(json.dumps({'stems': stems, 'frames': len(audio), 'seconds': time.monotonic() - begin,
                      'device': str(device), 'peak_allocated_mib': torch.cuda.max_memory_allocated() / 2**20 if device.type == 'cuda' else None}), flush=True)


if __name__ == '__main__':
    try:
        main()
    except torch.cuda.OutOfMemoryError:
        print('GPU memory exhausted. Choose 4-second chunks or CPU in Preferences.', file=sys.stderr, flush=True)
        sys.exit(1)
    except Exception as error:
        print(f'{type(error).__name__}: {error}', file=sys.stderr, flush=True)
        sys.exit(1)
