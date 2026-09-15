import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { separateRoformer } from '../main-src/roformer.js'
import {
  ROFORMER_MODELS,
  createRoformerProgressParser,
  validateRoformerOptions,
} from '../main-src/roformerModels.js'

test('progress handles split chunks, carriage returns, noise, and clamps values', () => {
  const actual = []
  const parse = createRoformerProgressParser((n) => actual.push(n))
  parse('Loading weights 80%\n[====] 2')
  parse('5 %\r[=====] 100 %\r[===] 123 %\n')
  assert.deepEqual(actual, [0.25, 1, 1])
})

test('invalid inference options are rejected before spawning native code', () => {
  for (const options of [
    { chunkSize: 0, overlap: 2 },
    { chunkSize: 352800, overlap: 0 },
    { chunkSize: '352800', overlap: 2 },
  ]) {
    assert.throws(() => validateRoformerOptions(options))
  }
})

async function fixture(t, model) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'roformer-test-'))
  t.after(() => fs.rm(tmpDir, { recursive: true, force: true }))
  await fs.writeFile(path.join(tmpDir, model.file), 'GGUF')
  return {
    model,
    modelDir: tmpDir,
    executable: 'bs_roformer-cli',
    mediaPath: 'song with spaces.wav',
    tmpDir,
    options: { chunkSize: 352800, overlap: 2 },
    backend: 'auto',
  }
}

test('single-stem model creates unnormalized mixture-minus-vocals instrumental', async (t) => {
  const config = await fixture(t, ROFORMER_MODELS[0])
  const calls = []
  config.backend = 'cpu'
  config.run = async (command, args, options) => {
    calls.push({ command, args, options })
    await fs.writeFile(command === 'bs_roformer-cli' ? args[2] : args.at(-1), Buffer.alloc(100, 1))
  }
  const files = await separateRoformer(config)
  assert.deepEqual(
    files.map((f) => path.basename(f)),
    ['vocals.wav', 'instrumental.wav']
  )
  assert.equal(calls.length, 3)
  assert.equal(calls[0].args[calls[0].args.indexOf('-i') + 1], config.mediaPath)
  assert.equal(calls[0].args[calls[0].args.indexOf('-ar') + 1], '44100')
  assert.equal(calls[1].options.env.BSR_FORCE_CPU, '1')
  assert.match(calls[2].args.join(' '), /weights=1 -1:normalize=0:duration=first/)
})

test('Deux maps native stem 0 to vocals and stem 1 to instrumental without subtraction', async (t) => {
  const config = await fixture(t, ROFORMER_MODELS[1])
  let calls = 0
  config.run = async (command, args, options) => {
    calls++
    if (command === 'bs_roformer-cli') {
      assert.equal(options.env.BSR_FORCE_CPU, undefined)
      await fs.writeFile(args[2].replace('.wav', '_stem_0.wav'), Buffer.alloc(100, 1))
      await fs.writeFile(args[2].replace('.wav', '_stem_1.wav'), Buffer.alloc(100, 2))
    }
  }
  const files = await separateRoformer(config)
  assert.equal(calls, 2)
  assert.equal((await fs.readFile(files[0]))[0], 1)
  assert.equal((await fs.readFile(files[1]))[0], 2)
})

test('conversion failure or cancellation prevents inference and output publication', async (t) => {
  const config = await fixture(t, ROFORMER_MODELS[0])
  let calls = 0
  config.run = async () => {
    calls++
    throw new Error('cancelled')
  }
  await assert.rejects(separateRoformer(config), /cancelled/)
  assert.equal(calls, 1)
})

test('missing model gives an actionable setup error before conversion', async (t) => {
  const config = await fixture(t, ROFORMER_MODELS[0])
  await fs.rm(path.join(config.modelDir, config.model.file))
  config.run = () => assert.fail('must not spawn')
  await assert.rejects(separateRoformer(config), /npm run setup:roformer/)
})

test('successful exit without all expected native stems is rejected', async (t) => {
  const config = await fixture(t, ROFORMER_MODELS[1])
  config.run = async () => {}
  await assert.rejects(separateRoformer(config), /ENOENT/)
})
