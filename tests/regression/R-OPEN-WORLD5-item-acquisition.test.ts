import { describe, expect, it } from 'vitest'
import { compileTextOpenWorldItemAcquisitionsV1, parseTextOpenWorldItemAcquisitionsV1 } from '../../src/lib/open-world/item-acquisition-production'
import type { TextOpenWorldQuestFinalizeInputContextV1 } from '../../src/lib/open-world/quest-finalize-production'
import type { TextOpenWorldQuestFulfillmentSelectionsV1 } from '../../src/lib/types'
import { createTextOpenWorldConditionCatalogV1 } from '../../src/lib/open-world/condition-dsl'
import { createTextOpenWorldEffectCatalogV1 } from '../../src/lib/open-world/effect-dsl'
import { createInitialTextOpenWorldSessionProjectionV1, deriveTextOpenWorldContextsV1 } from '../../src/lib/open-world/session-projection'
import { createTextOpenWorldVNextFixture } from '../helpers/text-open-world-vnext-fixture'

function setup(explicitSources = false) {
  const pkg = createTextOpenWorldVNextFixture()
  const actions = pkg.modules.actions.payload as any
  const items = pkg.modules.items.payload as any
  const seal = items.items.find((item: any) => item.key === 'item.canal-seal')
  const salt = items.items.find((item: any) => item.key === 'item.salt-crystal')
  const interactionKey = 'interaction.fixture.pickup'
  const action = structuredClone(actions.actions.find((item: any) => item.key === 'action.investigate-channel'))
  Object.assign(action, {
    key: `action.interaction.${interactionKey}`, requirementConditionKeys: [], costEffectKeys: [],
    successEffectKeys: ['effect.fixture.pickup-proof'], failureEffectKeys: [], timeCostMinutes: 0,
  })
  actions.actions.push(action)
  actions.effects.push({ key: 'effect.fixture.pickup-proof', operation: 'set-world-flag',
    payload: { flagKey: `flag.fulfillment.interaction.${interactionKey}`, value: true } })
  const context = {
    questSkeletons: {
      quests: [{ key: 'quest.main.1', type: 'mainline' }],
      objectives: [{ key: 'objective.main.1', questKey: 'quest.main.1', stageKey: 'quest-stage.main.1',
        order: 1, optional: false, playerIntent: 'collect', requirementKeys: ['requirement.pickup'] }],
    },
    itemRewardCatalog: { items: [seal, salt].map(item => ({ ...item, fulfilledRequirementKeys: ['requirement.pickup'] })) },
    craftingEconomyCatalog: { recipes: [] },
    mapInteractionCatalog: { interactions: [{ key: interactionKey, locationKey: 'location.salt-port',
      questConsumerKeys: ['quest.main.1'], fulfilledRequirementKeys: ['requirement.pickup'] }] },
  } as unknown as TextOpenWorldQuestFinalizeInputContextV1
  const fulfillment: TextOpenWorldQuestFulfillmentSelectionsV1 = {
    version: 1, objectives: [{ objectiveNumber: 1, anyActionGroups: [[1]],
      items: [{ itemNumber: 1, quantity: 1, consume: false }, { itemNumber: 2, quantity: 1, consume: false }] }],
    interactions: [{ interactionNumber: 1, consumedItems: [] }], endings: [],
  }
  if (explicitSources) {
    context.itemRewardCatalog.itemSourceContract = 'explicit-producers-v1'
    context.itemRewardCatalog.itemSourcePlans = [
      { itemKey: seal.key, sources: [{ kind: 'acquisition', sourceKey: 'objective.main.1' }] },
      { itemKey: salt.key, sources: [{ kind: 'initial', sourceKey: salt.key }] },
    ]
  }
  const selections = [{ objectiveNumber: 1, interactionNumber: 1, items: [{ itemNumber: 1, quantity: 1 }] }]
  return { pkg, actions, action, context, fulfillment, selections, interactionKey }
}

describe('fixed objective item acquisition', () => {
  it.each([false, true])('requires the active stage and permit, grants evidence atomically without farming (explicit sources: %s)', async explicitSources => {
    const { pkg, actions, action, context, fulfillment, selections, interactionKey } = setup(explicitSources)
    const accepted = parseTextOpenWorldItemAcquisitionsV1(selections, context, fulfillment)
    compileTextOpenWorldItemAcquisitionsV1({ context, selections: accepted, fulfillment,
      conditions: actions.conditions, effects: actions.effects, actions: actions.actions,
      interactions: [{ interactionKey, actionKey: action.key, conditionKeys: [], effectKeys: [], questKeys: ['quest.main.1'] }],
    })
    const projection = createInitialTextOpenWorldSessionProjectionV1(pkg)
    const conditions = createTextOpenWorldConditionCatalogV1(pkg)
    const effects = createTextOpenWorldEffectCatalogV1(pkg)
    const conditionKey = action.requirementConditionKeys[0]
    const state = deriveTextOpenWorldContextsV1(projection).condition
    const available = () => conditions.evaluate(conditionKey, state).satisfied
    expect(available()).toBe(false)
    state.quests.statusByQuestKey['quest.main.1'] = 'active'
    state.quests.stageByQuestKey['quest.main.1'] = 'quest-stage.main.1'
    expect(available()).toBe(false)
    state.inventory.itemQuantities['item.salt-crystal'] = 1
    expect(available()).toBe(true)
    const plan = await effects.plan({ effectKeys: action.successEffectKeys, state: projection.state, claimKey: 'claim.pickup' })
    const result = await effects.apply({ plan, state: projection.state })
    expect(Object.values(result.state.inventory.itemInstances).filter(item => item.itemKey === 'item.canal-seal')).toHaveLength(1)
    expect(result.state.world.flags[`flag.fulfillment.interaction.${interactionKey}`]).toBe(true)
    state.world.flags[`flag.fulfillment.interaction.${interactionKey}`] = true
    expect(available()).toBe(false)
    await expect(effects.apply({ plan, state: result.state })).rejects.toThrow('基线状态已变化')
    const existing = Object.values(result.state.inventory.itemInstances).find(item => item.itemKey === 'item.canal-seal')!
    const repeat = await effects.plan({ effectKeys: action.successEffectKeys.slice(1), state: result.state, claimKey: 'claim.existing-evidence' })
    const kept = await effects.apply({ plan: repeat, state: result.state })
    expect(Object.values(kept.state.inventory.itemInstances).filter(item => item.itemKey === 'item.canal-seal')).toEqual([existing])
  })

  it('rejects an unplanned pickup even when the item and objective references are otherwise valid', () => {
    const { context, fulfillment, selections } = setup(true)
    expect(parseTextOpenWorldItemAcquisitionsV1(selections, context, fulfillment)).toEqual(selections)
    context.itemRewardCatalog.itemSourcePlans![0]!.sources = [{ kind: 'reward', sourceKey: 'reward.prior' }]
    expect(() => parseTextOpenWorldItemAcquisitionsV1(selections, context, fulfillment)).toThrow(/未计划|未选择|来源/)
    context.itemRewardCatalog.itemSourcePlans![0]!.sources = [{ kind: 'acquisition', sourceKey: 'objective.other' }]
    expect(() => parseTextOpenWorldItemAcquisitionsV1(selections, context, fulfillment)).toThrow(/未计划|未选择|来源/)
  })

  it('does not leak pickups before prior required objectives, and preserves all state when a grant fails', async () => {
    const { pkg, actions, action, context, fulfillment, selections, interactionKey } = setup()
    const quests = pkg.modules.quests.payload as any
    const pickupObjective = 'objective.fixture.pickup'
    const completion = structuredClone(actions.actions.find((item: any) => item.key === 'action.complete-main-objective'))
    completion.key = 'action.complete-fixture-pickup'
    completion.successEffectKeys = ['effect.complete-fixture-pickup']
    actions.actions.push(completion)
    actions.effects.push({ key: 'effect.complete-fixture-pickup', operation: 'complete-objective', payload: { objectiveKey: pickupObjective } })
    quests.objectives.push({ ...quests.objectives[0], key: pickupObjective, actionKeys: [action.key, completion.key] })
    quests.stages[0].objectiveKeys.push(pickupObjective)
    context.questSkeletons.objectives[0]!.key = pickupObjective
    context.questSkeletons.objectives[0]!.order = 2
    context.questSkeletons.objectives.push({ ...context.questSkeletons.objectives[0]!, key: 'objective.main.1', order: 1, requirementKeys: [] })
    compileTextOpenWorldItemAcquisitionsV1({ context, selections, fulfillment,
      conditions: actions.conditions, effects: actions.effects, actions: actions.actions,
      interactions: [{ interactionKey, actionKey: action.key, conditionKeys: [], effectKeys: [], questKeys: ['quest.main.1'] }],
    })
    const projection = createInitialTextOpenWorldSessionProjectionV1(pkg)
    const conditions = createTextOpenWorldConditionCatalogV1(pkg)
    const state = deriveTextOpenWorldContextsV1(projection).condition
    state.quests.statusByQuestKey['quest.main.1'] = 'active'
    state.quests.stageByQuestKey['quest.main.1'] = 'quest-stage.main.1'
    state.inventory.itemQuantities['item.salt-crystal'] = 1
    expect(conditions.evaluate(action.requirementConditionKeys[0], state).satisfied).toBe(false)
    state.quests.objectiveStatusByKey['objective.main.1'] = 'completed'
    expect(conditions.evaluate(action.requirementConditionKeys[0], state).satisfied).toBe(true)
    // The preceding proof must not survive a failed later inventory operation.
    const effects = createTextOpenWorldEffectCatalogV1(pkg)
    const before = structuredClone(projection.state)
    await expect(effects.plan({ effectKeys: [...action.successEffectKeys, 'effect.drop-salt-crystal'],
      state: projection.state, claimKey: 'claim.failed-pickup' })).rejects.toThrow(/物品|不足|数量/)
    expect(projection.state).toEqual(before)
  })

  it('rejects shared/template/foreign pickups, materials, repeated selections and consumptive repairs', () => {
    const { context, fulfillment, selections } = setup()
    expect(parseTextOpenWorldItemAcquisitionsV1(selections, context, fulfillment)).toEqual(selections)
    const reject = (mutate: (copy: typeof context, choices: typeof selections, bindings: typeof fulfillment) => void) => {
      const copy = structuredClone(context), choices = structuredClone(selections), bindings = structuredClone(fulfillment)
      mutate(copy, choices, bindings)
      expect(() => parseTextOpenWorldItemAcquisitionsV1(choices, copy, bindings)).toThrow(/领取/)
    }
    reject(copy => { copy.questSkeletons.quests[0]!.type = 'template' })
    reject(copy => { copy.mapInteractionCatalog.interactions[0]!.questConsumerKeys.push('quest.other') })
    reject(copy => { copy.itemRewardCatalog.items[0]!.fulfilledRequirementKeys = ['requirement.other'] })
    reject((_copy, choices) => { choices[0]!.items[0]!.itemNumber = 2 })
    reject((_copy, choices) => { choices.push(structuredClone(choices[0]!)) })
    reject((_copy, _choices, bindings) => { bindings.interactions[0]!.consumedItems = [{ itemNumber: 2, quantity: 1 }] })
  })
})
