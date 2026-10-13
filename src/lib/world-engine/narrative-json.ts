/** Separate from immutable v3 release canonicalization. Never change the v3 comparator. */
export class NarrativeContractErrorV1 extends Error {
  constructor(readonly code: string, message: string) {
    super(`[narrative-ir:${code}] ${message}`)
    this.name = 'NarrativeContractErrorV1'
  }
}
export function narrativeFail(code: string, message: string): never {
  throw new NarrativeContractErrorV1(code, message)
}
export function compareUnicodeCodePointsV1(a: string, b: string): number {
  const left = Array.from(a), right = Array.from(b)
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const difference = left[i].codePointAt(0)! - right[i].codePointAt(0)!
    if (difference) return difference
  }
  return left.length - right.length
}
export function assertUnicodeV1(text: string): void {
  for (const char of text) {
    const point = char.codePointAt(0)!
    if (point >= 0xd800 && point <= 0xdfff) narrativeFail('unicode', '孤立 surrogate 不可编码为原文证据')
  }
}
export function canonicalNarrativeJsonV1(value: unknown): string {
  const stack = new Set<object>()
  const encode = (item: unknown): string => {
    if (item === null) return 'null'
    if (typeof item === 'string') { assertUnicodeV1(item); return JSON.stringify(item) }
    if (typeof item === 'boolean') return String(item)
    if (typeof item === 'number' && Number.isFinite(item) && !Object.is(item, -0)
      && (!Number.isInteger(item) || Number.isSafeInteger(item))) return String(item)
    if (typeof item !== 'object' || !item) narrativeFail('json', '仅允许精确 JSON 值；禁止 undefined/非有限数/不安全整数')
    if (stack.has(item)) narrativeFail('json-cycle', 'JSON 不允许循环对象')
    stack.add(item)
    let encoded: string
    if (Array.isArray(item)) {
      if (Object.keys(item).length !== item.length) narrativeFail('json', '数组必须稠密且无额外属性')
      encoded = `[${Array.from(item, encode).join(',')}]`
    } else {
      if (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) {
        narrativeFail('json', '仅允许普通 JSON 对象')
      }
      if (Object.getOwnPropertySymbols(item).length) narrativeFail('json', '不允许 symbol 属性')
      encoded = `{${Object.keys(item).sort(compareUnicodeCodePointsV1).map(key => {
        assertUnicodeV1(key)
        const descriptor = Object.getOwnPropertyDescriptor(item, key)!
        if (!('value' in descriptor)) narrativeFail('json', '不允许 accessor')
        return `${JSON.stringify(key)}:${encode(descriptor.value)}`
      }).join(',')}}`
    }
    stack.delete(item)
    return encoded
  }
  return encode(value)
}
export async function hashNarrativeBytesV1(value: string | Uint8Array): Promise<string> {
  if (typeof value === 'string') assertUnicodeV1(value)
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value)
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')
}
export const hashNarrativeValueV1 = (value: unknown): Promise<string> => hashNarrativeBytesV1(canonicalNarrativeJsonV1(value))

export type DecoderV1<T> = (value: unknown, path: string) => T
export const textV1: DecoderV1<string> = (value, path) => {
  if (typeof value !== 'string') narrativeFail('shape', `${path} 必须是 string`)
  assertUnicodeV1(value)
  return value
}
export const keyV1: DecoderV1<string> = (value, path) => {
  const text = textV1(value, path)
  if (!text || text.trim() !== text) narrativeFail('shape', `${path} 必须是精确非空键`)
  return text
}
export const hashV1: DecoderV1<string> = (value, path) => {
  const text = textV1(value, path)
  if (!/^[a-f0-9]{64}$/.test(text)) narrativeFail('hash', `${path} 必须是 SHA-256`)
  return text
}
export const pointerV1: DecoderV1<string> = (value, path) => {
  const pointer = textV1(value, path)
  if (!/^(\/(?:[^~]|~[01])*)+$/.test(pointer)) narrativeFail('json-pointer', `${path} 必须是非空规范 JSON pointer`)
  return pointer
}
export const uintV1: DecoderV1<number> = (value, path) => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) {
    narrativeFail('shape', `${path} 必须是安全非负整数`)
  }
  return value
}
export const integerTextV1: DecoderV1<string> = (value, path) => {
  const text = textV1(value, path)
  if (!/^(0|-?[1-9][0-9]*)$/.test(text)) narrativeFail('tick', `${path} 必须是规范十进制整数`)
  return text
}
export const nullableV1 = <T>(decoder: DecoderV1<T>): DecoderV1<T | null> => (value, path) => value === null ? null : decoder(value, path)
export const enumV1 = <T extends string | number>(values: readonly T[]): DecoderV1<T> => (value, path) => {
  if (!values.includes(value as T)) narrativeFail('enum', `${path} 不支持 ${String(value)}`)
  return value as T
}
export const arrayV1 = <T>(decoder: DecoderV1<T>): DecoderV1<T[]> => (value, path) => {
  if (!Array.isArray(value)) narrativeFail('shape', `${path} 必须是数组`)
  return value.map((item, index) => decoder(item, `${path}[${index}]`))
}
export const uniqueKeysV1: DecoderV1<string[]> = (value, path) => {
  const keys = arrayV1(keyV1)(value, path)
  if (new Set(keys).size !== keys.length) narrativeFail('duplicate', `${path} 键重复`)
  return keys.sort(compareUnicodeCodePointsV1)
}
export function objectV1<T extends object>(shape: { [K in keyof T]-?: DecoderV1<T[K]> }): DecoderV1<T> {
  return (value, path) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) narrativeFail('shape', `${path} 必须是对象`)
    const expected = Object.keys(shape)
    if (Object.keys(value).length !== expected.length || expected.some(key => !Object.prototype.hasOwnProperty.call(value, key))) {
      narrativeFail('exact-keys', `${path} 缺少字段或含额外字段`)
    }
    return Object.fromEntries(expected.map(key => [key,
      (shape[key as keyof T] as DecoderV1<unknown>)((value as Record<string, unknown>)[key], `${path}.${key}`),
    ])) as T
  }
}
