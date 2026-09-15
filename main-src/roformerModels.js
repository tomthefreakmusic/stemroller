import { getMultistemModel } from './multistemModels.js'
// Checkpoint outputs follow the original training configs, not GGUF filenames.
// Downloads are pinned to a Hub revision and SHA-256, never a mutable main branch.
export const MODEL_REVISION = 'df802a6773d25ba6ef785ff619daa3e510503168'
export const ROFORMER_MODELS = [
  {
    id: 'gguf-bs-anvuew-q8',
    label: 'BS RoFormer Anvuew Q8',
    file: 'BSRoformer-anvuew-Q8_0.gguf',
    remotePath: 'anvuew/BS-RoFormer/BSRoformer-anvuew-Q8_0.gguf',
    sha256: 'f0b0093b29ec92aaf6a866973996953a6687df02e0cad68a3833672060c177af',
    stems: ['vocals'],
  },
  {
    id: 'gguf-mel-deux-q8',
    label: 'Mel-Band RoFormer Deux Q8',
    file: 'becruily_deux-Q8_0.gguf',
    remotePath: 'becruily/mel-band-roformer-deux/becruily_deux-Q8_0.gguf',
    sha256: '11247b33d4487728fe95bfb8ad56b386e32e46f34f690a23407c91e93ae36d16',
    stems: ['vocals', 'instrumental'],
  },
  {
    id: 'gguf-mel-gabox-q8',
    label: 'Mel-Band RoFormer Gabox FV6 Q8',
    file: 'voc_fv6-Q8_0.gguf',
    remotePath: 'GaboxR67/MelBandRoformers/melbandroformers/vocals/voc_fv6-Q8_0.gguf',
    sha256: '2cd84c9f24513749b0cb1a6ab3e3be5c5e2f7d0e8533e50512c1f394d2828a73',
    stems: ['vocals'],
  },
]

export const getRoformerModel = (id) => ROFORMER_MODELS.find((model) => model.id === id)
export const isSupportedModel = (id) =>
  ['htdemucs', 'htdemucs_ft', 'htdemucs_6s'].includes(id) ||
  Boolean(getRoformerModel(id)) ||
  Boolean(getMultistemModel(id))

export function validateRoformerOptions(options) {
  if (![176400, 352800, 573300].includes(options.chunkSize)) {
    throw new Error('Choose a supported RoFormer chunk size (4, 8, or 13 seconds).')
  }
  if (![2, 4].includes(options.overlap)) {
    throw new Error('RoFormer overlap must be 2 or 4.')
  }
  return { chunkSize: options.chunkSize, overlap: options.overlap }
}

// stdout may split a progress update across arbitrary stream chunks.
export function createRoformerProgressParser(onProgress) {
  let buffer = ''
  return (data) => {
    buffer += data.toString()
    const lines = buffer.split(/[\r\n]/)
    buffer = lines.pop().slice(-1024)
    for (const line of lines) {
      const match = line.match(/\]\s*(\d+)\s*%/)
      if (match) onProgress(Math.min(1, Math.max(0, Number(match[1]) / 100)))
    }
  }
}
