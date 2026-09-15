import { separateMultistem } from './multistem.js'
import { getMultistemModel, validateMultistemOptions } from './multistemModels.js'
import { separateRoformer } from './roformer.js'
import {
  getRoformerModel,
  isSupportedModel,
  validateRoformerOptions,
  createRoformerProgressParser,
} from './roformerModels.js'
import os from 'os'
import fs from 'fs/promises'
import path from 'path'
import childProcess from 'child_process'
import treeKill from 'tree-kill'
import sanitizeFilename from 'sanitize-filename'
import { app, BrowserWindow, powerSaveBlocker } from 'electron'

let statusUpdateCallback = null,
  donateUpdateCallback = null
let ytCacheDir = null
let curItems = [],
  curChildProcess = null
let curProgressFtStemIdx = null
let activeJob = null

function getPathToThirdPartyApps() {
  if (process.env.STEMROLLER_THIRD_PARTY_APPS)
    return path.resolve(process.env.STEMROLLER_THIRD_PARTY_APPS)
  if (process.env.NODE_ENV === 'dev' || process.env.STEMROLLER_RUN_FROM_SOURCE) {
    if (process.platform === 'win32') {
      return path.resolve(path.join(import.meta.dirname, '..', 'win-extra-files', 'ThirdPartyApps'))
    } else if (process.platform === 'darwin') {
      return path.resolve(path.join(import.meta.dirname, '..', 'mac-extra-files', 'ThirdPartyApps'))
    } else {
      return null
    }
  } else {
    if (process.platform === 'win32' || process.platform === 'darwin') {
      return path.resolve(path.join(process.resourcesPath, '..', 'ThirdPartyApps'))
    } else {
      return null
    }
  }
}

function getPathToModels() {
  if (process.env.NODE_ENV === 'dev' || process.env.STEMROLLER_RUN_FROM_SOURCE) {
    if (process.platform === 'win32' || process.platform === 'darwin') {
      return path.resolve(path.join(import.meta.dirname, '..', 'anyos-extra-files', 'Models'))
    } else {
      return null
    }
  } else {
    if (process.platform === 'win32' || process.platform === 'darwin') {
      return path.resolve(path.join(process.resourcesPath, '..', 'Models'))
    } else {
      return null
    }
  }
}

const PATH_TO_THIRD_PARTY_APPS = getPathToThirdPartyApps()
const PATH_TO_MODELS = getPathToModels()
const PATH_TO_DEMUCS = PATH_TO_THIRD_PARTY_APPS
  ? path.join(PATH_TO_THIRD_PARTY_APPS, 'demucs-cxfreeze')
  : null
const PATH_TO_FFMPEG = PATH_TO_THIRD_PARTY_APPS
  ? path.join(PATH_TO_THIRD_PARTY_APPS, 'ffmpeg', 'bin')
  : null
const PATH_TO_YT_DLP = PATH_TO_THIRD_PARTY_APPS
  ? path.join(PATH_TO_THIRD_PARTY_APPS, 'yt-dlp')
  : null
const PATH_TO_DENO = PATH_TO_THIRD_PARTY_APPS ? path.join(PATH_TO_THIRD_PARTY_APPS, 'deno') : null
const DEMUCS_EXE_NAME = PATH_TO_THIRD_PARTY_APPS ? 'demucs-cxfreeze' : 'demucs'
const FFMPEG_EXE_NAME = 'ffmpeg'
const YT_DLP_EXE_NAME = 'yt-dlp'
const CHILD_PROCESS_ENV = {
  ...process.env,
  LANG: null, // Will be set when ready to split, since we can only check system locale after `app` is ready
}
if (PATH_TO_THIRD_PARTY_APPS) {
  // Override the system's PATH with the path to our own bundled third-party apps
  CHILD_PROCESS_ENV.PATH =
    PATH_TO_DEMUCS +
    (process.platform === 'win32' ? ';' : ':') +
    PATH_TO_FFMPEG +
    (process.platform === 'win32' ? ';' : ':') +
    PATH_TO_YT_DLP +
    (process.platform === 'win32' ? ';' : ':') +
    PATH_TO_DENO
}
const TMP_PREFIX = '.stemroller-'

function getJobCount() {
  const MAX_NUM_JOBS = 4
  const numMemories = Math.floor(os.freemem() / 2000000000) // Need approximately 2GB per track
  const numCpus = os.cpus().length
  return Math.max(1, Math.min(Math.min(numCpus, numMemories), MAX_NUM_JOBS))
}

function killCurChildProcess() {
  if (curChildProcess) {
    try {
      console.trace(`treeKill process ${curChildProcess.pid}`)
      treeKill(curChildProcess.pid)
    } catch (err) {
      console.trace(`treeKill failed: ${err}`)
    }
    curChildProcess = null
  }
}

function updateProgressRaw(videoId, progress) {
  let mainWindow = BrowserWindow.getAllWindows()[0]
  if (!mainWindow) {
    return
  }
  mainWindow.webContents.send('videoStatusUpdate', {
    videoId,
    status: {
      step: 'processing',
      progress,
    },
  })
}

function updateDemucsProgress(videoId, data) {
  // Check if the output contains the progress update
  const progressMatch = data.toString().match(/\r\s+\d+%\|/)
  if (progressMatch) {
    let progress = parseInt(progressMatch)
    if (isNaN(progress)) {
      return
    }
    if (curProgressFtStemIdx !== null && progress === 0) {
      ++curProgressFtStemIdx
    }
    progress /= 100
    updateProgressRaw(
      videoId,
      (curProgressFtStemIdx === null ? progress : (curProgressFtStemIdx - 1) / 4 + progress / 4) *
        0.95
    )
  }
}

function spawnAndWait(videoId, cwd, command, args, isDemucs, options = {}) {
  return new Promise((resolve, reject) => {
    if (activeJob?.cancelled) return reject(new Error('Task cancelled'))
    CHILD_PROCESS_ENV.LANG = `${(app.getSystemLocale() || 'en-US').replace('-', '_')}.UTF-8`
    const child = childProcess.spawn(command, args, {
      cwd,
      env: { ...CHILD_PROCESS_ENV, ...options.env },
      windowsHide: true,
    })
    curChildProcess = child
    let errorTail = ''
    const reportProgress = createRoformerProgressParser((progress) =>
      updateProgressRaw(videoId, progress * 0.95)
    )
    child.stdout.on('data', (data) => {
      console.log(`child stdout: ${data}`)
      if (options.roformer) reportProgress(data)
    })
    child.stderr.on('data', (data) => {
      console.log(`child stderr: ${data}`)
      errorTail = (errorTail + data.toString()).slice(-2000)
      if (isDemucs) updateDemucsProgress(videoId, data)
    })
    child.on('error', (error) => {
      reject(error)
      if (curChildProcess === child) curChildProcess = null
    })
    child.on('close', (code, signal) => {
      if (activeJob?.cancelled) reject(new Error('Task cancelled'))
      else if (signal !== null) reject(new Error(`Child process exited due to signal: ${signal}`))
      else if (code !== 0)
        reject(new Error(`${path.basename(command)} exited with code ${code}. ${errorTail}`))
      else resolve(code)
      if (curChildProcess === child) curChildProcess = null
    })
  })
}

async function createYtCacheDir() {
  if (ytCacheDir) {
    return
  }

  ytCacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'StemRoller-cache-'))
}

export async function deleteYtCacheDir() {
  if (!ytCacheDir) {
    return
  }

  try {
    await fs.rm(ytCacheDir, {
      recursive: true,
      maxRetries: 5,
      retryDelay: 1000,
    })
    console.log(`Deleted cache folder "${ytCacheDir}"`)
  } catch (error) {
    console.trace(error)
  }
}

async function downloadYoutube(videoId, downloadPath) {
  await createYtCacheDir()
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`
  const ytDlpExeArgs = [
    '-f',
    'bestaudio',
    '--cache-dir',
    ytCacheDir,
    '-o',
    path.basename(downloadPath),
    '--newline',
    '--progress',
    videoUrl,
  ]
  await spawnAndWait(videoId, path.dirname(downloadPath), YT_DLP_EXE_NAME, ytDlpExeArgs, false)
}

async function findDemucsOutputDir(basePath) {
  const entries = await fs.readdir(basePath, {
    withFileTypes: true,
  })
  for (const entry of entries) {
    if (entry.isDirectory()) {
      return path.join(basePath, entry.name)
    }
  }
  throw new Error('Unable to find Demucs output directory')
}

async function listDemucsOutputFiles(basePath) {
  const files = []
  const entries = await fs.readdir(basePath, {
    withFileTypes: true,
  })
  for (const entry of entries) {
    if (entry.isFile()) {
      files.push(path.join(basePath, entry.name))
    }
  }
  return files
}

async function ensureFileExists(path) {
  try {
    await fs.access(path)
    return true
  } catch (error) {
    return false
  }
}

async function convertDemucsFiles({ videoId, tmpDir, filesList, filetype, compressionArgs }) {
  console.log(`Converting files to format "${filetype}"`)

  const result = []
  for (const oldFilename of filesList) {
    const parsedOldFilename = path.parse(oldFilename)
    const newFilename = `${path.join(parsedOldFilename.dir, parsedOldFilename.name)}.${filetype}`

    await spawnAndWait(
      videoId,
      tmpDir,
      FFMPEG_EXE_NAME,
      ['-i', oldFilename, ...compressionArgs, newFilename],
      false
    )

    const success = await ensureFileExists(newFilename)
    if (!success) {
      throw new Error(`Unable to access converted file "${newFilename}" - ffmpeg probably failed`)
    }

    result.push(newFilename)
  }

  return result
}

function getFfmpegCompressionArguments(filetype) {
  if (filetype === 'mp3') {
    return ['-q:a', '0']
  } else if (filetype === 'flac') {
    return ['-compression_level', '5']
  } else if (filetype === 'wav') {
    return []
  }
  throw new Error(`Unrecognized filetype: ${filetype}`)
}

async function _processVideo(video, tmpDir, outputBasePathContainingFolder) {
  const demucsModelName = getModelName()
  const roformerModel = getRoformerModel(demucsModelName)
  const multistemModel = getMultistemModel(demucsModelName)
  const multistemOptions = getMultistemOptions()
  const roformerOptions = getRoformerOptions()
  const backend = getPyTorchBackend()
  const demucsStemsFiletype = getOutputFormat()
  const compressionArgs = getFfmpegCompressionArguments(demucsStemsFiletype)
  const needsPrefix = getPrefixStemFilenameWithSongName()
  const needsOriginal = getPreserveOriginalAudio()

  const beginTime = Date.now()
  console.log(`BEGIN downloading/processing video "${video.videoId}" - "${video.title}"`)
  setVideoStatusAndPath(video.videoId, { step: 'downloading' }, null)

  let mediaPath = null

  if (video.mediaSource === 'youtube') {
    const ytFilename = 'yt-audio'
    const ytPath = path.join(tmpDir, ytFilename)
    console.log(`Downloading YouTube video "${video.videoId}"; storing in "${ytPath}"`)
    await downloadYoutube(video.videoId, ytPath)
    mediaPath = ytPath
  } else if (video.mediaSource === 'local') {
    mediaPath = video.localInputPath
  } else {
    throw new Error(`Invalid mediaSource: ${video.mediaSource}`)
  }

  const outputFolderName =
    video.mediaSource === 'youtube'
      ? sanitizeFilename(`${video.title}-${video.videoId}`)
      : sanitizeFilename(video.title)
  const outputFilenamesPrefix = needsPrefix ? `${outputFolderName} - ` : ''

  setVideoStatusAndPath(
    video.videoId,
    {
      step: 'processing',
      progress: 0,
    },
    null
  )
  let demucsWavFilesList
  if (multistemModel) {
    demucsWavFilesList = await separateMultistem({
      model: multistemModel,
      modelDir:
        process.env.STEMROLLER_MODELS_DIR ||
        PATH_TO_MODELS ||
        path.join(app.getPath('userData'), 'Models'),
      python:
        process.env.STEMROLLER_MULTISTEM_PYTHON ||
        path.join(PATH_TO_THIRD_PARTY_APPS || '', 'multistem', 'python', 'python.exe'),
      script:
        process.env.NODE_ENV === 'dev' || process.env.STEMROLLER_RUN_FROM_SOURCE
          ? path.resolve(import.meta.dirname, '..', 'python', 'separate.py')
          : path.resolve(process.resourcesPath, '..', 'PythonInference', 'separate.py'),
      mediaPath,
      tmpDir,
      options: multistemOptions,
      backend,
      run: (command, args, options) =>
        spawnAndWait(video.videoId, tmpDir, command, args, false, options),
    })
  } else if (roformerModel) {
    demucsWavFilesList = await separateRoformer({
      model: roformerModel,
      modelDir:
        process.env.STEMROLLER_MODELS_DIR ||
        PATH_TO_MODELS ||
        path.join(app.getPath('userData'), 'Models'),
      executable:
        process.env.STEMROLLER_ROFORMER_EXE ||
        (PATH_TO_THIRD_PARTY_APPS
          ? path.join(
              PATH_TO_THIRD_PARTY_APPS,
              'bs-roformer',
              backend === 'cpu' ? 'cpu' : 'vulkan',
              process.platform === 'win32' ? 'bs_roformer-cli.exe' : 'bs_roformer-cli'
            )
          : 'bs_roformer-cli'),
      mediaPath,
      tmpDir,
      options: roformerOptions,
      backend,
      run: (command, args, options) =>
        spawnAndWait(video.videoId, tmpDir, command, args, false, options),
    })
  } else {
    const jobCount = getJobCount()
    console.log(
      `Splitting video "${video.videoId}"; ${jobCount} jobs using model "${demucsModelName}"...`
    )
    const demucsExeArgs = [mediaPath, '-n', demucsModelName, '-j', jobCount]
    if (backend === 'cpu') {
      console.log('Running with "-d cpu" to force CPU instead of CUDA')
      demucsExeArgs.push('-d', 'cpu')
    } else if (process.platform === 'darwin') {
      // Maybe need to apply https://github.com/facebookresearch/demucs/pull/575/files instead, in case MPS is not available on Intel Macs ??
      console.log('Running with "-d mps" to force MPS instead of CPU/CUDA')
      demucsExeArgs.push('-d', 'mps')
    }

    if (PATH_TO_MODELS) {
      demucsExeArgs.push('--repo', PATH_TO_MODELS)
    }
    if (demucsModelName.indexOf('_ft') >= 0) {
      curProgressFtStemIdx = 0
    } else {
      curProgressFtStemIdx = null
    }
    await spawnAndWait(video.videoId, tmpDir, DEMUCS_EXE_NAME, demucsExeArgs, true)
    curProgressFtStemIdx = null
    updateProgressRaw(video.videoId, 0.95)

    const demucsBasePath = await findDemucsOutputDir(
      path.join(tmpDir, 'separated', demucsModelName)
    )
    demucsWavFilesList = await listDemucsOutputFiles(demucsBasePath)
  }
  if (demucsWavFilesList.length === 0) {
    throw new Error('No .wav output stems written - Demucs probably failed')
  }
  const demucsConvertedFilesList =
    demucsStemsFiletype === 'wav'
      ? demucsWavFilesList
      : await convertDemucsFiles({
          videoId: video.videoId,
          tmpDir,
          filesList: demucsWavFilesList,
          filetype: demucsStemsFiletype,
          compressionArgs,
        })
  updateProgressRaw(video.videoId, 0.97)

  let instrumentalPath
  if (roformerModel) {
    instrumentalPath = demucsConvertedFilesList.find(
      (file) => path.parse(file).name === 'instrumental'
    )
  } else {
    instrumentalPath = path.join(tmpDir, `instrumental.${demucsStemsFiletype}`)
    console.log(`Mixing down instrumental stems to "${instrumentalPath}"`)
    const ffmpegInstrumentalSourceFiles = []
    for (const filename of demucsWavFilesList) {
      const baseName = path.parse(filename).name
      if (baseName === 'vocals') {
        continue
      }
      ffmpegInstrumentalSourceFiles.push('-i')
      ffmpegInstrumentalSourceFiles.push(filename)
    }
    await spawnAndWait(
      video.videoId,
      tmpDir,
      FFMPEG_EXE_NAME,
      [
        ...ffmpegInstrumentalSourceFiles,
        ...compressionArgs,
        '-filter_complex',
        `amix=inputs=${ffmpegInstrumentalSourceFiles.length / 2}:normalize=0`,
        instrumentalPath,
      ],
      false
    )
    const instrumentalSuccess = await ensureFileExists(instrumentalPath)
    if (!instrumentalSuccess) {
      throw new Error(
        `Unable to access instrumental file "${instrumentalPath}" - ffmpeg probably failed`
      )
    }
  }
  updateProgressRaw(video.videoId, 0.98)

  let originalOutPath = null
  if (needsOriginal) {
    originalOutPath = path.join(tmpDir, `original.${demucsStemsFiletype}`)
    await spawnAndWait(
      video.videoId,
      tmpDir,
      FFMPEG_EXE_NAME,
      ['-i', mediaPath, ...compressionArgs, originalOutPath],
      false
    )
    const originalSuccess = await ensureFileExists(originalOutPath)
    if (!originalSuccess) {
      throw new Error(
        `Unable to access instrumental file "${originalOutPath}" - ffmpeg probably failed`
      )
    }
  }
  updateProgressRaw(video.videoId, 0.99)

  if (activeJob?.cancelled) throw new Error('Task cancelled')
  // Separate model comparisons so two-stem results never inherit old Demucs stem files.
  const outputBasePath = path.join(
    outputBasePathContainingFolder,
    roformerModel || multistemModel ? `${outputFolderName} - ${demucsModelName}` : outputFolderName
  )
  await fs.mkdir(outputBasePath, { recursive: true })
  console.log(`Copying all stems to "${outputBasePath}"`)
  for (const filename of demucsConvertedFilesList) {
    if (activeJob?.cancelled) throw new Error('Task cancelled')
    const baseName = path.parse(filename).name
    const outputPath = path.join(
      outputBasePath,
      `${outputFilenamesPrefix}${baseName}.${demucsStemsFiletype}`
    )
    await fs.copyFile(filename, outputPath)
  }
  await fs.copyFile(
    instrumentalPath,
    path.join(outputBasePath, `${outputFilenamesPrefix}instrumental.${demucsStemsFiletype}`)
  )
  if (needsOriginal) {
    await fs.copyFile(
      originalOutPath,
      path.join(outputBasePath, `${outputFilenamesPrefix}original.${demucsStemsFiletype}`)
    )
  }

  const elapsedSeconds = (Date.now() - beginTime) * 0.001
  console.log(
    `DONE processing video "${video.videoId}" - "${video.title}" (finished in ${Math.round(
      elapsedSeconds
    )} seconds`
  )
  if (activeJob?.cancelled) throw new Error('Task cancelled')
  setVideoStatusAndPath(video.videoId, { step: 'done' }, outputBasePath)
}

async function processVideo(video) {
  let powerSaveBlockId = null

  try {
    powerSaveBlockId = powerSaveBlocker.start('prevent-app-suspension')
    console.log('Successfully blocked power-save using policy: "prevent-app-suspension"')
  } catch (err) {
    powerSaveBlockId = null
    console.trace(err)
  }

  let tmpDir = null
  try {
    // Keep large decoded audio and stems on the selected output drive.
    // Capture the destination once so changing Preferences cannot move a running job.
    const outputFolder =
      video.mediaSource === 'local' && getLocalFileOutputToContainingDir()
        ? path.dirname(video.localInputPath)
        : getOutputPath()
    await fs.mkdir(outputFolder, { recursive: true })
    tmpDir = await fs.mkdtemp(path.join(outputFolder, TMP_PREFIX))
    await _processVideo(video, tmpDir, outputFolder)
  } catch (err) {
    console.trace(err)

    const status = getVideoStatus(video.videoId)
    if (status === null || activeJob?.cancelled) {
      console.log('Task was canceled by user.')
    } else {
      setVideoStatusAndPath(video.videoId, { step: 'error', message: err.message }, null)
    }
  } finally {
    curProgressFtStemIdx = null

    try {
      if (tmpDir)
        await fs.rm(tmpDir, {
          recursive: true,
          maxRetries: 5,
          retryDelay: 1000,
        })
    } catch (err) {
      console.trace(err)
    }

    // Will filter out the current (completed) video
    activeJob = null
    setItems(curItems)

    if (powerSaveBlockId !== null) {
      try {
        powerSaveBlocker.stop(powerSaveBlockId)
        console.log('Successfully unblocked power-save')
      } catch (err) {
        console.error('Failed to unblock power-save')
        console.trace(err)
      }
      powerSaveBlockId = null
    }
  }
}

export const setItems = async (items) => {
  items = items.filter((video) => {
    let status = getVideoStatus(video.videoId)
    if (status === null) {
      status = { step: 'queued' }
      setVideoStatusAndPath(video.videoId, status, null)
    }
    return status.step !== 'done' && status.step !== 'error'
  })

  const newVideoId = items.length > 0 ? items[0].videoId : null
  curItems = items
  if (activeJob && activeJob.videoId !== newVideoId) {
    activeJob.cancelled = true
    killCurChildProcess()
  }
  // Wait for cancellation and temporary-file cleanup before starting another job.
  if (!activeJob && curItems.length > 0) {
    const video = curItems[0]
    activeJob = { videoId: video.videoId, cancelled: false }
    setTimeout(() => processVideo(video), 0)
  }
}

let electronStore = null
let videosDb = {}

async function loadVideosDb() {
  const loaded = electronStore.get('videosDb') || {}
  const filtered = {}

  for (const videoId in loaded) {
    let exists = false

    try {
      await fs.access(loaded[videoId].path)
      exists = true
    } catch (error) {
      exists = false
    }

    if (exists) {
      filtered[videoId] = loaded[videoId]
    }
  }

  videosDb = filtered
  electronStore.set('videosDb', videosDb)
}

function saveFinishedToVideosDb() {
  let numFinished = 0
  const filtered = {}
  for (const videoId in videosDb) {
    if (videosDb[videoId].status.step === 'done') {
      filtered[videoId] = videosDb[videoId]
      ++numFinished
    }
  }
  electronStore.set('videosDb', filtered)

  if (numFinished >= 3 && electronStore.get('canShowDonatePopup') !== false) {
    donateUpdateCallback({
      showDonatePopup: true,
    })
  }
}

function setVideoStatusAndPath(videoId, status, path) {
  videosDb[videoId] = {
    status,
    path,
  }
  saveFinishedToVideosDb()

  statusUpdateCallback({
    videoId,
    ...videosDb[videoId],
  })
}

export const setElectronStore = (store) => {
  electronStore = store
  return loadVideosDb()
}

export const getOutputPath = () => {
  if (electronStore) {
    const outputPath = electronStore.get('outputPath')
    if (outputPath) {
      return outputPath
    }
  }
  return path.join(os.homedir(), 'Music', 'StemRoller')
}

export const getModelName = () => {
  if (electronStore) {
    const modelName = electronStore.get('modelName')
    if (modelName) {
      return modelName
    }
  }
  return 'htdemucs'
}

export const getLocalFileOutputToContainingDir = () => {
  return electronStore.get('localFileOutputToContainingDir') || false
}

export const getPrefixStemFilenameWithSongName = () => {
  return electronStore.get('prefixStemFilenameWithSongName') || false
}

export const getPreserveOriginalAudio = () => {
  return electronStore.get('preserveOriginalAudio') || false
}

export const setOutputPath = (outputPath) => {
  electronStore.set('outputPath', outputPath)
}

export const setModelName = (name) => {
  if (!isSupportedModel(name)) throw new Error('Unsupported separation model')
  electronStore.set('modelName', name)
}

export const setLocalFileOutputToContainingDir = (value) => {
  electronStore.set('localFileOutputToContainingDir', value)
}

export const setPrefixStemFilenameWithSongName = (value) => {
  electronStore.set('prefixStemFilenameWithSongName', value)
}

export const setPreserveOriginalAudio = (value) => {
  electronStore.set('preserveOriginalAudio', value)
}

export const getOutputFormat = () => {
  if (electronStore) {
    const outputFormat = electronStore.get('outputFormat')
    if (outputFormat) {
      return outputFormat
    }
  }
  return 'wav'
}

export const setOutputFormat = (outputFormat) => {
  electronStore.set('outputFormat', outputFormat)
}

export const getPyTorchBackend = () => {
  if (electronStore) {
    const backend = electronStore.get('pyTorchBackend')
    if (backend) {
      return backend
    }
  }
  return 'auto'
}

export const setPyTorchBackend = (backend) => {
  electronStore.set('pyTorchBackend', backend)
}

export const getVideoStatus = (videoId) => {
  if (videoId in videosDb) {
    return videosDb[videoId].status
  } else {
    return null
  }
}

export const getVideoPath = (videoId) => {
  if (videoId in videosDb) {
    return videosDb[videoId].path
  } else {
    return null
  }
}

export const deleteVideoStatusAndPath = (videoId) => {
  if (videoId in videosDb) {
    const nulledEntry = videosDb[videoId]
    for (const i in nulledEntry) {
      nulledEntry[i] = null
    }

    delete videosDb[videoId]
    saveFinishedToVideosDb()

    statusUpdateCallback({
      videoId,
      ...nulledEntry,
    })
  }
}

export const isBusy = () => {
  return (
    curItems.filter((video) => {
      const status = getVideoStatus(video.videoId)
      return status?.step === 'processing' || status?.step === 'downloading'
    }).length > 0
  )
}

export const registerStatusUpdateCallback = (callback) => {
  statusUpdateCallback = callback
}

export const registerDonateUpdateCallback = (callback) => {
  donateUpdateCallback = callback
}

export const deleteTmpFolders = async () => {
  const tmpBasePath = os.tmpdir()
  const items = await fs.readdir(tmpBasePath)
  for (const itemName of items) {
    if (itemName.indexOf(TMP_PREFIX) === 0) {
      try {
        const itemPath = path.join(tmpBasePath, itemName)
        await fs.rm(itemPath, {
          recursive: true,
          maxRetries: 5,
          retryDelay: 1000,
        })
        console.log(`Deleted temporary folder "${itemPath}"`)
      } catch (error) {
        console.trace(error)
      }
    }
  }
}

export const getRoformerOptions = () =>
  validateRoformerOptions(
    electronStore?.get('roformerOptions') || { chunkSize: 352800, overlap: 2 }
  )

export const setRoformerOptions = (options) => {
  electronStore.set('roformerOptions', validateRoformerOptions(options))
}

export const getMultistemOptions = () =>
  validateMultistemOptions(
    electronStore?.get('multistemOptions') || { chunkSize: 176400, overlap: 2 }
  )
export const setMultistemOptions = (options) => {
  electronStore.set('multistemOptions', validateMultistemOptions(options))
}
