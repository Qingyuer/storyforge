import type {
  EvidenceSpanV1, NarrativeEvidenceSourceV1, NarrativeIRBundleV1, NarrativeRecordV1,
} from '../types/narrative-ir'
import { getFactPredicate } from '../registry/fact-predicate-registry'
import { isPublicWorldCode } from '../workspace/identity'
import { narrativeOwnerKeyV1, parseNarrativeSemanticIdV1 } from './narrative-identity'
import { mapNarrativeReferencesV1, parseNarrativeIRBundleV1, parseNarrativeRecordV1 } from './narrative-ir-codec'
import { arrayV1, canonicalNarrativeJsonV1, hashNarrativeBytesV1, hashNarrativeValueV1, keyV1, narrativeFail, objectV1, pointerV1, textV1 } from './narrative-json'
import { validateNarrativeTimeReferencesV1 } from './narrative-time'

const UNBOUND_HASH = '0'.repeat(64)
const sourceKey = (source: Pick<NarrativeEvidenceSourceV1, 'sourceResourceKey' | 'sourceRevision' | 'fieldPointer'>) =>
  canonicalNarrativeJsonV1([source.sourceResourceKey, source.sourceRevision, source.fieldPointer])

/** Hash local content first. ALL resolved semantic-ref hashes are bound later,
 * so reciprocal relations/contradictions do not introduce hash recursion. */
export async function hashNarrativeRecordV1(input: NarrativeRecordV1): Promise<string> {
  const record = parseNarrativeRecordV1(input)
  const strip = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(strip)
    if (!value || typeof value !== 'object') return value
    return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'revisionHash' && key !== 'revisionVectorHash')
      .map(([key, child]) => [key, strip(child)]))
  }
  return hashNarrativeValueV1(strip(record))
}
export async function hashNarrativeBundleV1(input: NarrativeIRBundleV1): Promise<string> {
  const { semanticRootHash: _root, ...content } = parseNarrativeIRBundleV1(input)
  return hashNarrativeValueV1(content)
}

export async function verifyNarrativeEvidenceV1(evidence: EvidenceSpanV1, source: NarrativeEvidenceSourceV1): Promise<void> {
  if (sourceKey(evidence) !== sourceKey(source)) narrativeFail('evidence-source', '证据源/字段/版本不一致')
  const bytes = new TextEncoder().encode(source.text)
  if (evidence.normalizationVersion !== 'raw-utf8-v1' || !Number.isSafeInteger(evidence.start)
    || !Number.isSafeInteger(evidence.end) || evidence.start < 0 || evidence.end <= evidence.start || evidence.end > bytes.length) {
    narrativeFail('evidence-span', '原文跨度必须非空、合法且在原始 UTF-8 范围内')
  }
  const boundary = (position: number) => position === bytes.length || (bytes[position] & 0xc0) !== 0x80
  if (!boundary(evidence.start) || !boundary(evidence.end)) narrativeFail('evidence-boundary', '证据不能切开 UTF-8 码点')
  if (await hashNarrativeBytesV1(source.text) !== evidence.sourceContentHash
    || await hashNarrativeBytesV1(bytes.slice(evidence.start, evidence.end)) !== evidence.spanHash) {
    narrativeFail('evidence-hash', '原文/证据 hash 不符')
  }
}

/** Verifies an isolated compiler artifact. This does not grant publishability,
 * permissions, author confirmation or v4 release status. */
export async function verifyNarrativeIRBundleV1(
  input: unknown, sources: readonly NarrativeEvidenceSourceV1[],
): Promise<NarrativeIRBundleV1> {
  const bundle = parseNarrativeIRBundleV1(input)
  const records = new Map(bundle.records.map(r => [r.semanticId, r]))
  const evidenceIds = new Set(bundle.evidence.map(e => e.evidenceId))
  canonicalNarrativeJsonV1(sources)
  const checkedSources = arrayV1(objectV1<NarrativeEvidenceSourceV1>({ sourceResourceKey: keyV1, sourceRevision: keyV1,
    fieldPointer: pointerV1, text: textV1 }))(sources, 'sources')
  const sourceMap = new Map(checkedSources.map(s => [sourceKey(s), s]))
  if (sourceMap.size !== sources.length) narrativeFail('duplicate-source', '冻结原文来源重复')
  const requireEvidence = (ids: string[]) => {
    if (ids.some(id => !evidenceIds.has(id))) narrativeFail('evidence-missing', '引用的证据不在闭包内')
  }
  const lookup = (id: string, revisionHash: string) => {
    const target = records.get(id)
    if (!target) narrativeFail('reference-missing', '语义引用缺失或跨 owner/branch')
    if (target.revisionHash !== revisionHash) narrativeFail('stale-reference', '依赖目标 revisionHash 已变化')
    return target
  }
  const namespace = narrativeOwnerKeyV1(bundle.scope.owner)
  const uidSpellings = new Map<string, string>()
  for (const record of bundle.records) {
    const uid = parseNarrativeSemanticIdV1(record.semanticId).source.sourceUid
    const previous = uidSpellings.get(uid.toLowerCase())
    if (previous && previous !== uid) narrativeFail('duplicate-uid', '同一 UID 使用不同大小写声明多个身份')
    uidSpellings.set(uid.toLowerCase(), uid)
  }
  for (const sequence of bundle.timeContext.sequences) {
    if (sequence.ownerKey !== namespace) narrativeFail('sequence-owner', 'sequence owner 与 bundle 不符')
  }
  const worldKeys = new Set([namespace, ...bundle.records.filter(r => r.kind === 'entity' && r.payload.entityType === 'world-group')
    .map(r => parseNarrativeSemanticIdV1(r.semanticId).source.sourceUid)])
  if (bundle.scope.worldGroupKey !== null && !worldKeys.has(bundle.scope.worldGroupKey)) narrativeFail('world-group', '子世界缺少稳定身份声明')
  for (const timeline of bundle.timeContext.timelines) {
    if (!worldKeys.has(timeline.worldKey) || timeline.branchKey !== bundle.scope.branchKey) narrativeFail('timeline-scope', '时间体系 scope/branch 不符')
  }
  for (const anchor of bundle.timeContext.anchors) {
    if (records.get(anchor.eventKey)?.kind !== 'event') narrativeFail('anchor-reference', '时间 anchor 必须指向本包事件')
  }
  for (const mapping of bundle.timeContext.mappings) requireEvidence(mapping.evidenceIds)
  for (const evidence of bundle.evidence) {
    const source = sourceMap.get(sourceKey(evidence))
    if (!source) narrativeFail('evidence-source', '缺少冻结原文')
    await verifyNarrativeEvidenceV1(evidence, source)
  }
  for (const record of bundle.records) {
    if (await hashNarrativeRecordV1(record) !== record.revisionHash) narrativeFail('record-hash', '记录 hash 不符')
    validateNarrativeTimeReferencesV1(record.time, bundle.timeContext)
    requireEvidence(record.evidenceIds)
    const provenanceSource = sourceMap.get(sourceKey({ sourceResourceKey: record.provenance.sourceResourceKey,
      sourceRevision: record.provenance.sourceRevision, fieldPointer: record.provenance.sourceField }))
    if (!provenanceSource || await hashNarrativeBytesV1(provenanceSource.text) !== record.provenance.sourceContentHash) {
      narrativeFail('provenance-hash', '来源字段/版本/原文 hash 不匹配')
    }
    const narration = record.time.narratedAt
    if (narration) {
      const spans = bundle.evidence.filter(e => record.evidenceIds.includes(e.evidenceId)
        && e.sourceResourceKey.endsWith(`:${narration.unitKey}`))
      if (!spans.some(span => {
        const bytes = new TextEncoder().encode(sourceMap.get(sourceKey(span))!.text)
        return narration.spanStart >= span.start && narration.spanStart < span.end
          && (bytes[narration.spanStart] & 0xc0) !== 0x80
      })) narrativeFail('narration-evidence', '叙述 offset 必须落在本记录关联的原文证据码点内')
    }
    for (const dependency of record.dependencies) lookup(dependency.semanticId, dependency.revisionHash)
    mapNarrativeReferencesV1(record, ref => {
      if (lookup(ref.semanticId, ref.revisionHash).kind !== ref.kind) narrativeFail('ref-kind', '语义目标类型不符')
      return ref
    })
    if (record.kind === 'assertion') {
      const predicate = getFactPredicate(record.payload.predicateKey)
      if (!predicate) narrativeFail('predicate-unregistered', '未知 predicate 不能进入已验证合同')
      const kind = record.payload.value.kind
      const acceptedKind = predicate.valueType === 'string' ? 'text' : predicate.valueType === 'number' ? 'decimal' : predicate.valueType
      if (kind !== acceptedKind || (kind === 'enum' && record.payload.value.kind === 'enum'
        && !predicate.enums?.includes(record.payload.value.value))) narrativeFail('predicate-value', '值不符合谓词注册类型')
      for (const prior of record.payload.supersedesRefs) {
        const previous = lookup(prior.semanticId, prior.revisionHash)
        if (previous.kind !== 'assertion' || previous.payload.subjectRef.semanticId !== record.payload.subjectRef.semanticId
          || previous.payload.predicateKey !== record.payload.predicateKey) narrativeFail('supersedes', '只能替代同一主体/谓词的历史状态')
      }
    }
    if (record.kind === 'rule' && record.payload.strength === 'hard') {
      // No narrative hard-rule executors are registered in NW-1A. Do not turn
      // a model-supplied validator name into a proof of executable semantics.
      narrativeFail('validator-unavailable', 'NW-1A 不注册硬规则执行器；保留 advisory 或等待后续领域注册')
    }
    if (record.kind === 'development') requireEvidence(record.payload.resolutionEvidenceIds)
    if (record.kind === 'disclosure') {
      requireEvidence([record.payload.spanRef])
      validateNarrativeTimeReferencesV1({ occurred: null, valid: null, narratedAt: null, acquiredAt: null,
        disclosedAt: record.payload.audienceKeys.map(audienceKey => ({ audienceKey, sequenceKey: record.payload.sequenceKey, unitKey: record.payload.unitKey })) }, bundle.timeContext)
      const span = bundle.evidence.find(e => e.evidenceId === record.payload.spanRef)!
      if (!span.sourceResourceKey.endsWith(`:${record.payload.unitKey}`)) narrativeFail('disclosure-evidence', '揭示证据不属于指定冻结 unit')
    }
  }
  const aliasSources = new Set<string>()
  const mergeEdges = new Map<string, string>()
  for (const alias of bundle.aliases) {
    const target = records.get(alias.toSemanticId)
    if (!target) narrativeFail('alias-target', 'alias 目标不在当前 bundle')
    const from = alias.from
    const sourceId = from.kind === 'semantic' ? from.semanticId : canonicalNarrativeJsonV1(from)
    if (aliasSources.has(sourceId)) narrativeFail('alias-conflict', '同一身份存在多个 alias')
    aliasSources.add(sourceId)
    if (from.kind === 'legacy-release') {
      if (alias.reason !== 'legacy' || !isPublicWorldCode(from.worldCode)
        || bundle.scope.owner.kind !== 'world' || from.worldCode !== bundle.scope.owner.worldCode) narrativeFail('alias-legacy', 'legacy alias 必须绑定原世界/release hash/key')
    } else {
      const origin = parseNarrativeSemanticIdV1(from.semanticId), to = parseNarrativeSemanticIdV1(alias.toSemanticId)
      if (from.semanticId === alias.toSemanticId || origin.kind !== to.kind
        || (alias.reason === 'merge' ? origin.ownerKey !== to.ownerKey
          : alias.reason !== 'derivation' || origin.ownerKey === to.ownerKey)) narrativeFail('alias-scope', '合并保持 namespace；派生必须显式换 namespace')
      if (alias.reason === 'derivation' && origin.ownerKey.startsWith('work/') && bundle.scope.owner.kind === 'world'
        && origin.ownerKey !== `work/${bundle.scope.owner.sourceWorkCode}`) narrativeFail('alias-lineage', '作品派生 alias 与 sourceWorkCode 不一致')
      if (records.has(from.semanticId)) lookup(from.semanticId, from.revisionHash)
      mergeEdges.set(from.semanticId, alias.toSemanticId)
    }
  }
  for (const origin of mergeEdges.keys()) {
    const seen = new Set<string>()
    let next: string | undefined = origin
    while (next !== undefined) {
      if (seen.has(next)) narrativeFail('alias-cycle', 'alias 存在环')
      seen.add(next); next = mergeEdges.get(next)
    }
  }
  if (await hashNarrativeBundleV1(bundle) !== bundle.semanticRootHash) narrativeFail('root-hash', 'IR bundle root 不符')
  return bundle
}

/** Explicit pure compilation of caller-confirmed typed input, not extraction or
 * persistence. Source/owner capture and adoption remain with NW-1B/1C. */
export async function compileNarrativeIRBundleV1(
  input: Omit<NarrativeIRBundleV1, 'schema' | 'irVersion' | 'semanticRootHash'>,
  sources: readonly NarrativeEvidenceSourceV1[],
): Promise<NarrativeIRBundleV1> {
  const bundle = parseNarrativeIRBundleV1({ ...input, schema: 'storyforge.narrative-ir', irVersion: 1, semanticRootHash: UNBOUND_HASH })
  const hashes = new Map(await Promise.all(bundle.records.map(async record => [record.semanticId, await hashNarrativeRecordV1(record)] as const)))
  const hashFor = (id: string) => hashes.get(id) ?? narrativeFail('reference-missing', '编译依赖未闭合')
  const bind = (id: string, prior: string) => {
    const actual = hashFor(id)
    if (prior !== UNBOUND_HASH && prior !== actual) narrativeFail('stale-reference', '显式输入已绑定旧 revision；不能静默重绑')
    return actual
  }
  bundle.records = bundle.records.map(record => mapNarrativeReferencesV1({ ...record, revisionHash: bind(record.semanticId, record.revisionHash),
    dependencies: record.dependencies.map(dependency => ({ ...dependency, revisionHash: bind(dependency.semanticId, dependency.revisionHash) })),
  }, ref => ({ ...ref, revisionHash: bind(ref.semanticId, ref.revisionHash) })))
  bundle.semanticRootHash = await hashNarrativeBundleV1(bundle)
  return verifyNarrativeIRBundleV1(bundle, sources)
}
