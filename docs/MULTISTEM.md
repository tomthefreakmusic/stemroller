# SCNet and BS PolarFormer: four-stem separation

Select **SCNet Large — 4 stems** or **BS PolarFormer Aname — 4 stems** in Preferences. Both export **vocals, drums, bass, and other**, plus an instrumental mix of the three non-vocal stems. Demucs and the existing GGUF models remain available.

## Windows setup

Use Node.js 22 and Windows x64. For a complete source build:

```powershell
npm ci
npm run download-third-party-apps
npm run setup:roformer
npm run setup:multistem
npm test
npm run build:win
```

`setup:multistem` downloads isolated Python 3.12.10, PyTorch 2.7.1 with CUDA 12.6, pinned inference dependencies, and both checkpoints. No system Python or CUDA toolkit is required. A compatible NVIDIA driver is required for CUDA; **Use CPU** is available in Preferences. Automatic setup currently covers Windows x64. Allow at least 25 GB free for a full source build, downloads, and a separate packaged copy; the multi-stem runtime and weights alone occupy approximately 6 GB.

To add or refresh multi-stem dependencies in an existing portable folder:

```powershell
npm run setup:multistem -- --app-dir "C:\path\to\win-unpacked"
```

The portable folder must also contain the updated Electron application. Keep the entire folder together, including `Models`, `ThirdPartyApps`, and `PythonInference`. Models and binaries are excluded from Git. Checkpoint downloads and Python/pip bootstrap archives are SHA-256 verified; valid downloads are reused.

## Settings

- Default: **4-second chunks, overlap 2**, batch size one. This limits GPU memory.
- **8 and 11 seconds** are available. Eleven seconds matches the checkpoints' original inference chunk length. Changing context can change separation quality.
- **Overlap 4** makes more overlapping predictions and takes additional work. SCNet's supplied config uses overlap 4; PolarFormer's uses overlap 2.
- Input is converted to stereo 44.1 kHz float WAV. Output length is preserved. WAV retains float audio for individual stems; compressed formats and the combined instrumental use StemRoller's existing export path.
- Temporary decoded audio and stems are created on the selected output drive and cleaned up after completion, failure, or cancellation. Enable output beside the input only when that drive has sufficient space.
- Results use model-specific folders. Re-add a completed track to compare another model. Audio accumulation uses system RAM proportional to track length.

Advanced development overrides: `STEMROLLER_MODELS_DIR`, `STEMROLLER_THIRD_PARTY_APPS`, and `STEMROLLER_MULTISTEM_PYTHON` (full interpreter path).

## Checkpoints and provenance

| Selector | Checkpoint | Ordered predictions |
| --- | --- | --- |
| SCNet Large | [starrytong fixed checkpoint, MSST v1.0.9](https://github.com/ZFTurbo/Music-Source-Separation-Training/releases/tag/v1.0.9) | drums, bass, other, vocals |
| BS PolarFormer Aname | [bs_pope_4stem_09072026_aname.ckpt](https://huggingface.co/noblebarkrr/mvsepless_resources/tree/030a01aa951b3908ed6b01b2e507c17953300c2d/bs_roformer) | vocals, other, drums, bass |

PolarFormer's training config controls output order; the mirror's catalog lists a different order. This is Aname's four-stem checkpoint, distinct from vocal-only PolarFormer checkpoints in public rankings. No vocal-only score is evidence for the quality of this four-stem model.

Original configs are included under `python/configs`. Inference code is pinned to [MSST commit 050cae7](https://github.com/ZFTurbo/Music-Source-Separation-Training/tree/050cae7345f4ac1e1e27e066c2c5cdc0a2cdb679). The upstream code license and attribution are in `python/vendor`. Model checkpoints are downloaded from upstream/mirror hosts rather than committed here; do not infer checkpoint licensing or commercial-use permission from the app's or inference code's license. The PolarFormer mirror is not an author-hosted release, and independent author verification of its weight license remains unresolved.

## Validation on this machine

RTX 3060 Ti (8 GB), NVIDIA driver 610.47, isolated bundled CUDA runtime:

| Check | SCNet Large | BS PolarFormer Aname |
| --- | --- | --- |
| 4-second chunks, overlap 2 | passed; 448 MiB peak allocation | passed; 1,319 MiB peak allocation |
| 11-second chunks | passed, overlap 4; 841 MiB | passed, overlap 2; 2,276 MiB |
| Real Electron queue | WAV, four stems + instrumental + original | FLAC, four stems + instrumental + original |

The fixture is 12 seconds of synthetic stereo audio (529,200 frames). These checks verify execution, strict weight compatibility, finite outputs, preserved frame count, and export plumbing. Memory numbers are PyTorch peak allocated memory, excluding the driver, reserved cache, and other applications. They are not quality scores or full-song benchmarks. CPU execution of these two models has not been benchmarked.

`npm test` covers adapter validation, named stem ordering, incomplete output, cancellation/failure, and existing GGUF regressions. `python/test_separate.py` checks overlap-add reconstruction across short inputs and chunk boundaries, plus non-finite rejection. Run it with the bundled interpreter's `-I` option. The real Electron queue passed cancellation of PolarFormer followed by a successful next job. The final unsigned portable application was launched, its Preferences screen inspected, and both models exported all four named WAV stems plus instrumental through the packaged renderer. Test settings were restored and the app was closed.

The local runtime was assembled from matching installed packages and checked against every pinned requirement, then tested in isolation. The setup script's existing-runtime and verified-download paths were exercised; a clean download/install of the entire PyTorch environment was not repeated locally.

For a practical first audition, try SCNet Large and compare PolarFormer on the same 30–60 seconds. Listen separately to drum transients, bass bleed, and the other stem. There is no measured quality winner on your music yet.

A subsequent full-track check used a 17.5-minute, 96 kHz stereo FLAC with SCNet Large: all four stems and the instrumental exported 46,282,866 finite stereo frames at 44.1 kHz. Processing used the selected output drive for temporary audio, and the temporary directory was removed afterward. This fixes system-drive exhaustion when the output folder is on another drive.
