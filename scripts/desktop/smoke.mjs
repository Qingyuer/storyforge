import { _electron as electron } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'
const profile = await mkdtemp(join(tmpdir(), 'storyforge-client-smoke-'))
const executablePath = process.argv[2]
const launch = () => electron.launch({
  ...(executablePath ? { executablePath: resolve(executablePath), args: [] } : { args: ['scripts/desktop/main.mjs'] }),
  env: { ...process.env, STORYFORGE_TEST_USER_DATA: profile }, timeout: 60000,
})
let app
try {
  app = await launch()
  let page = await app.firstWindow()
  await page.waitForSelector('#root main, #root button', { timeout: 60000 })
  assert.ok(!(await page.locator('#root').innerText()).includes('StoryForge 无法启动'))
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined')
  await page.evaluate(async () => {
    localStorage.setItem('client-upgrade-probe', 'preserve-me')
    const request = indexedDB.open('client-upgrade-probe', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('values')
    await new Promise((resolve, reject) => { request.onsuccess = resolve; request.onerror = reject })
    const transaction = request.result.transaction('values', 'readwrite')
    transaction.objectStore('values').put('manuscript-probe', 'sample')
    await new Promise((resolve, reject) => { transaction.oncomplete = resolve; transaction.onerror = reject })
    request.result.close()
  })
  await app.evaluate(({ app }) => app.exit(0))
  app = await launch()
  page = await app.firstWindow()
  await page.waitForSelector('#root main, #root button', { timeout: 60000 })
  assert.equal(await page.evaluate(() => localStorage.getItem('client-upgrade-probe')), 'preserve-me')
  const content = await page.evaluate(async () => {
    const request = indexedDB.open('client-upgrade-probe', 1)
    await new Promise((resolve, reject) => { request.onsuccess = resolve; request.onerror = reject })
    const read = request.result.transaction('values').objectStore('values').get('sample')
    return new Promise((resolve, reject) => { read.onsuccess = () => resolve(read.result); read.onerror = reject })
  })
  assert.equal(content, 'manuscript-probe')
  console.log('Native window, sandbox, boot and stable-profile restart passed. This is not a two-version installer upgrade test.')
} finally {
  if (app) await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
  await rm(profile, { recursive: true, force: true })
}
