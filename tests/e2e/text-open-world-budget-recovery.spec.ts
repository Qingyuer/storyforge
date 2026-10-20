import { expect, test } from '@playwright/test'

test('预算续建在原生 IndexedDB 中原子提交并保留父 Build 账本', async ({ page }) => {
  test.setTimeout(120_000)
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'text-open-world-budget-recovery-e2e')
  })
  await page.goto('./')
  await expect(page.getByRole('heading', { name: '首页', exact: true })).toBeVisible({ timeout: 20_000 })
  const result = await page.evaluate(async () => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const [
      { db }, { seedCurrentProductWorld }, { seedAuthorizedTextOpenWorldCreatorBuildV1 },
      { createTextOpenWorldProductionExecutorV1 }, { runProductProductionSchedulerCycleV1 },
      { previewTextOpenWorldCreatorBudgetRecoveryV1, authorizeTextOpenWorldCreatorBudgetRecoveryV1 },
      { carryForwardProductBuildArtifactsAcrossBuildsV1 }, { canonicalProductProductionJsonV2: json },
    ] = await Promise.all([
      importer('/storyforge/src/lib/db/schema.ts'),
      importer('/storyforge/tests/helpers/current-product-world.ts'),
      importer('/storyforge/tests/helpers/text-open-world-creator-build.ts'),
      importer('/storyforge/src/lib/open-world/production-executor.ts'),
      importer('/storyforge/src/lib/product-production/scheduler.ts'),
      importer('/storyforge/src/lib/product-production/service.ts'),
      importer('/storyforge/src/lib/product-production/artifact-store.ts'),
      importer('/storyforge/src/lib/product-production/hash.ts'),
    ])
    const world = await seedCurrentProductWorld('预算续建原生事务回归')
    const creator = await seedAuthorizedTextOpenWorldCreatorBuildV1({
      source: { kind: 'world-release', scope: world.scope,
        localReleaseRecordId: world.release.id, expectedReleaseHash: world.release.contentHash },
      sessionKey: 'budget-recovery-native-idb',
    })
    const production = await db.productProductions.get(creator.productionId)
    const executor = createTextOpenWorldProductionExecutorV1({ production, brief: creator.start.executionBrief,
      taskExecutors: { 'p1.source-curation': async () => { throw new Error('test must not contact a provider') } } })
    const cycleInput = { scope: creator.scope, productionId: creator.productionId, executor,
      capabilityBindings: [{ requirementKey: 'text-open-world.production.text.v1',
        adapterId: 'configured-text-provider.v1', bindingHash: 'b'.repeat(64) }] }
    await runProductProductionSchedulerCycleV1(cycleInput)
    const first = await db.productBuilds.get(creator.buildId)
    const ledger = JSON.parse(first.budgetLedgerJson)
    // Isolated test-only historical usage. The real scheduler must produce
    // its own pre-dispatch refusal; this is not real model/acceptance evidence.
    ledger.attempts.push({ taskKey: 'p9.scene-scripts', runId: ledger.rootRunId,
      controlEpoch: 0, attempt: 1, idempotencyKey: 'f'.repeat(64), outcome: 'failed',
      errorCode: 'task-budget-exceeded', usageKnown: true,
      usage: { modelCalls: 1, inputTokens: 1, outputTokens: 1, mediaCalls: 0,
        costUsd: creator.start.executionBrief.productionBudget.maximumCostUsd,
        durationMs: 1, storageBytes: 0 } })
    await db.productBuilds.update(creator.buildId, { budgetLedgerJson: json(ledger) })
    const blocked = await runProductProductionSchedulerCycleV1(cycleInput)
    if (blocked.buildStatus !== 'recovery-required') throw new Error('fixture did not reach the real budget boundary')
    const originalParent = await db.productBuilds.get(creator.buildId)
    const input = { scope: creator.scope, productionId: creator.productionId, buildId: creator.buildId }
    const prepared = await previewTextOpenWorldCreatorBudgetRecoveryV1(input)
    const receipt = await authorizeTextOpenWorldCreatorBudgetRecoveryV1({ prepared })
    const child = await db.productBuilds.where('[productionId+buildNumber]').equals([creator.productionId, 2]).first()
    if (!receipt.ok || !child) throw new Error('native authorization did not commit its child')
    const copied = await carryForwardProductBuildArtifactsAcrossBuildsV1({ scope: creator.scope,
      sourceBuildId: creator.buildId, targetBuildId: child.id, targetControlEpoch: child.controlEpoch,
      artifactKeys: prepared.prefix.artifacts.map((row: any) => row.artifactKey) })
    let staleRejected = false
    try { await authorizeTextOpenWorldCreatorBudgetRecoveryV1({ prepared }) }
    catch { staleRejected = true }
    const commands = await db.productProductionCommands.where('productionId').equals(creator.productionId).toArray()
    return {
      ok: receipt.ok, staleRejected,
      parentUnchanged: json(await db.productBuilds.get(creator.buildId)) === json(originalParent),
      buildCount: await db.productBuilds.where('productionId').equals(creator.productionId).count(),
      currentBuild: (await db.productProductions.get(creator.productionId)).currentBuildNumber,
      successfulAuthorizations: commands.filter((row: any) => row.type === 'authorize-text-open-world-creator-budget-recovery'
        && row.status === 'succeeded').length,
      claimedAuthorizations: commands.filter((row: any) => row.type === 'authorize-text-open-world-creator-budget-recovery'
        && row.status === 'claimed').length,
      carried: copied.length, expectedCarried: prepared.prefix.artifacts.length,
    }
  })
  expect(result).toEqual({ ok: true, staleRejected: true, parentUnchanged: true,
    buildCount: 2, currentBuild: 2, successfulAuthorizations: 1, claimedAuthorizations: 0,
    carried: result.expectedCarried, expectedCarried: result.expectedCarried })
  expect(result.carried).toBeGreaterThan(0)
})
