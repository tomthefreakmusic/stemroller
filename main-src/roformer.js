import fs from 'node:fs/promises'
import path from 'node:path'
import { validateRoformerOptions } from './roformerModels.js'

// The injected runner belongs to the queue so conversion and inference share cancellation.
export async function separateRoformer({
  model,
  modelDir,
  executable,
  ffmpeg = 'ffmpeg',
  mediaPath,
  tmpDir,
  options,
  backend,
  run,
}) {
  validateRoformerOptions(options)
  const modelPath = path.join(modelDir, model.file)
  try {
    await fs.access(modelPath)
    if (path.isAbsolute(executable)) await fs.access(executable)
  } catch {
    throw new Error(
      'RoFormer files are missing. Run npm run setup:roformer in the source folder, then restart StemRoller.'
    )
  }
  const input = path.join(tmpDir, 'roformer-input.wav')
  const raw = path.join(tmpDir, 'roformer-output.wav')
  const stemDir = path.join(tmpDir, 'roformer-stems')
  await fs.mkdir(stemDir, { recursive: true })
  await run(ffmpeg, [
    '-nostdin',
    '-y',
    '-i',
    mediaPath,
    '-vn',
    '-ar',
    '44100',
    '-ac',
    '2',
    '-c:a',
    'pcm_f32le',
    input,
  ])
  await run(
    executable,
    [
      modelPath,
      input,
      raw,
      '--chunk-size',
      String(options.chunkSize),
      '--overlap',
      String(options.overlap),
    ],
    { roformer: true, env: { BSR_FORCE_CPU: backend === 'cpu' ? '1' : undefined } }
  )
  const files = {}
  for (const [index, stem] of model.stems.entries()) {
    const source = model.stems.length === 1 ? raw : raw.replace(/\.wav$/, `_stem_${index}.wav`)
    if ((await fs.stat(source)).size <= 44)
      throw new Error(`RoFormer produced an empty ${stem} stem.`)
    files[stem] = path.join(stemDir, `${stem}.wav`)
    await fs.rename(source, files[stem])
  }
  if (!files.instrumental) {
    files.instrumental = path.join(stemDir, 'instrumental.wav')
    await run(ffmpeg, [
      '-nostdin',
      '-y',
      '-i',
      input,
      '-i',
      files.vocals,
      '-filter_complex',
      '[0:a][1:a]amix=inputs=2:weights=1 -1:normalize=0:duration=first',
      '-c:a',
      'pcm_f32le',
      files.instrumental,
    ])
  }
  return [files.vocals, files.instrumental]
}
