import { REGISTRY_BY_NAME } from '../registry/project-tables'
import { getCanonAssertionSourceField } from '../registry/canon-assertion-source-registry'
import type { NarrativeDomainEvidenceV1, NarrativeDomainSourceRefV1 } from '../types/narrative-domain'
import type { NarrativeEvidenceSourceV1, EvidenceSpanV1, VisibilityV1 } from '../types/narrative-ir'
import type { NarrativeDomainCaptureV1, NarrativeDomainRowV1 } from './narrative-domain-capture'
import { narrativeDomainReferenceTargetV1 } from '../narrative-domain/references'
import { hashNarrativeBytesV1, narrativeFail, pointerV1 } from './narrative-json'
import { verifyNarrativeEvidenceV1 } from './narrative-ir'
import { intersectNarrativeVisibilityV1 } from '../narrative-domain/visibility'

/** Logical field pointer into a keyed subrecord, never an array position. The
 * resolver returns the exact stored statement bytes without normalization. */
export function narrativeDevelopmentStatementPointerV1(subKey: string): string {
  return `/narrativeDevelopmentsV1/${subKey.replace(/~/g, '~0').replace(/\//g, '~1')}/statement`
}

function developmentAtPointer(table: string, row: NarrativeDomainRowV1, parts: string[]) {
  if (parts[0] !== 'narrativeDevelopmentsV1') return null
  if (!REGISTRY_BY_NAME.get(table)?.worldSemantic?.projector?.annotationFields.includes(parts[0])
    || parts.length !== 3 || parts[2] !== 'statement') narrativeFail('evidence-field', '发展原文必须以持久子记录键定位 statement')
  const matches = row.narrativeDevelopmentsV1?.filter(item => item.semanticSubKey === parts[1]) ?? []
  if (matches.length !== 1) narrativeFail('evidence-source', '发展原文子记录不存在或身份重复')
  return matches[0]
}

export function narrativeDomainEvidenceVisibilityV1(table: string, row: NarrativeDomainRowV1, fieldPointer: string): VisibilityV1 {
  const parts = fieldPointer.slice(1).split('/').map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'))
  const child = developmentAtPointer(table, row, parts)
  const parent = row.narrativeVisibilityV1 ?? { class: 'unclassified' as const, audienceKeys: [], policyVersion: 'unclassified-v1' }
  return child?.narrativeVisibilityV1 ? intersectNarrativeVisibilityV1(parent, [child.narrativeVisibilityV1]) : parent
}

export function resolveNarrativeDomainReferenceV1(capture: NarrativeDomainCaptureV1, reference: NarrativeDomainSourceRefV1): {
  table: string; row: NarrativeDomainRowV1
} {
  const target = narrativeDomainReferenceTargetV1(reference)
  const row = capture.rows.get(target.table)?.find(record => record.id === target.id)
  const spec = REGISTRY_BY_NAME.get(target.table)!
  if (!row || row[spec.resourceIdentity!.field] !== target.sourceUid) narrativeFail('source-missing', '来源已删除、身份变化或不在选定作用域')
  if (capture.peers.get(target.table)?.filter(record => String(record[spec.resourceIdentity!.field]).toLowerCase()
    === target.sourceUid.toLowerCase()).length !== 1) narrativeFail('duplicate-uid', '来源 UID 不唯一')
  return { table: target.table, row }
}

export function readNarrativeDomainEvidenceTextV1(table: string, row: NarrativeDomainRowV1, fieldPointer: string): string {
  pointerV1(fieldPointer, 'fieldPointer')
  const parts = fieldPointer.slice(1).split('/').map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'))
  const development = developmentAtPointer(table, row, parts)
  if (development) return development.statement
  const spec = REGISTRY_BY_NAME.get(table)
  if (!spec?.worldSemantic || !(spec.worldSemantic.projector?.sourceFields.includes(parts[0])
    || getCanonAssertionSourceField(table, parts[0]))) narrativeFail('evidence-field', `${table}${fieldPointer} 未登记为证据来源`)
  let value: unknown = row
  for (const part of parts) {
    if (!value || typeof value !== 'object' || !Object.prototype.hasOwnProperty.call(value, part)) {
      narrativeFail('evidence-source', '来源字段不存在')
    }
    value = (value as Record<string, unknown>)[part]
  }
  if (typeof value !== 'string' || !value.length) narrativeFail('evidence-source', '来源必须是非空原始文本')
  return value
}

export async function narrativeDomainEvidenceSourceV1(table: string, row: NarrativeDomainRowV1, fieldPointer: string): Promise<NarrativeEvidenceSourceV1> {
  const spec = REGISTRY_BY_NAME.get(table)!
  const text = readNarrativeDomainEvidenceTextV1(table, row, fieldPointer)
  const sourceUid = row[spec.resourceIdentity!.field]
  if (typeof sourceUid !== 'string') narrativeFail('source-uid', '来源缺少稳定 UID')
  return { sourceResourceKey: `${spec.resourceIdentity!.contextKind}:${sourceUid}`, fieldPointer,
    sourceRevision: await hashNarrativeBytesV1(text), text }
}

export async function compileNarrativeDomainEvidenceV1(capture: NarrativeDomainCaptureV1, table: string, row: NarrativeDomainRowV1,
  annotation: NarrativeDomainEvidenceV1, evidenceId: string): Promise<{ evidence: EvidenceSpanV1; source: NarrativeEvidenceSourceV1 }> {
  const target = 'self' in annotation.source ? { table, row } : resolveNarrativeDomainReferenceV1(capture, annotation.source)
  const source = await narrativeDomainEvidenceSourceV1(target.table, target.row, annotation.fieldPointer)
  const evidence: EvidenceSpanV1 = { evidenceId, sourceResourceKey: source.sourceResourceKey,
    fieldPointer: source.fieldPointer, sourceRevision: source.sourceRevision,
    sourceContentHash: annotation.sourceContentHash, normalizationVersion: annotation.normalizationVersion,
    start: annotation.start, end: annotation.end, spanHash: annotation.spanHash, supportRole: annotation.supportRole }
  await verifyNarrativeEvidenceV1(evidence, source)
  return { evidence, source }
}
