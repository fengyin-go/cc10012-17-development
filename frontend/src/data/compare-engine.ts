import type {
  CompareDataset,
  CompareDetail,
  CompareResult,
  EntryRow,
} from './types'

// 差异计算引擎：纯函数，不碰 localStorage，页面与本地服务共用同一套口径。

export const DEFAULT_LOW_SAMPLE_THRESHOLD = 30
export const DEFAULT_SIGNIFICANCE_LEVEL = '0.05'

// 解析方案上的「差异阈值」，支持 5% / 0.05 / 5 三种写法，统一成小数比率。
export function parseThreshold(raw: unknown): number {
  const text = String(raw ?? '').trim()
  if (!text) return 0
  if (text.endsWith('%')) {
    return Number(text.slice(0, -1)) / 100
  }
  const value = Number(text)
  if (!Number.isFinite(value)) return 0
  return value > 1 ? value / 100 : value
}

export function parseSignificanceLevel(raw: unknown, fallback = DEFAULT_SIGNIFICANCE_LEVEL): string {
  const text = String(raw ?? '').trim()
  const value = Number(text)
  if (!text || !Number.isFinite(value) || value <= 0 || value >= 1) {
    return fallback
  }
  return text
}

// 低样本阈值：方案字段里若显式给了「最小样本量」就用方案的，否则用默认值。
export function resolveMinSample(plan: EntryRow): number {
  const explicit = Number(plan['最小样本量'])
  return Number.isFinite(explicit) && explicit > 0 ? explicit : DEFAULT_LOW_SAMPLE_THRESHOLD
}

// 口径冲突处理：两侧都建议了显著性水平且不一致时，取更严格（更小）的水平，
// 宁可少报稳定结论，也不放宽结论边界。
export function resolveSignificanceLevel(
  planLevel: string,
  baseline: CompareDataset,
  comparison: CompareDataset,
): { level: string; note: string } {
  const plan = parseSignificanceLevel(planLevel, '')
  const candidates = [
    plan,
    parseSignificanceLevel(baseline.suggestedLevel ?? '', ''),
    parseSignificanceLevel(comparison.suggestedLevel ?? '', ''),
  ].filter((item) => item !== '')
  if (candidates.length === 0) {
    return { level: DEFAULT_SIGNIFICANCE_LEVEL, note: `方案与数据集均未声明显著性水平，按默认 ${DEFAULT_SIGNIFICANCE_LEVEL} 从严执行` }
  }
  const level = candidates.reduce((acc, cur) => (Number(cur) < Number(acc) ? cur : acc))
  const conflict = new Set(candidates).size > 1
  return {
    level,
    note: conflict
      ? `两侧显著性口径冲突（${candidates.join(' / ')}），按更严格水平 ${level} 取舍`
      : `两侧显著性口径一致，按 ${level} 执行`,
  }
}

function indexPoints(dataset: CompareDataset): Map<string, CompareDataset['points'][number]> {
  const map = new Map<string, CompareDataset['points'][number]>()
  for (const point of dataset.points) {
    map.set(point.dimensionValue, point)
  }
  return map
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000
}

export type ComputeContext = {
  plan: EntryRow
  baseline: CompareDataset
  comparison: CompareDataset
  minSample: number
}

export type ComputeOutcome =
  | { ok: true; result: Omit<CompareResult, 'id' | 'createdAt'> }
  | { ok: false; message: string }

// 两侧数据一起校验、一起计算：任一侧缺维度/缺版本/缺指标就整体失败，
// 由调用方保证失败时不落任何对比结果表数据（不发布半张表）。
export function computeCompareResult(context: ComputeContext): ComputeOutcome {
  const { plan, baseline, comparison, minSample } = context

  if (baseline.dimension !== comparison.dimension) {
    return {
      ok: false,
      message: `两侧对比维度不一致：基准侧「${baseline.dimension}」/ 对照侧「${comparison.dimension}」，无法计算差额`,
    }
  }
  if (baseline.metric !== comparison.metric) {
    return {
      ok: false,
      message: `两侧对比指标不一致：基准侧「${baseline.metric}」/ 对照侧「${comparison.metric}」，无法计算差额`,
    }
  }
  if (!baseline.version || !comparison.version) {
    return { ok: false, message: '基准或对照数据集缺少数据版本，两侧版本必须同时可见才能发布对比结果' }
  }
  if (baseline.points.length === 0 || comparison.points.length === 0) {
    return { ok: false, message: '基准或对照数据集没有可计算的维度明细，单侧为空不能发布对比结果' }
  }

  const threshold = parseThreshold(plan['差异阈值'])
  const { level, note } = resolveSignificanceLevel(
    String(plan['显著性水平'] ?? ''),
    baseline,
    comparison,
  )

  const baselineMap = indexPoints(baseline)
  const comparisonMap = indexPoints(comparison)
  const dimensionValues = [...new Set([...baselineMap.keys(), ...comparisonMap.keys()])].sort()

  const details: CompareDetail[] = dimensionValues.map((dimensionValue) => {
    const left = baselineMap.get(dimensionValue)
    const right = comparisonMap.get(dimensionValue)
    const baselineValue = left ? left.value : null
    const comparisonValue = right ? right.value : null
    const baselineSample = left?.sampleSize ?? 0
    const comparisonSample = right?.sampleSize ?? 0
    const sampleSize = Math.min(baselineSample, comparisonSample)
    const diff =
      baselineValue !== null && comparisonValue !== null ? round4(comparisonValue - baselineValue) : null
    const diffRate =
      diff !== null && baselineValue !== null && baselineValue !== 0
        ? round4(diff / Math.abs(baselineValue))
        : null
    const overThreshold = diffRate !== null && Math.abs(diffRate) > threshold
    // 严格保留低样本维度：不静默丢弃，只把它标成待复核，结论边界让显著性标记守住。
    const lowSample = sampleSize < minSample
    const significanceMark = lowSample ? '待复核' : overThreshold ? '显著' : '不显著'
    const detailNote = lowSample
      ? `样本量 ${sampleSize} 低于最小样本量 ${minSample}，差异需复核，不作为稳定结论`
      : overThreshold
        ? `差异率 ${(diffRate! * 100).toFixed(2)}% 超过阈值 ${(threshold * 100).toFixed(2)}%，样本充足`
        : `差异率 ${diffRate === null ? '—' : (diffRate * 100).toFixed(2) + '%'} 未超过阈值 ${(threshold * 100).toFixed(2)}%`

    return {
      dimensionValue,
      baselineVersion: left?.version ?? baseline.version,
      comparisonVersion: right?.version ?? comparison.version,
      baselineValue,
      comparisonValue,
      baselineSample,
      comparisonSample,
      sampleSize,
      diff,
      diffRate,
      threshold,
      overThreshold,
      // 进入差异明细的口径：超过阈值即保留；低样本维度同样保留并带待复核标记，而不是静默丢弃。
      inDetail: overThreshold,
      lowSample,
      significanceMark,
      significanceLevel: level,
      note: detailNote,
    }
  })

  return {
    ok: true,
    result: {
      planId: Number(plan.id),
      planCode: String(plan['方案编号'] ?? ''),
      baselineDataset: baseline.name,
      comparisonDataset: comparison.name,
      dimension: baseline.dimension,
      metric: baseline.metric,
      threshold,
      significanceLevel: level,
      levelNote: note,
      baselineVersion: baseline.version,
      comparisonVersion: comparison.version,
      resultVersion: buildResultVersion(baseline.version, comparison.version),
      generatedFrom: `${baseline.code}@${baseline.version}|${comparison.code}@${comparison.version}`,
      details,
      detailCount: details.filter((item) => item.inDetail).length,
      reviewCount: details.filter((item) => item.inDetail && item.lowSample).length,
    },
  }
}

// 对比结果版本由两侧数据版本共同决定：任一侧版本变化，结果版本必然变化，可追溯。
export function buildResultVersion(baselineVersion: string, comparisonVersion: string): string {
  return `R[${baselineVersion}~${comparisonVersion}]`
}
