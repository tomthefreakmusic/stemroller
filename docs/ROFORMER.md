# RoFormer GGUF support (Windows)

This fork adds the three Q8 models from [chenmozhijin/BSRoformer-GGUF](https://huggingface.co/chenmozhijin/BSRoformer-GGUF) using [BSRoformer.cpp](https://github.com/chenmozhijin/BSRoformer.cpp). Demucs remains available for individual instruments.

## Setup and use

Use Node.js 22 on Windows x64:

```powershell
npm ci
npm run download-third-party-apps
npm run setup:roformer
npm run dev
```

For a portable Windows build, run `npm run build:win`. Open `dist/win-unpacked/StemRoller RoFormer.exe`. Keep the entire folder together. In Preferences, choose a RoFormer model and leave Backend on **Use GPU (if available)**. Drag a local audio file onto the window or use the existing search workflow.

The RoFormer setup downloads about 568 MB of models plus a 23 MB Vulkan runtime archive and a small separate CPU runtime. Model revisions and SHA-256 checksums are pinned; interrupted or invalid downloads do not replace a verified model. The existing Demucs dependency is much larger (about 1.95 GB compressed). Model files and runtime binaries are excluded from Git.

The Windows workflow includes setup, regression tests, and a downloadable GitHub Actions artifact. This fork uses its own application ID/name and does not offer upstream updates that would remove these features.

## Models and outputs

| Preference | Native prediction | Exported stems |
| --- | --- | --- |
| BS RoFormer Anvuew Q8 | Vocals | Vocals + mixture minus vocals |
| Mel-Band RoFormer Deux Q8 | Vocals and instrumental | Both predictions directly |
| Mel-Band RoFormer Gabox FV6 Q8 | Vocals | Vocals + mixture minus vocals |

Inputs are converted to stereo, 44.1 kHz float WAV before inference. Complementary instrumentals use the same converted mixture, without gain normalization. WAV output retains native float audio; FLAC and MP3 follow StemRoller's existing encoding settings. Original-audio preservation and filename prefixes also apply.

Each RoFormer result uses a model-specific folder so comparisons do not mix with old Demucs drums/bass files. Rerunning the same model uses the same output folder. The queue retains StemRoller's existing track-based completion history; to compare a completed track with another model, drag the local file in again.

## GPU settings

- Default: 8-second chunks, overlap 2. If memory runs out, select 4 seconds.
- Overlap 4 takes longer and blends more overlapping predictions. The 13-second option consumes more GPU memory. These are user choices, not a promise of universally better audio.
- RoFormer uses Vulkan GPU acceleration. The tested NVIDIA driver was 610.47; the exact minimum driver was not established. CPU mode uses a separate MSVC CPU runtime and sets `BSR_FORCE_CPU=1`. The variable is removed in GPU mode because the engine checks its presence, not its value.
- The CUDA v0.1.0 release was tested but could not start because its archive lacks required CUDA DLLs. The bundled Vulkan release runs without installing a CUDA toolkit.
- Advanced/manual installs can set `STEMROLLER_ROFORMER_EXE` to the full CLI path and `STEMROLLER_MODELS_DIR` to the model folder. Keep the runtime's DLLs next to its executable. Automatic installation and validation currently cover Windows x64 only.

## Which model to try?

Start by comparing Deux and Anvuew on the same 30–60 seconds of your track. Include dense vocals, cymbals, reverb tails, and a vocal-free passage. Listen for instrument leakage, missing consonants, softened transients, and leftover vocal ambience. Architecture names alone do not establish a quality ranking.

Deux is a practical first audition because it predicts both outputs directly; its [model card](https://huggingface.co/becruily/mel-band-roformer-deux) reports vocal/instrumental metrics, but does not establish superiority on your music. Gabox FV6 is another included vocal model to compare.

Outside these GGUF choices, [ZFTurbo's pretrained-model table](https://github.com/ZFTurbo/Music-Source-Separation-Training/blob/main/docs/pretrained_models.md) reports Multisong vocal SDR of 11.00 for BS PolarFormer, 10.98 for KimberleyJensen MelBand RoFormer, and 10.87 for a ViperX BS RoFormer checkpoint. These small differences are checkpoint-specific; they are not measurements of the Anvuew/Deux/Gabox GGUF files. PolarFormer requires a different runtime and is not implemented here.

For four-instrument separation, [SCNet](https://github.com/starrytong/SCNet) is an alternative worth evaluating against Demucs. Neither SCNet nor PolarFormer was tested on this GPU in this change, so their memory fit and speed remain unverified. They cannot be loaded merely by selecting a GGUF filename in this adapter.

## Model provenance and licenses

The inference engine is MIT licensed. Model weights retain their original terms:

- [Anvuew BS-RoFormer](https://huggingface.co/anvuew/BS-RoFormer): model card declares GPL-3.0.
- [Becruily Deux](https://huggingface.co/becruily/mel-band-roformer-deux): CC BY-NC 4.0, including the noncommercial restriction.
- [GaboxR67 MelBandRoformers](https://huggingface.co/GaboxR67/MelBandRoformers): no license was declared in the inspected model card; do not infer an MIT license from the app or runtime.

The adapter's output ordering is based on the original training configs: Anvuew `config.yaml` targets vocals; Deux `config_deux_becruily.yaml` lists Vocals then Instrumental; Gabox `melbandroformers/vocals/voc_gabox.yaml` targets Vocals.

## Validation

`npm test` covers split progress messages, inference-option validation, one-/two-stem mapping, CPU override, missing outputs, failed conversion/cancellation, and verified-download cache/corruption behavior. `npm run build:svelte` compiles the UI.

Live GPU smoke tests used an RTX 3060 Ti (8 GB), driver 610.47, Vulkan, Q8 weights, 8-second chunks, overlap 2, and 12 seconds of synthetic stereo audio. All three selected Vulkan0 and produced finite 44.1 kHz stereo float WAVs with exactly 529,200 frames. Native reported inference times were approximately 15.87 seconds (Anvuew), 3.95 seconds (Deux), and 9.08 seconds (Gabox FV6). This verifies execution and output structure, not musical quality, peak VRAM, long-track speed, or every chunk/overlap combination.

The real Electron queue also passed all three models with WAV/FLAC/MP3 exports respectively, original preservation, and prefixed filenames.

The separate CPU-only runtime completed Deux on the same 12-second fixture using 4-second chunks and overlap 2 (about 90 seconds of inference). CPU mode is substantially slower on this machine.

Cancellation was tested through the real Electron queue: the active native process was cancelled, and the next song completed. The Preferences UI was rendered and model changes were verified through IPC.

If local Windows packaging fails while extracting symbolic links for winCodeSign, use `npm run build:svelte` followed by `npx electron-builder -w --config electron-builder.config.json --config.win.signAndEditExecutable=false`. This produces an unsigned local build without custom executable resource editing.

The final unsigned portable Windows executable was launched and tested through its renderer: Deux produced vocals.wav and instrumental.wav from a local file using the packaged runtime/models. Settings were restored and the app closed afterward. YouTube downloading was bundled but not exercised in the live tests.
