import type {
  TextOpenWorldConditionExpressionV1,
  TextOpenWorldItemAcquisitionSelectionV1,
  TextOpenWorldQuestDesignDocumentsV1,
  TextOpenWorldQuestFulfillmentSelectionsV1,
} from '../types'
import type { TextOpenWorldQuestFinalizeInputContextV1 } from './quest-finalize-production'
import { buildTextOpenWorldObjectiveFulfillmentDemandsV1 } from './objective-fulfillment-production'
import { hasTextOpenWorldExplicitItemSourcesV1, itemHasPlannedSourceV1 } from './item-source-production'

type Context = TextOpenWorldQuestFinalizeInputContextV1
function fail(message: string): never { throw new Error(`[text-open-world-item-acquisition] ${message}`) }
function row(value: unknown, fields: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== [...fields].sort().join(',')) fail('领取选择字段不精确')
  return value as Record<string, unknown>
}
function ordinal(value: unknown, maximum: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > maximum) fail('领取编号或数量越界')
  return Number(value)
}

export function parseTextOpenWorldItemAcquisitionsV1(
  value: unknown, context: Context, fulfillment: TextOpenWorldQuestFulfillmentSelectionsV1,
): TextOpenWorldItemAcquisitionSelectionV1[] {
  if (!Array.isArray(value) || value.length > context.mapInteractionCatalog.interactions.length) fail('领取选择必须是有界数组')
  const demands = buildTextOpenWorldObjectiveFulfillmentDemandsV1(context)
  let previous = 0
  return value.map(value => {
    const selection = row(value, ['objectiveNumber', 'interactionNumber', 'items'])
    const objectiveNumber = ordinal(selection.objectiveNumber, context.questSkeletons.objectives.length)
    const interactionNumber = ordinal(selection.interactionNumber, context.mapInteractionCatalog.interactions.length)
    if (interactionNumber <= previous) fail('领取交互必须严格升序且唯一')
    previous = interactionNumber
    const demand = demands.find(item => item.objectiveNumber === objectiveNumber)
    const interaction = context.mapInteractionCatalog.interactions[interactionNumber - 1]!
    if (!demand || !['collect', 'interact', 'investigate'].includes(demand.playerIntent)
      || !demand.candidates.some(candidate => candidate.kind === 'interaction' && candidate.key === interaction.key)
      || interaction.questConsumerKeys.length !== 1 || interaction.questConsumerKeys[0] !== demand.questKey
      || demands.some(other => other.objectiveNumber !== objectiveNumber
        && other.candidates.some(candidate => candidate.kind === 'interaction' && candidate.key === interaction.key))) {
      fail('领取交互必须独占同一固定收集或调查目标的冻结需求')
    }
    if (fulfillment.interactions[interactionNumber - 1]!.consumedItems.length) fail('领取交互不能兼作消耗材料的修复')
    if (!Array.isArray(selection.items) || !selection.items.length || selection.items.length > 8) fail('领取物品必须有1到8项')
    let previousItem = 0
    const items = selection.items.map(value => {
      const item = row(value, ['itemNumber', 'quantity'])
      const itemNumber = ordinal(item.itemNumber, context.itemRewardCatalog.items.length)
      const definition = context.itemRewardCatalog.items[itemNumber - 1]!
      if (itemNumber <= previousItem || !demand.itemNumbers.includes(itemNumber)
        || !['quest', 'misc'].includes(definition.kind)) fail('领取只能使用该目标已有的任务物品，不能重复或生成装备、材料、消耗品')
      if (hasTextOpenWorldExplicitItemSourcesV1(context.itemRewardCatalog)
        && !itemHasPlannedSourceV1(context.itemRewardCatalog, definition.key, 'acquisition', demand.objectiveKey)) {
        fail('领取必须履行物品目录中同一目标的明确来源')
      }
      previousItem = itemNumber
      const quantity = ordinal(item.quantity, Math.min(8, definition.maximumStack ?? 1))
      if (definition.unique && quantity !== 1) fail('独特物品只能领取一件')
      return { itemNumber, quantity }
    })
    return { objectiveNumber, interactionNumber, items }
  })
}

/** A pickup is an ordinary, governed location Action. Its one-time proof and
 * grants commit in the same existing Effect batch. It cannot be replayed for
 * resale, including after abandoning/restarting an ordinary quest. */
export function compileTextOpenWorldItemAcquisitionsV1(input: {
  context: Context
  selections: TextOpenWorldItemAcquisitionSelectionV1[]
  fulfillment: TextOpenWorldQuestFulfillmentSelectionsV1
} & Pick<TextOpenWorldQuestDesignDocumentsV1, 'conditions' | 'effects' | 'actions'> & {
  interactions: TextOpenWorldQuestDesignDocumentsV1['catalogBindings']['interactions']
}): void {
  const { context, selections, fulfillment, conditions, effects, actions } = input
  for (const selection of selections) {
    const objective = context.questSkeletons.objectives[selection.objectiveNumber - 1]!
    const interaction = context.mapInteractionCatalog.interactions[selection.interactionNumber - 1]!
    const owner = actions.find(action => action.key === `action.interaction.${interaction.key}`)!
    const prerequisites: TextOpenWorldConditionExpressionV1[] = [
      { op: 'quest-status', questKey: objective.questKey, statuses: ['active'] },
      { op: 'quest-stage', questKey: objective.questKey, stageKey: objective.stageKey },
      { op: 'not', condition: { op: 'quest-objective', objectiveKey: objective.key, status: 'completed' } },
      { op: 'not', condition: { op: 'world-flag', flagKey: `flag.fulfillment.interaction.${interaction.key}`, value: true } },
      ...context.questSkeletons.objectives.filter(other => other.stageKey === objective.stageKey
        && other.order < objective.order && !other.optional).map(other => ({
          op: 'quest-objective' as const, objectiveKey: other.key, status: 'completed' as const,
        })),
    ]
    // Borrowing may require a permit; never require the very object being
    // acquired as an input to its own pickup.
    const acquired = new Set(selection.items.map(item => item.itemNumber))
    for (const item of fulfillment.objectives.find(item => item.objectiveNumber === selection.objectiveNumber)!.items) {
      if (!acquired.has(item.itemNumber)) prerequisites.push({
        op: 'inventory-quantity', itemKey: context.itemRewardCatalog.items[item.itemNumber - 1]!.key,
        comparator: 'gte', value: item.quantity,
      })
    }
    const conditionKey = `condition.acquisition.${interaction.key}`
    conditions.push({ key: conditionKey, expression: { op: 'all', conditions: prerequisites },
      failureMessage: '需进入对应任务阶段、完成前置目标并持有所需凭据；这处物品只能领取一次。' })
    owner.requirementConditionKeys.push(conditionKey)
    for (const item of selection.items) {
      const definition = context.itemRewardCatalog.items[item.itemNumber - 1]!
      const key = `effect.acquisition.${interaction.key}.${definition.key}`
      effects.push({ key, operation: 'grant-item', payload: {
        itemKey: definition.key, quantity: item.quantity, ...(definition.unique ? { ifAbsent: true as const } : {}),
      } })
      owner.successEffectKeys.push(key)
    }
    const binding = input.interactions.find(item => item.interactionKey === interaction.key)!
    binding.conditionKeys = [...owner.requirementConditionKeys]
    binding.effectKeys = [...owner.costEffectKeys, ...owner.successEffectKeys]
  }
}
