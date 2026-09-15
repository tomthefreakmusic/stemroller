export const MULTISTEM_MODELS = [
  {
    id: 'torch-scnet-large',
    label: 'SCNet Large — 4 stems',
    architecture: 'scnet-large',
    file: 'SCNet-large_starrytong_fixed.ckpt',
    url: 'https://github.com/ZFTurbo/Music-Source-Separation-Training/releases/download/v1.0.9/SCNet-large_starrytong_fixed.ckpt',
    sha256: '65900dfa07d6b6e5d784c0f143920200a4bd281d6e78a806c549d0b912d5885e',
    stems: ['drums', 'bass', 'other', 'vocals'],
  },
  {
    id: 'torch-bs-polarformer-four',
    label: 'BS PolarFormer Aname — 4 stems',
    architecture: 'polarformer-four-stem',
    file: 'bs_pope_4stem_09072026_aname.ckpt',
    url: 'https://huggingface.co/noblebarkrr/mvsepless_resources/resolve/030a01aa951b3908ed6b01b2e507c17953300c2d/bs_roformer/bs_pope_4stem_09072026_aname.ckpt',
    sha256: 'e2f9a32d22ee4e2e67f247ad89b3d8d3a55c0f2df8d8c2b789218a07fbd6d448',
    // The checkpoint config is authoritative; the mirror's catalog has a different order.
    stems: ['vocals', 'other', 'drums', 'bass'],
  },
]

export const getMultistemModel = (id) => MULTISTEM_MODELS.find((model) => model.id === id)

export function validateMultistemOptions(options) {
  if (
    !options ||
    ![176400, 352800, 485100].includes(options.chunkSize) ||
    ![2, 4].includes(options.overlap)
  ) {
    throw new Error('Choose 4, 8, or 11-second chunks and overlap 2 or 4 for multi-stem models.')
  }
  return { chunkSize: options.chunkSize, overlap: options.overlap }
}
