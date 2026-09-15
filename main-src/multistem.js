import fs from 'node:fs/promises'
import path from 'node:path'
import { validateMultistemOptions } from './multistemModels.js'

export async function separateMultistem({
  model,
  modelDir,
  python,
  script,
  mediaPath,
  tmpDir,
  options,
  backend,
  run,
}) {
  validateMultistemOptions(options)
  const checkpoint = path.join(modelDir, model.file)
  for (const file of [checkpoint, python, script]) {
    try {
      await fs.access(file)
    } catch {
      throw new Error(
        'Multi-stem runtime or model is missing. Run npm run setup:multistem, then restart StemRoller.'
      )
    }
  }
  const input = path.join(tmpDir, 'multistem-input.wav')
  const output = path.join(tmpDir, 'multistem-stems')
  await run('ffmpeg', [
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
    python,
    [
      '-I',
      '-u',
      script,
      '--model',
      model.architecture,
      '--checkpoint',
      checkpoint,
      '--input',
      input,
      '--output',
      output,
      '--device',
      backend,
      '--chunk-size',
      String(options.chunkSize),
      '--overlap',
      String(options.overlap),
    ],
    { roformer: true }
  )
  const files = model.stems.map((stem) => path.join(output, `${stem}.wav`))
  for (const file of files) {
    if ((await fs.stat(file)).size <= 44)
      throw new Error(`Missing or empty multi-stem output: ${path.basename(file)}`)
  }
  return files
}
