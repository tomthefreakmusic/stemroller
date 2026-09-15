import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'

export async function sha256(file) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

export async function downloadVerified(url, destination, expectedHash) {
  try {
    if ((await sha256(destination)) === expectedHash) return
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  await fs.mkdir(path.dirname(destination), { recursive: true })
  const temporary = `${destination}.partial`
  try {
    console.log(`Downloading ${path.basename(destination)}`)
    const response = await fetch(url, { signal: AbortSignal.timeout(30 * 60 * 1000) })
    if (!response.ok) throw new Error(`Download failed: HTTP ${response.status} (${url})`)
    await pipeline(response.body, createWriteStream(temporary))
    if ((await sha256(temporary)) !== expectedHash)
      throw new Error(`SHA-256 mismatch: ${destination}`)
    await fs.rename(temporary, destination)
  } finally {
    await fs.rm(temporary, { force: true })
  }
}
