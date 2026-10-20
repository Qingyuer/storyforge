import { afterAll, beforeEach, expect, it, vi } from 'vitest'
import * as budgetRecovery from '../../src/lib/open-world/creator-budget-recovery'
import { db } from '../../src/lib/db/schema'
import { seedCurrentProductWorld } from '../helpers/current-product-world'
import { seedAuthorizedTextOpenWorldCreatorBuildV1 } from '../helpers/text-open-world-creator-build'
import { createTextOpenWorldProductionExecutorV1 } from '../../src/lib/open-world/production-executor'
import { readTextOpenWorldArtifactGovernanceV1 } from '../../src/lib/open-world/creator-artifact-governance'
import { readTextOpenWorldCreatorDerivedBuildAuthorityV1 } from '../../src/lib/open-world/creator-derived-authority'
import { readTextOpenWorldBudgetFailureV1 } from '../../src/lib/open-world/creator-budget-recovery-evidence'
import { assertTextOpenWorldBudgetRecoveryPreparationCurrentV1 } from '../../src/lib/open-world/creator-budget-recovery'
import { recoverImportedProductProductionProofsV1, runProductProductionSchedulerCycleV1 } from '../../src/lib/product-production/scheduler'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { resolveScope } from '../../src/lib/workspace/scope'
import { previewTextOpenWorldCreatorBudgetRecoveryV1, authorizeTextOpenWorldCreatorBudgetRecoveryV1, setProductProductionPausedV1 } from '../../src/lib/product-production/service'
import { carryForwardProductBuildArtifactsAcrossBuildsV1, verifyTextOpenWorldBudgetRecoveryPrefixV1, verifyProductBuildTerminalArtifactSetV1, verifyImportedTextOpenWorldHistoricalTasksV1 } from '../../src/lib/product-production/artifact-store'
import { canonicalProductProductionJsonV2 as json } from '../../src/lib/product-production/hash'
import { parseProductProductionPlanV3 } from '../../src/lib/product-production/plan'
import { parseProductProductionCommandV1 } from '../../src/lib/product-production/contracts'

beforeEach(async () => { await db.delete(); await db.open() })
afterAll(async () => { await db.delete() })

async function blockedFixture(limit: 'build-cost' | 'source-calls' = 'build-cost') {
  const world = await seedCurrentProductWorld('creator-budget-recovery')
  const creator = await seedAuthorizedTextOpenWorldCreatorBuildV1({
    source: { kind: 'world-release', scope: world.scope, localReleaseRecordId: world.release.id!, expectedReleaseHash: world.release.contentHash },
    sessionKey: 'creator-budget-recovery',
  })
  const production = (await db.productProductions.get(creator.productionId))!
  const providerExecutor = vi.fn(async () => { throw new Error('test must stop before provider dispatch') })
  const executor = createTextOpenWorldProductionExecutorV1({ production, brief: creator.start.executionBrief,
    taskExecutors: { 'p1.source-curation': providerExecutor } })
  const capabilityBindings = [{ requirementKey: 'text-open-world.production.text.v1',
    adapterId: 'configured-text-provider.v1', bindingHash: 'b'.repeat(64) }]
  await runProductProductionSchedulerCycleV1({ scope: creator.scope, productionId: creator.productionId, executor, capabilityBindings })
  const first = (await db.productBuilds.get(creator.buildId))!
  const ledger = JSON.parse(first.budgetLedgerJson)
  expect(ledger.tasks['p0.source-lock'].status).toBe('settled')
  // Fixture-only paid history from an earlier epoch. The real scheduler must
  // preserve it and produce its own pre-dispatch failure; no model is called.
  const sourceReservation = parseProductProductionPlanV3(first.planJson).tasks
    .find(task => task.taskKey === 'p1.source-curation')!.budgetReservation
  const history = { taskKey: limit === 'source-calls' ? 'p1.source-curation' : 'p9.scene-scripts', runId: ledger.rootRunId,
    controlEpoch: 0, attempt: 1, idempotencyKey: 'f'.repeat(64), outcome: 'failed',
    errorCode: limit === 'source-calls' ? 'task-result-unknown' : 'task-budget-exceeded',
    usageKnown: limit !== 'source-calls',
    usage: limit === 'source-calls'
      ? { modelCalls: sourceReservation.modelCalls, inputTokens: sourceReservation.inputTokens,
          outputTokens: sourceReservation.outputTokens, mediaCalls: sourceReservation.mediaCalls,
          costUsd: sourceReservation.maximumCostUsd, durationMs: sourceReservation.durationMs,
          storageBytes: sourceReservation.storageBytes }
      : { modelCalls: 1, inputTokens: 1, outputTokens: 1, mediaCalls: 0,
          costUsd: creator.start.executionBrief.productionBudget.maximumCostUsd, durationMs: 1, storageBytes: 0 } }
  ledger.attempts.push(history)
  await db.productBuilds.update(creator.buildId, { budgetLedgerJson: json(ledger) })
  const blocked = await runProductProductionSchedulerCycleV1({ scope: creator.scope,
    productionId: creator.productionId, executor, capabilityBindings })
  expect(blocked.buildStatus).toBe('recovery-required')
  const build = (await db.productBuilds.get(creator.buildId))!
  expect(build.failureJson).toContain(limit === 'source-calls'
    ? 'Build lifetime budget 不足:task=p1.source-curation,remainingModelCalls=0'
    : 'Build lifetime budget 不足:costUsd=')
  return { ...creator, build, executor, providerExecutor, history, capabilityBindings,
    input: { scope: creator.scope, productionId: creator.productionId, buildId: creator.buildId } }
}

it('exhausted task calls stop before provider dispatch and preserve the unknown hold when authorizing a child', async () => {
  const f = await blockedFixture('source-calls')
  expect(f.providerExecutor).not.toHaveBeenCalled()
  const ledger = JSON.parse(f.build.budgetLedgerJson)
  expect(ledger.attempts).toContainEqual(f.history)
  const refusal = ledger.attempts.find((entry: { runId: number }) =>
    entry.runId === ledger.tasks['p1.source-curation'].runId)
  expect(refusal).toMatchObject({ usageKnown: true, errorCode: 'task-budget-exceeded',
    usage: { modelCalls: 0, inputTokens: 0, outputTokens: 0, mediaCalls: 0, costUsd: 0, durationMs: 0, storageBytes: 0 } })
  const events = await db.agentRunEvents.where('runId').equals(refusal.runId).toArray()
  expect(events.some(event => ['model.requested', 'model.responded'].includes(event.type))).toBe(false)
  const prepared = await previewTextOpenWorldCreatorBudgetRecoveryV1(f.input)
  expect(prepared.reuseTaskKeys).toEqual(['p0.source-lock'])
  expect((await authorizeTextOpenWorldCreatorBudgetRecoveryV1({ prepared })).ok).toBe(true)
  expect(await db.productBuilds.get(f.buildId)).toEqual(f.build)
  const child = (await db.productBuilds.where('[productionId+buildNumber]').equals([f.productionId, 2]).first())!
  expect(child).toMatchObject({ parentBuildNumber: 1, status: 'authorized', budgetLedgerJson: '{}' })
}, 30_000)

it('authorizes a child from verified completed siblings; keeps old ledger and reruns unsigned tasks', async () => {
  const f = await blockedFixture()
  const prepared = await previewTextOpenWorldCreatorBudgetRecoveryV1(f.input)
  expect(prepared.reuseTaskKeys).toEqual(['p0.source-lock'])
  expect(prepared.targetPlan.tasks.filter(task => task.reuse).flatMap(task => task.outputArtifactKeys))
    .toEqual(prepared.prefix.artifacts.map(row => row.artifactKey).sort())
  const originalBrief = await db.productProductionBriefs.where('productionId').equals(f.productionId).toArray()
  const receipt = await authorizeTextOpenWorldCreatorBudgetRecoveryV1({ prepared })
  expect(receipt.ok).toBe(true)
  expect(await db.productBuilds.get(f.buildId)).toEqual(f.build)
  expect(await db.productProductionBriefs.where('productionId').equals(f.productionId).toArray()).toEqual(originalBrief)
  const child = (await db.productBuilds.where('[productionId+buildNumber]').equals([f.productionId, 2]).first())!
  expect(child).toMatchObject({ parentBuildNumber: 1, briefHash: f.build.briefHash, budgetLedgerJson: '{}', status: 'authorized' })
  expect((await readTextOpenWorldCreatorDerivedBuildAuthorityV1({ scope: f.scope, buildId: child.id! })).origin).toBe('creator-budget-recovery-v1')
  const carried = await carryForwardProductBuildArtifactsAcrossBuildsV1({ scope: f.scope,
    sourceBuildId: f.buildId, targetBuildId: child.id!, targetControlEpoch: child.controlEpoch,
    artifactKeys: prepared.prefix.artifacts.map(row => row.artifactKey) })
  expect(carried).toHaveLength(prepared.prefix.artifacts.length)
  expect(carried.every(row => row.carriedFrom?.buildNumber === 1 && row.carriedFrom.proofHash)).toBe(true)
  const cycle = await runProductProductionSchedulerCycleV1({ scope: f.scope, productionId: f.productionId,
    executor: f.executor, capabilityBindings: f.capabilityBindings })
  expect(cycle.tasks.find(task => task.taskKey === 'p0.source-lock')?.status).toBe('completed')
  expect(await db.productBuilds.get(f.buildId)).toEqual(f.build)
  await expect(verifyProductBuildTerminalArtifactSetV1({ ...f.input,
    expectedControlEpoch: f.build.controlEpoch, expectedPlanHash: f.build.planHash })).rejects.toThrow(/authority/)
  const exported = await exportProjectJSON(f.scope.projectId)
  const projectId = await importProjectJSON(exported)
  const importedScope = await resolveScope({ projectId })
  const importedProduction = (await db.productProductions.where('projectId').equals(projectId).first())!
  const importedChild = (await db.productBuilds.where('[productionId+buildNumber]').equals([importedProduction.id!, 2]).first())!
  const importedParent = (await db.productBuilds.where('[productionId+buildNumber]').equals([importedProduction.id!, 1]).first())!
  await recoverImportedProductProductionProofsV1({ scope: importedScope, productionId: importedProduction.id! })
  expect(await db.productBuilds.get(importedParent.id!)).toEqual(importedParent)
  await expect(carryForwardProductBuildArtifactsAcrossBuildsV1({ scope: importedScope,
    sourceBuildId: importedParent.id!, targetBuildId: importedChild.id!, targetControlEpoch: importedChild.controlEpoch,
    artifactKeys: prepared.prefix.artifacts.map(row => row.artifactKey) })).resolves.toHaveLength(carried.length)
}, 30_000)

it('rejects stale preview, modified parent bytes, missing siblings and forged budget failure provenance', async () => {
  const f = await blockedFixture()
  const prepared = await previewTextOpenWorldCreatorBudgetRecoveryV1(f.input)
  const plan = parseProductProductionPlanV3(f.build.planJson)
  const failure = JSON.parse(f.build.failureJson)
  for (const changed of [
    { ...failure, code: 'task-result-unknown' },
    { ...failure, detail: 'provider refused' },
    { ...failure, failureProvenance: { ...failure.failureProvenance, controlEpoch: f.build.controlEpoch + 1 } },
    { ...failure, failureProvenance: { ...failure.failureProvenance, runId: failure.failureProvenance.rootRunId } },
  ]) {
    await expect(readTextOpenWorldBudgetFailureV1({ scope: f.scope, build: { ...f.build, id: f.buildId, failureJson: json(changed) }, plan })).rejects.toThrow()
  }
  const row = prepared.prefix.artifacts[0]
  await db.productBuildArtifacts.update(row.id!, { payloadJson: '{}' })
  await expect(assertTextOpenWorldBudgetRecoveryPreparationCurrentV1(prepared)).rejects.toThrow(/Artifact/)
  await expect(previewTextOpenWorldCreatorBudgetRecoveryV1(f.input)).rejects.toThrow()
  await db.productBuildArtifacts.put(row)
  await db.productBuildArtifacts.delete(row.id!)
  await expect(verifyTextOpenWorldBudgetRecoveryPrefixV1({ ...f.input,
    expectedControlEpoch: f.build.controlEpoch, expectedPlanHash: f.build.planHash })).rejects.toThrow(/outputs/)
  await db.productBuildArtifacts.put(row)
  await db.productProductions.update(f.productionId, { stateRevision: prepared.source.production.stateRevision + 1 })
  await expect(authorizeTextOpenWorldCreatorBudgetRecoveryV1({ prepared })).rejects.toThrow(/过期/)
  expect(await db.productBuilds.where('productionId').equals(f.productionId).count()).toBe(1)
}, 30_000)

it('requires exact prefix and plan hashes on the public command', () => {
  const command = { type: 'authorize-text-open-world-creator-budget-recovery', commandId: 'budget.command',
    expectedStateRevision: 3, baseBuildNumber: 1, expectedBasePlanHash: 'a'.repeat(64),
    expectedPrefixHash: 'b'.repeat(64), expectedTargetPlanHash: 'c'.repeat(64),
    authorizationNonce: 'budget.nonce', authorizedAt: 123 }
  expect(parseProductProductionCommandV1(command)).toEqual(command)
  expect(() => parseProductProductionCommandV1({ ...command, expectedPrefixHash: '' })).toThrow()
  expect(() => parseProductProductionCommandV1({ ...command, maximumCostUsd: 1000 })).toThrow()
})

it('records a stale transaction result without creating a child when proof changes at the atomic boundary', async () => {
  const f = await blockedFixture()
  const prepared = await previewTextOpenWorldCreatorBudgetRecoveryV1(f.input)
  const original = budgetRecovery.assertTextOpenWorldBudgetRecoveryPreparationCurrentV1
  const deferred = vi.spyOn(budgetRecovery, 'assertTextOpenWorldBudgetRecoveryPreparationCurrentV1')
    .mockImplementationOnce(async value => {
      await db.productBuildArtifacts.update(value.prefix.artifacts[0].id!, { payloadJson: '{}' })
      await original(value)
    })
  try {
    const receipt = await authorizeTextOpenWorldCreatorBudgetRecoveryV1({ prepared })
    expect(receipt.ok).toBe(false)
    expect(receipt.errorCode).toBe('repair-impact-stale')
    expect(deferred).toHaveBeenCalledOnce()
    expect(await db.productBuilds.get(f.buildId)).toEqual(f.build)
    expect(await db.productBuilds.where('productionId').equals(f.productionId).count()).toBe(1)
    const command = await db.productProductionCommands.where('[productionId+commandId]')
      .equals([f.productionId, receipt.commandId]).first()
    expect(command?.status).toBe('failed')
    expect((await db.productProductions.get(f.productionId))?.currentBuildNumber).toBe(1)
  } finally {
    deferred.mockRestore()
  }
}, 30_000)

it('keeps the authorized DAG and completed siblings through an explicit child pause and resume', async () => {
  const f = await blockedFixture()
  const prepared = await previewTextOpenWorldCreatorBudgetRecoveryV1(f.input)
  expect((await authorizeTextOpenWorldCreatorBudgetRecoveryV1({ prepared })).ok).toBe(true)
  const cycle = () => runProductProductionSchedulerCycleV1({ scope: f.scope, productionId: f.productionId,
    executor: f.executor, capabilityBindings: f.capabilityBindings })
  await cycle()
  const child = (await db.productBuilds.where('[productionId+buildNumber]').equals([f.productionId, 2]).first())!
  for (const expected of ['paused', 'resumed']) {
    expect(await setProductProductionPausedV1({ scope: f.scope,
      production: (await db.productProductions.get(f.productionId))!, build: (await db.productBuilds.get(child.id!))!,
      // This fixture executor throws without contacting any provider; explicitly
      // settle its conservative unknown hold through the normal author command.
      ...(expected === 'resumed' ? { pausedReservationDisposition: 'confirmed-not-charged' as const } : {}),
    })).toBe(expected)
  }
  expect((await cycle()).tasks.find(task => task.taskKey === 'p0.source-lock')?.status).toBe('completed')
  const rebound = (await db.productBuilds.get(child.id!))!
  expect(rebound.controlEpoch).toBeGreaterThan(child.controlEpoch)
  expect(parseProductProductionPlanV3(rebound.planJson).controlEpoch).toBe(rebound.controlEpoch)
  expect((await readTextOpenWorldCreatorDerivedBuildAuthorityV1({ scope: f.scope, buildId: child.id! })).origin)
    .toBe('creator-budget-recovery-v1')
  expect(await db.productBuilds.get(f.buildId)).toEqual(f.build)
  const governance = await readTextOpenWorldArtifactGovernanceV1({ scope: f.scope, productionId: f.productionId })
  const active = governance.artifacts.filter(row => row.currentEpoch && row.ownerTaskKey === 'p0.source-lock')
  expect(active.length).toBeGreaterThan(0)
  expect(active.map(row => ({ artifactKey: row.artifactKey, health: row.health, productionValidation: row.productionValidation, diagnostics: row.diagnostics })))
    .toEqual(active.map(row => ({ artifactKey: row.artifactKey, health: 'verified', productionValidation: 'production-validated', diagnostics: [] })))
}, 30_000)

it('restores an imported signed prefix while a newer recovery epoch is waiting for its atomic Plan rebind', async () => {
  const f = await blockedFixture()
  const prepared = await previewTextOpenWorldCreatorBudgetRecoveryV1(f.input)
  expect((await authorizeTextOpenWorldCreatorBudgetRecoveryV1({ prepared })).ok).toBe(true)
  await runProductProductionSchedulerCycleV1({ scope: f.scope, productionId: f.productionId,
    executor: f.executor, capabilityBindings: f.capabilityBindings })
  const child = (await db.productBuilds.where('[productionId+buildNumber]').equals([f.productionId, 2]).first())!
  for (const expected of ['paused', 'resumed']) {
    expect(await setProductProductionPausedV1({ scope: f.scope,
      production: (await db.productProductions.get(f.productionId))!,
      build: (await db.productBuilds.get(child.id!))!,
      ...(expected === 'resumed' ? { pausedReservationDisposition: 'confirmed-not-charged' as const } : {}),
    })).toBe(expected)
  }
  const projectId = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  const scope = await resolveScope({ projectId })
  const production = (await db.productProductions.where('projectId').equals(projectId).first())!
  const imported = (await db.productBuilds.where('[productionId+buildNumber]').equals([production.id!, 2]).first())!
  expect(parseProductProductionPlanV3(imported.planJson).controlEpoch).toBeLessThan(imported.controlEpoch)
  await recoverImportedProductProductionProofsV1({ scope, productionId: production.id! })
  expect(await db.productBuilds.get(imported.id!)).toEqual(imported)
  const cycle = await runProductProductionSchedulerCycleV1({ scope, productionId: production.id!,
    executor: f.executor, capabilityBindings: f.capabilityBindings })
  expect(cycle.tasks.find(task => task.taskKey === 'p0.source-lock')?.status).toBe('completed')
  const recovered = (await db.productBuilds.get(imported.id!))!
  expect(parseProductProductionPlanV3(recovered.planJson).controlEpoch).toBe(imported.controlEpoch)
  for (const attempt of JSON.parse(imported.budgetLedgerJson).attempts) {
    expect(JSON.parse(recovered.budgetLedgerJson).attempts).toContainEqual(attempt)
  }
}, 30_000)

it('revalidates a recovered child through its original budget parent and rejects parent tampering', async () => {
  const f = await blockedFixture()
  const prepared = await previewTextOpenWorldCreatorBudgetRecoveryV1(f.input)
  expect((await authorizeTextOpenWorldCreatorBudgetRecoveryV1({ prepared })).ok).toBe(true)
  const cycle = () => runProductProductionSchedulerCycleV1({ scope: f.scope,
    productionId: f.productionId, executor: f.executor, capabilityBindings: f.capabilityBindings })
  await cycle()
  const child = (await db.productBuilds.where('[productionId+buildNumber]').equals([f.productionId, 2]).first())!
  for (const expected of ['paused', 'resumed']) {
    expect(await setProductProductionPausedV1({ scope: f.scope,
      production: (await db.productProductions.get(f.productionId))!,
      build: (await db.productBuilds.get(child.id!))!,
      ...(expected === 'resumed' ? { pausedReservationDisposition: 'confirmed-not-charged' as const } : {}),
    })).toBe(expected)
  }
  // Isolated fixture history drives a second real pre-dispatch budget refusal.
  // The common prefix/terminal verifier must traverse child epoch -> child
  // initial epoch -> authorized parent; no model or browser data is used.
  const current = (await db.productBuilds.get(child.id!))!
  const ledger = JSON.parse(current.budgetLedgerJson)
  ledger.attempts.push({ taskKey: 'p9.scene-scripts', runId: ledger.rootRunId,
    controlEpoch: 0, attempt: 1, idempotencyKey: 'e'.repeat(64), outcome: 'failed',
    errorCode: 'task-budget-exceeded', usageKnown: true,
    usage: { modelCalls: 1, inputTokens: 1, outputTokens: 1, mediaCalls: 0,
      costUsd: f.start.executionBrief.productionBudget.maximumCostUsd, durationMs: 1, storageBytes: 0 } })
  await db.productBuilds.update(child.id!, { budgetLedgerJson: json(ledger) })
  expect((await cycle()).buildStatus).toBe('recovery-required')
  const blocked = (await db.productBuilds.get(child.id!))!
  expect(blocked.failureJson).toContain('Build lifetime budget')
  const verify = () => verifyTextOpenWorldBudgetRecoveryPrefixV1({ scope: f.scope,
    productionId: f.productionId, buildId: child.id!,
    expectedControlEpoch: blocked.controlEpoch, expectedPlanHash: blocked.planHash })
  const proof = await verify()
  expect(proof.artifacts.length).toBeGreaterThan(0)
  expect(proof.casReadSet.recoveryParents?.length).toBeGreaterThan(0)
  const historicalSibling = (await db.productBuildArtifacts.where('buildId').equals(child.id!).toArray())
    .find(row => row.status === 'invalid' && row.carriedFrom?.buildNumber === 1)!
  await db.productBuildArtifacts.update(historicalSibling.id!, { payloadJson: '{}' })
  await expect(verify()).rejects.toThrow()
  await db.productBuildArtifacts.put(historicalSibling)
  await expect(verify()).resolves.toMatchObject({ artifacts: expect.any(Array) })
  const importedProjectId = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  const importedScope = await resolveScope({ projectId: importedProjectId })
  const importedProduction = (await db.productProductions.where('projectId').equals(importedProjectId).first())!
  const importedChild = (await db.productBuilds.where('[productionId+buildNumber]').equals([importedProduction.id!, 2]).first())!
  const importedParent = (await db.productBuilds.where('[productionId+buildNumber]').equals([importedProduction.id!, 1]).first())!
  // Isolated import fixture: restore the parent first, then exercise an import
  // iterator while its caller has not yet signed the historical child.
  await db.productProductions.update(importedProduction.id!, { currentBuildNumber: importedParent.buildNumber })
  await recoverImportedProductProductionProofsV1({ scope: importedScope, productionId: importedProduction.id! })
  await db.productProductions.put(importedProduction)
  const importedHistory = (await db.productBuildArtifacts.where('buildId').equals(importedChild.id!).toArray())
    .find(row => row.carriedFrom?.buildNumber === 1)!
  const iterator = verifyImportedTextOpenWorldHistoricalTasksV1({ scope: importedScope,
    buildId: importedChild.id!, runIds: [importedHistory.producerRunId!, importedHistory.producerRunId!] })
  expect((await iterator.next()).value).toMatchObject({ carried: true })
  const importedSource = (await db.productBuildArtifacts.where('buildId').equals(importedParent.id!).first())!
  await db.productBuildArtifacts.update(importedSource.id!, { payloadJson: '{}' })
  await expect(iterator.next()).rejects.toThrow(/CAS Artifact/)
  await db.productBuildArtifacts.put(importedSource)
  const commandIterator = verifyImportedTextOpenWorldHistoricalTasksV1({ scope: importedScope,
    buildId: importedChild.id!, runIds: [importedHistory.producerRunId!, importedHistory.producerRunId!] })
  expect((await commandIterator.next()).value).toMatchObject({ carried: true })
  const importedAuthorization = (await db.productProductionCommands.where('productionId')
    .equals(importedProduction.id!).filter(row => row.type === 'authorize-text-open-world-creator-budget-recovery').first())!
  await db.productProductionCommands.update(importedAuthorization.id!, { completedAt: importedAuthorization.completedAt! + 1 })
  await expect(commandIterator.next()).rejects.toThrow(/authority commands/)
  await db.productProductionCommands.put(importedAuthorization)
  await recoverImportedProductProductionProofsV1({ scope: importedScope, productionId: importedProduction.id! })
  await expect(verifyTextOpenWorldBudgetRecoveryPrefixV1({ scope: importedScope,
    productionId: importedProduction.id!, buildId: importedChild.id!,
    expectedControlEpoch: importedChild.controlEpoch, expectedPlanHash: importedChild.planHash }))
    .resolves.toMatchObject({ artifacts: expect.any(Array) })
  const source = prepared.prefix.artifacts[0]
  await db.productBuildArtifacts.update(source.id!, { payloadJson: '{}' })
  await expect(verify()).rejects.toThrow()
  await db.productBuildArtifacts.put(source)
  const originalParent = (await db.productBuilds.get(f.buildId))!
  const parentLedger = JSON.parse(originalParent.budgetLedgerJson)
  parentLedger.attempts.find((row: { taskKey: string }) => row.taskKey === 'p9.scene-scripts').usage.costUsd = 0
  await db.productBuilds.update(f.buildId, { budgetLedgerJson: json(parentLedger) })
  await expect(verify()).rejects.toThrow()
}, 30_000)

it('refuses changed historical usage or Run evidence after authorizing the child, without copying output', async () => {
  const f = await blockedFixture()
  const prepared = await previewTextOpenWorldCreatorBudgetRecoveryV1(f.input)
  expect((await authorizeTextOpenWorldCreatorBudgetRecoveryV1({ prepared })).ok).toBe(true)
  const child = (await db.productBuilds.where('[productionId+buildNumber]').equals([f.productionId, 2]).first())!
  const carry = () => carryForwardProductBuildArtifactsAcrossBuildsV1({ scope: f.scope,
    sourceBuildId: f.buildId, targetBuildId: child.id!, targetControlEpoch: child.controlEpoch,
    artifactKeys: prepared.prefix.artifacts.map(row => row.artifactKey) })
  const ledger = JSON.parse(f.build.budgetLedgerJson)
  ledger.attempts.find((row: { taskKey: string }) => row.taskKey === 'p9.scene-scripts').usage.costUsd = 0
  await db.productBuilds.update(f.buildId, { budgetLedgerJson: json(ledger) })
  await expect(carry()).rejects.toThrow(/父前缀/)
  expect(await db.productBuildArtifacts.where('buildId').equals(child.id!).count()).toBe(0)
  await db.productBuilds.put(f.build)
  const event = (await db.agentRunEvents.where('runId').equals(ledger.rootRunId).first())!
  await db.agentRunEvents.update(event.id!, { payloadJson: '{}' })
  await expect(carry()).rejects.toThrow()
  expect(await db.productBuildArtifacts.where('buildId').equals(child.id!).count()).toBe(0)
}, 30_000)
