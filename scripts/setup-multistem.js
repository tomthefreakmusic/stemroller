import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import extractZip from 'extract-zip'
import { MULTISTEM_MODELS } from '../main-src/multistemModels.js'
import { downloadVerified } from './downloadVerified.js'

if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error('Automatic multi-stem setup currently supports Windows x64 only.')
}
const root = path.resolve(import.meta.dirname, '..')
const args = process.argv.slice(2)
if (args.length && (args.length !== 2 || args[0] !== '--app-dir')) {
  throw new Error('Usage: npm run setup:multistem [-- --app-dir PATH_TO_PORTABLE_APP]')
}
const appDir = args.length ? path.resolve(args[1]) : null
const runtime = appDir
  ? path.join(appDir, 'ThirdPartyApps', 'multistem', 'python')
  : path.join(root, 'win-extra-files', 'ThirdPartyApps', 'multistem', 'python')
const modelDir = appDir
  ? path.join(appDir, 'Models')
  : path.join(root, 'anyos-extra-files', 'Models')
const python = path.join(runtime, 'python.exe')

function run(arguments_, quiet = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(python, ['-I', ...arguments_], {
      windowsHide: true,
      stdio: quiet ? 'ignore' : 'inherit',
    })
    child.on('error', reject)
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`Python setup exited with ${code}`))
    )
  })
}

const verification = `import importlib.metadata as m, pathlib, torch, soundfile, yaml
from PoPE_pytorch import PoPE
for line in pathlib.Path(${JSON.stringify(path.join(root, 'python', 'requirements.txt'))}).read_text().splitlines():
 if line and not line.startswith('#'):
  name, version = line.split('=='); assert m.version(name) == version, name
assert torch.version.cuda == '12.6'
print('Isolated PyTorch CUDA runtime verified')`

let ready = false
try {
  await run(['-c', verification], true)
  ready = true
} catch {
  /* install below */
}
if (!ready) {
  console.log(
    'Installing isolated Python/PyTorch runtime. Allow about 6 GB for runtime and model files, plus download space.'
  )
  await fs.mkdir(runtime, { recursive: true })
  const archive = path.join(runtime, 'python.zip')
  await downloadVerified(
    'https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip',
    archive,
    '4acbed6dd1c744b0376e3b1cf57ce906f9dc9e95e68824584c8099a63025a3c3'
  )
  await extractZip(archive, { dir: runtime })
  await fs.rm(archive)
  await fs.writeFile(
    path.join(runtime, 'python312._pth'),
    'python312.zip\n.\nLib/site-packages\nimport site\n'
  )
  const pip = path.join(runtime, 'pip.zip')
  await downloadVerified(
    'https://files.pythonhosted.org/packages/29/a2/d40fb2460e883eca5199c62cfc2463fd261f760556ae6290f88488c362c0/pip-25.1.1-py3-none-any.whl',
    pip,
    '2913a38a2abf4ea6b64ab507bd9e967f3b53dc1ede74b01b0931e1ce548751af'
  )
  await extractZip(pip, { dir: path.join(runtime, 'Lib', 'site-packages') })
  await fs.rm(pip)
  await run([
    '-m',
    'pip',
    'install',
    '--no-cache-dir',
    '--disable-pip-version-check',
    'torch==2.7.1',
    '--index-url',
    'https://download.pytorch.org/whl/cu126',
  ])
  await run([
    '-m',
    'pip',
    'install',
    '--no-cache-dir',
    '--disable-pip-version-check',
    '-r',
    path.join(root, 'python', 'requirements.txt'),
  ])
}
await run(['-c', verification])
for (const model of MULTISTEM_MODELS) {
  await downloadVerified(model.url, path.join(modelDir, model.file), model.sha256)
}
if (appDir) {
  await fs.cp(path.join(root, 'python'), path.join(appDir, 'PythonInference'), {
    recursive: true,
    filter: (file) => !file.includes('__pycache__') && !file.endsWith('.pyc'),
  })
}
console.log('SCNet Large and four-stem BS PolarFormer are ready.')
