import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { separateMultistem } from '../main-src/multistem.js'
import { MULTISTEM_MODELS } from '../main-src/multistemModels.js'

async function fixture(t) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'multistem-test-'))
  t.after(() => fs.rm(tmpDir, { recursive: true, force: true }))
  const model = MULTISTEM_MODELS[1]
  const python = path.join(tmpDir, 'python.exe')
  const script = path.join(tmpDir, 'separate.py')
  for (const file of [python, script, path.join(tmpDir, model.file)])
    await fs.writeFile(file, 'fixture')
  return {
    tmpDir,
    model,
    python,
    script,
    modelDir: tmpDir,
    mediaPath: 'song with spaces.mp3',
    options: { chunkSize: 176400, overlap: 2 },
    backend: 'auto',
  }
}

test('four-stem adapter returns explicit named outputs in checkpoint order', async (t) => {
  const options = await fixture(t)
  const calls = []
  options.run = async (command, args, extra) => {
    calls.push({ command, args, extra })
    if (command === options.python) {
      const output = args[args.indexOf('--output') + 1]
      await fs.mkdir(output)
      for (const stem of ['bass', 'drums', 'other', 'vocals'])
        await fs.writeFile(path.join(output, stem + '.wav'), Buffer.alloc(100))
    }
  }
  const files = await separateMultistem(options)
  assert.deepEqual(
    files.map((f) => path.basename(f)),
    ['vocals.wav', 'other.wav', 'drums.wav', 'bass.wav']
  )
  assert.equal(calls[0].args[calls[0].args.indexOf('-i') + 1], options.mediaPath)
  assert.deepEqual(calls[1].args.slice(0, 2), ['-I', '-u'])
  assert.equal(calls[1].args[calls[1].args.indexOf('--device') + 1], 'auto')
  assert.equal(calls[1].extra.roformer, true)
})

test('incomplete four-stem output is rejected', async (t) => {
  const options = await fixture(t)
  options.run = async () => {}
  await assert.rejects(separateMultistem(options), /ENOENT/)
})

test('invalid options never launch a process', async (t) => {
  const options = await fixture(t)
  options.options.chunkSize = -1
  options.run = () => assert.fail('must not launch')
  await assert.rejects(separateMultistem(options), /Choose 4, 8, or 11-second/)
})

test('failed or cancelled conversion never launches inference', async (t) => {
  const options = await fixture(t)
  let calls = 0
  options.run = async () => {
    calls++
    throw new Error('cancelled')
  }
  await assert.rejects(separateMultistem(options), /cancelled/)
  assert.equal(calls, 1)
})
