<script>
  import { onMount } from 'svelte'
  import { ROFORMER_MODELS } from '../../main-src/roformerModels.js'
  import Button from '$components/Button.svelte'
  import CogIcon from '$icons/outline/CogIcon.svelte'
  import XIcon from '$icons/outline/XIcon.svelte'
  import FolderOpenIcon from '$icons/solid/FolderOpenIcon.svelte'

  export let onCloseClick = null

  let pyTorchBackend = null
  let outputPath = null
  let modelName = null
  let outputFormat = null
  let localFileOutputToContainingDir = null
  let prefixStemFilenameWithSongName = null
  let preserveOriginalAudio = null
  let chunkSize = 352800
  let overlap = 2
  let mounted = false
  $: isRoformer = modelName?.startsWith('gguf-')
  $: if (mounted) window.setRoformerOptions({ chunkSize, overlap })

  async function handleBrowseStems() {
    const newOutputPath = await window.browseOutputPath()
    if (newOutputPath) {
      outputPath = newOutputPath
    }
  }

  onMount(async () => {
    pyTorchBackend = await window.getPyTorchBackend()
    outputPath = await window.getOutputPath()
    modelName = await window.getModelName()
    outputFormat = await window.getOutputFormat()
    localFileOutputToContainingDir = await window.getLocalFileOutputToContainingDir()
    prefixStemFilenameWithSongName = await window.getPrefixStemFilenameWithSongName()
    preserveOriginalAudio = await window.getPreserveOriginalAudio()
    const options = await window.getRoformerOptions()
    chunkSize = options.chunkSize
    overlap = options.overlap
    mounted = true
  })

  $: {
    if (mounted && pyTorchBackend) {
      window.setPyTorchBackend(pyTorchBackend)
    }
  }
  $: {
    if (mounted && modelName) {
      window.setModelName(modelName)
    }
  }
  $: {
    if (mounted && outputFormat) {
      window.setOutputFormat(outputFormat)
    }
  }
  $: {
    if (mounted && localFileOutputToContainingDir !== null) {
      window.setLocalFileOutputToContainingDir(localFileOutputToContainingDir)
    }
  }
  $: {
    if (mounted && prefixStemFilenameWithSongName !== null) {
      window.setPrefixStemFilenameWithSongName(prefixStemFilenameWithSongName)
    }
  }
  $: {
    if (mounted && preserveOriginalAudio !== null) {
      window.setPreserveOriginalAudio(preserveOriginalAudio)
    }
  }
</script>

<div
  class="absolute flex flex-col left-2 bottom-12 z-[9999] w-[28rem] max-h-[calc(100vh-4rem)] overflow-y-auto px-4 py-3 drop-shadow-lg bg-slate-800 text-slate-300 rounded-md border-solid border border-slate-700"
>
  <div class="space-x-2 flex flex-row items-center mb-2">
    <div class="w-6 h-6 grow-0 shrink-0">
      <CogIcon />
    </div>

    <div class="font-bold text-xl grow-0 shrink-0">Preferences</div>

    <div class="w-full grow-1 shrink-1"></div>

    <button class="w-6 h-6 grow-0 shrink-0" on:click={onCloseClick}>
      <XIcon />
    </button>
  </div>

  <div class="text-lg font-bold mb-1">Stems output path</div>

  <div class="flex flex-row space-x-2 mb-2">
    <div
      class="flex-1 w-full min-w-0 border-solid border border-slate-700 bg-slate-900 text-slate-300 px-2 py-2 rounded-md truncate"
    >
      {outputPath || ''}
    </div>
    <Button Icon={FolderOpenIcon} text="Browse" onClick={handleBrowseStems} />
  </div>

  <div class="space-x-2 flex flex-row items-center justify-start mb-2">
    <input
      id="checkboxLocalFileOutputToContainingDir"
      type="checkbox"
      class="w-4 h-4 grow-0 shrink-0"
      bind:checked={localFileOutputToContainingDir}
    />

    <label for="checkboxLocalFileOutputToContainingDir" class="grow-0 shrink-0"
      >When splitting local files, use input file directory</label
    >
  </div>

  <div class="space-x-2 flex flex-row items-center justify-start mb-2">
    <input
      id="checkboxPrefixStemFilenameWithSongName"
      type="checkbox"
      class="w-4 h-4 grow-0 shrink-0"
      bind:checked={prefixStemFilenameWithSongName}
    />

    <label for="checkboxPrefixStemFilenameWithSongName" class="grow-0 shrink-0"
      >Prefix stem name with song name</label
    >
  </div>

  <div class="space-x-2 flex flex-row items-center justify-start mb-2">
    <input
      id="checkboxPreserveOriginalAudio"
      type="checkbox"
      class="w-4 h-4 grow-0 shrink-0"
      bind:checked={preserveOriginalAudio}
    />

    <label for="checkboxPreserveOriginalAudio" class="grow-0 shrink-0"
      >Preserve original audio</label
    >
  </div>

  <div class="text-lg font-bold mb-1">Stems output format</div>

  <select
    class="border-solid border border-slate-700 bg-slate-900 text-slate-300 focus:outline-none focus:ring focus:ring-cyan-300 px-2 py-1 mb-2 rounded-md"
    bind:value={outputFormat}
  >
    <option value="wav" class="bg-slate-900 text-slate-300 px-2 py-1">WAV</option>
    <option value="flac" class="bg-slate-900 text-slate-300 px-2 py-1">FLAC</option>
    <option value="mp3" class="bg-slate-900 text-slate-300 px-2 py-1">MP3</option>
  </select>

  <div class="text-lg font-bold mb-1">Separation model</div>

  <select
    class="border-solid border border-slate-700 bg-slate-900 text-slate-300 focus:outline-none focus:ring focus:ring-cyan-300 px-2 py-1 mb-2 rounded-md"
    bind:value={modelName}
  >
    <optgroup label="Demucs ï¿½ individual instruments">
      <option value="htdemucs">Demucs: 4 stems (Fast)</option>
      <option value="htdemucs_ft">Demucs: 4 stems (Finetuned)</option>
      <option value="htdemucs_6s">Demucs: 6 stems (Experimental)</option>
    </optgroup>
    <optgroup label="RoFormer GGUF ï¿½ vocals + instrumental">
      {#each ROFORMER_MODELS as model}
        <option value={model.id}>{model.label}</option>
      {/each}
    </optgroup>
  </select>

  {#if isRoformer}
    <p class="mb-2 text-sm">
      Produces vocals and instrumental in a separate model folder. Q8 models use less memory than
      full precision weights.
    </p>
    {#if modelName === 'gguf-mel-deux-q8'}
      <p class="mb-2 text-sm">
        Deux predicts both stems directly. Model license: CC BY-NC 4.0 (noncommercial).
      </p>
    {/if}
    <label for="roformerChunk" class="font-bold">Audio chunk size</label>
    <select
      id="roformerChunk"
      bind:value={chunkSize}
      class="bg-slate-900 px-2 py-1 mb-2 rounded-md"
    >
      <option value={176400}>4 seconds (lower GPU memory)</option>
      <option value={352800}>8 seconds (default)</option>
      <option value={573300}>13 seconds (more GPU memory)</option>
    </select>
    <label for="roformerOverlap" class="font-bold">Overlap</label>
    <select
      id="roformerOverlap"
      bind:value={overlap}
      class="bg-slate-900 px-2 py-1 mb-2 rounded-md"
    >
      <option value={2}>2 (faster)</option>
      <option value={4}>4 (smoother joins, slower)</option>
    </select>
    <p class="mb-2 text-sm">
      If GPU memory runs out, try 4-second chunks. Source builds need npm run setup:roformer before
      first use.
    </p>
  {/if}

  <div class="text-lg font-bold mb-1">Backend</div>

  <p class="mb-2 italic">Try &quot;Always use CPU&quot; if splitting fails on your device.</p>

  <select
    class="border-solid border border-slate-700 bg-slate-900 text-slate-300 focus:outline-none focus:ring focus:ring-cyan-300 px-2 py-1 rounded-md"
    bind:value={pyTorchBackend}
  >
    <option value="auto" class="bg-slate-900 text-slate-300 px-2 py-1"
      >Use GPU (if available)</option
    >
    <option value="cpu" class="bg-slate-900 text-slate-300 px-2 py-1">Always use CPU</option>
  </select>
</div>
