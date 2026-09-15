import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { downloadVerified } from '../scripts/downloadVerified.js'

test('downloads verify hashes, reuse valid cache, and remove corrupt partial files', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'verified-download-'))
  let requests = 0
  const server = createServer((req, res) => {
    requests++
    res.end('model-data')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve))
    await fs.rm(root, { recursive: true, force: true })
  })
  const url = `http://127.0.0.1:${server.address().port}/model`
  const dest = path.join(root, 'model.gguf')
  const hash = createHash('sha256').update('model-data').digest('hex')
  await downloadVerified(url, dest, hash)
  await downloadVerified(url, dest, hash)
  assert.equal(requests, 1)
  await assert.rejects(downloadVerified(url, dest, '0'.repeat(64)), /SHA-256 mismatch/)
  assert.equal(await fs.readFile(dest, 'utf8'), 'model-data')
  await assert.rejects(fs.access(`${dest}.partial`), /ENOENT/)
})
