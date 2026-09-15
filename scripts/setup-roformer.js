import fs from 'node:fs/promises'
import path from 'node:path'
import extractZip from 'extract-zip'
import { ROFORMER_MODELS, MODEL_REVISION } from '../main-src/roformerModels.js'
import { downloadVerified } from './downloadVerified.js'

const root = path.resolve(import.meta.dirname, '..')
if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error(
    'Automatic RoFormer runtime setup currently supports Windows x64. See docs/ROFORMER.md for manual setup.'
  )
}
async function installRuntime(backend, asset, hash) {
  const runtimeDir = path.join(root, 'win-extra-files', 'ThirdPartyApps', 'bs-roformer', backend)
  const archive = path.join(runtimeDir, 'runtime.zip')
  await downloadVerified(
    `https://github.com/chenmozhijin/BSRoformer.cpp/releases/download/v0.1.0/${asset}`,
    archive,
    hash
  )
  await extractZip(archive, { dir: runtimeDir })
  async function findCli(dir) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name)
      if (entry.name === 'bs_roformer-cli.exe') return file
      if (entry.isDirectory()) {
        const result = await findCli(file)
        if (result) return result
      }
    }
  }
  const cli = await findCli(runtimeDir)
  if (!cli) throw new Error('Runtime archive did not contain bs_roformer-cli.exe')
  if (path.dirname(cli) !== runtimeDir)
    await fs.cp(path.dirname(cli), runtimeDir, { recursive: true })
  await fs.rm(archive)
}
await installRuntime(
  'vulkan',
  'BSRoformer-windows-vulkan.zip',
  'a47653911eb17f68e65bce15aed6c4f1bd277a5fbd48293c4e54f0b005b869a7'
)
// The CPU backend bundled in the Vulkan release can require unsupported CPU instructions.
// Use the separately built MSVC CPU release for the explicit CPU preference.
await installRuntime(
  'cpu',
  'BSRoformer-windows-x64-msvc.zip',
  'e002811d56605bce6a51c275cf8f9ba447a3707771289ea6fbcca7f4d3e9ba1f'
)
for (const model of ROFORMER_MODELS) {
  await downloadVerified(
    `https://huggingface.co/chenmozhijin/BSRoformer-GGUF/resolve/${MODEL_REVISION}/${model.remotePath}`,
    path.join(root, 'anyos-extra-files', 'Models', model.file),
    model.sha256
  )
}
console.log('RoFormer Vulkan/CPU runtimes and all three Q8 models are ready.')
