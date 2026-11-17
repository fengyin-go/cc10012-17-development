import type { CompareResult } from './types'

// 对比结果表业务数据的本地持久化：结果与两侧数据版本绑定，刷新页面、切换视图后仍可追溯。
const RESULT_STORAGE_KEY = 'data-explore-studio:compare-results'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

let resultCache: CompareResult[] | null = null

function readResults(): CompareResult[] {
  if (resultCache) return resultCache
  if (typeof window === 'undefined' || !window.localStorage) {
    resultCache = []
    return resultCache
  }
  const raw = window.localStorage.getItem(RESULT_STORAGE_KEY)
  if (!raw) {
    resultCache = []
    return resultCache
  }
  try {
    resultCache = JSON.parse(raw) as CompareResult[]
    return resultCache
  } catch {
    resultCache = []
    return resultCache
  }
}

function persist(results: CompareResult[]): void {
  resultCache = results
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(RESULT_STORAGE_KEY, JSON.stringify(results))
  }
}

export function listCompareResults(): CompareResult[] {
  return readResults()
}

export function getCompareResult(id: number): CompareResult | undefined {
  return readResults().find((item) => item.id === id)
}

export function getResultByPlan(planId: number): CompareResult | undefined {
  return readResults()
    .filter((item) => item.planId === planId)
    .sort((a, b) => b.id - a.id)[0]
}

// 幂等键：方案 + 两侧数据版本 + 结果版本三者相同即视为同一份对比结果，
// 重复提交只写入一份，不会产生重复差异明细。
function idempotencyKey(result: CompareResult): string {
  return `${result.planId}|${result.baselineVersion}|${result.comparisonVersion}|${result.resultVersion}`
}

// 写入对比结果表：同版本重复提交直接复用已有记录；版本变化时整份替换该方案的旧结果，
// 只替换完整维度（detail 全量重算），不会追加重复差异明细。
export function upsertCompareResult(
  payload: Omit<CompareResult, 'id' | 'createdAt'>,
  now: () => string = () => new Date().toISOString(),
): { result: CompareResult; reused: boolean } {
  const results = readResults()
  const candidateKey = `${payload.planId}|${payload.baselineVersion}|${payload.comparisonVersion}|${payload.resultVersion}`
  const existing = results.find((item) => idempotencyKey(item) === candidateKey)
  if (existing) {
    return { result: clone(existing), reused: true }
  }
  const nextId = results.reduce((max, item) => Math.max(max, item.id), 0) + 1
  const record: CompareResult = { ...clone(payload), id: nextId, createdAt: now() }
  // 同一方案只保留当前版本的一份完整结果，旧版本整体替换而非追加。
  persist([...results.filter((item) => item.planId !== payload.planId), record])
  return { result: record, reused: false }
}

export function resetCompareResults(): CompareResult[] {
  persist([])
  return []
}
