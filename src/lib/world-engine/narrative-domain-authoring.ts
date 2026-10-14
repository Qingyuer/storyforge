import Dexie from 'dexie'
import { db } from '../db/schema'
import { REGISTRY_BY_NAME } from '../registry/project-tables'
import { FIELD_BY_TARGET } from '../registry/field-registry'
import { isPortableResourceUidV1 } from '../context-gateway/resource-uid'
import type { WorkspaceScope } from '../types/world-ownership'
import type { NarrativeOwnerV1 } from '../types/narrative-ir'
import type { NarrativeDomainAuthorityV1, NarrativeDomainFieldsV1 } from '../types/narrative-domain'
import { captureNarrativeDomainInTransactionV1, hashNarrativeDomainSourceV1, narrativeDomainCaptureTablesV1 } from './narrative-domain-capture'
import { mapNarrativeDomainReferencesV1, parseNarrativeDomainFieldV1, type NarrativeDomainFieldV1 } from '../narrative-domain/codec'
import { compileNarrativeDomainEvidenceV1, resolveNarrativeDomainReferenceV1 } from './narrative-domain-evidence'
import { canonicalNarrativeJsonV1, hashV1, narrativeFail } from './narrative-json'

function assertNoConfirmationReceipt(value: unknown): void {
  if (Array.isArray(value)) { value.forEach(assertNoConfirmationReceipt); return }
  if (!value || typeof value !== 'object') return
  if (Object.prototype.hasOwnProperty.call(value, 'narrativeAuthorityV1')) narrativeFail('authority', '输入不得包含系统确认凭据')
  Object.values(value).forEach(assertNoConfirmationReceipt)
}

/** Explicit author declaration extension, not a generic model tool. The caller
 * must display the source and proposed annotations before the author confirms.
 * Candidate adoption will bind its durable receipt through the same CAS seam. */
export async function confirmNarrativeDomainAnnotationsV1(input: {
  scope: WorkspaceScope
  owner?: NarrativeOwnerV1
  table: string
  recordId: number
  expectedSourceHash: string
  annotations: Partial<Omit<NarrativeDomainFieldsV1, 'narrativeAuthorityV1'>>
  clearFields?: NarrativeDomainFieldV1[]
}): Promise<NarrativeDomainAuthorityV1> {
  hashV1(input.expectedSourceHash, 'expectedSourceHash')
  canonicalNarrativeJsonV1(input.annotations)
  assertNoConfirmationReceipt(input.annotations)
  const spec = REGISTRY_BY_NAME.get(input.table)
  if (!spec?.worldSemantic?.projector) narrativeFail('projector', '来源未登记叙事确认入口')
  const fields = FIELD_BY_TARGET.get(input.table) ?? []
  const patch: Record<string, unknown> = {}
  for (const [field, value] of Object.entries(input.annotations)) {
    if (!fields.some(item => item.field === field && item.adoptionPolicy === 'narrative-annotation-v1')) {
      narrativeFail('domain-field', `${input.table}.${field} 不能通过此入口写入`)
    }
    patch[field] = parseNarrativeDomainFieldV1(field as NarrativeDomainFieldV1, value)
  }
  for (const field of input.clearFields ?? []) {
    if (field in patch || !fields.some(item => item.field === field && item.adoptionPolicy === 'narrative-annotation-v1')) {
      narrativeFail('domain-field', '清除字段未登记或与写入字段冲突')
    }
  }
  return db.transaction('rw', narrativeDomainCaptureTablesV1(), async () => {
    const work = await db.works.get(input.scope.workId)
    if (!work) narrativeFail('owner', '作品不存在')
    const capture = await Dexie.waitFor(captureNarrativeDomainInTransactionV1({ scope: input.scope,
      owner: input.owner ?? { kind: 'work', workCode: work.code } }))
    const current = capture.rows.get(input.table)?.find(row => row.id === input.recordId)
    if (!current) narrativeFail('scope', '确认记录不属于当前作用域')
    if (!spec.resourceIdentity || !isPortableResourceUidV1(current[spec.resourceIdentity.field], spec.resourceIdentity.resourceKind)) {
      narrativeFail('source-uid', '旧来源缺少稳定身份，不能由确认或投影静默补写')
    }
    if (await Dexie.waitFor(hashNarrativeDomainSourceV1(capture, input.table, current)) !== input.expectedSourceHash) {
      narrativeFail('stale', '来源或注释已变化，请重新审阅后确认')
    }
    const next = { ...current, ...patch }
    for (const field of input.clearFields ?? []) delete next[field]
    for (const field of spec.worldSemantic!.projector!.annotationFields) {
      if (next[field] === undefined) continue
      mapNarrativeDomainReferencesV1(field, next[field], reference => {
        resolveNarrativeDomainReferenceV1(capture, reference)
        return reference
      })
    }
    const groups = [next, ...(next.narrativeDevelopmentsV1 ?? []), ...(next.narrativeDisclosuresV1 ?? [])]
    for (const group of groups) for (const evidence of group.narrativeEvidenceV1 ?? []) {
      await Dexie.waitFor(compileNarrativeDomainEvidenceV1(capture, input.table, next, evidence, evidence.evidenceKey))
    }
    const contentHash = await Dexie.waitFor(hashNarrativeDomainSourceV1(capture, input.table, next))
    if (current.narrativeAuthorityV1?.contentHash === contentHash) return current.narrativeAuthorityV1
    const receipt: NarrativeDomainAuthorityV1 = { version: 1, confirmationUid: `confirmation:v1:${crypto.randomUUID()}`,
      mode: 'author-declaration', confirmedAt: Date.now(),
      contentHash }
    // Replace only the checked record. clearFields is explicit, no spread of
    // untrusted owner IDs, compiled IR, or unregistered payload fields.
    await spec.table.put({ ...next, narrativeAuthorityV1: receipt, updatedAt: receipt.confirmedAt })
    return receipt
  })
}
