import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import {
  getCompareDataset,
  listCompareDatasets,
  resetCompareDatasets,
  type CompareDatasetRegistration,
} from '@/data/compare-datasets'
import {
  getResultByPlan,
  listCompareResults,
  resetCompareResults,
  upsertCompareResult,
} from '@/data/compare-results'
import { computeCompareResult, resolveMinSample } from '@/data/compare-engine'
import type {
  ActionResult,
  CompareResult,
  EntryRow,
  ModuleMeta,
  OverviewResult,
  PageResult,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}

// ===== 对比分析：差异计算、对比结果表与同版本导出 =====

export function listDatasetsForCompare(): CompareDatasetRegistration[] {
  return listCompareDatasets()
}

export function listResultsForCompare(): CompareResult[] {
  return listCompareResults()
}

export function getCompareResultForPlan(planId: number): CompareResult | undefined {
  return getResultByPlan(planId)
}

export type CompareComputeResult =
  | { ok: true; message: string; result: CompareResult; reused: boolean }
  | { ok: false; message: string }

// 差异计算：读取基准、对照两侧数据集，按方案的对比维度和指标计算差额。
// 先完成全部计算，成功后才写对比结果表——单侧失败时直接返回，不落任何半张表数据。
export function generateCompareResult(planId: number): CompareComputeResult {
  const rows = listRows('compare')
  const plan = rows.find((row) => Number(row.id) === Number(planId))
  if (!plan) {
    return { ok: false, message: `没有找到编号为 ${planId} 的对比方案` }
  }
  const baselineCode = String(plan['基准数据集'] ?? '')
  const comparisonCode = String(plan['对照数据集'] ?? '')
  const baseline = getCompareDataset(baselineCode)
  const comparison = getCompareDataset(comparisonCode)
  // 两侧数据集必须同时可用，缺任意一侧都不发布半张表。
  if (!baseline || !comparison) {
    const missing = [
      baseline ? '' : `基准数据集 ${baselineCode} 未登记或不可读`,
      comparison ? '' : `对照数据集 ${comparisonCode} 未登记或不可读`,
    ]
      .filter(Boolean)
      .join('；')
    return { ok: false, message: `差异计算失败，已中止发布：${missing}` }
  }

  const outcome = computeCompareResult({
    plan,
    baseline,
    comparison,
    minSample: resolveMinSample(plan),
  })
  if (!outcome.ok) {
    return { ok: false, message: `差异计算失败，已中止发布：${outcome.message}` }
  }

  // 计算成功才写库：同版本重复提交复用同一份，重算按完整维度整体替换。
  const saved = upsertCompareResult(outcome.result)
  return {
    ok: true,
    reused: saved.reused,
    result: saved.result,
    message: saved.reused
      ? `同版本结果已存在，复用对比结果表业务数据（${saved.result.resultVersion}），未重复写入`
      : `对比结果表业务数据已生成（${saved.result.resultVersion}），差异明细 ${saved.result.detailCount} 条，其中待复核 ${saved.result.reviewCount} 条`,
  }
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function rateText(rate: number | null): string {
  return rate === null ? '' : `${(rate * 100).toFixed(2)}%`
}

// 导出与页面明细严格一致：表头信息 + 全量维度差异明细，低样本行保留待复核标记，
// 不会把低样本差异包装成稳定结论；文件名带结果版本，保证导出文件与结果同版本。
export function exportCompareResult(resultId: number): { filename: string; content: string } {
  const result = listCompareResults().find((item) => item.id === resultId)
  if (!result) {
    throw new Error(`没有找到编号为 ${resultId} 的对比结果表业务数据`)
  }
  const lines: string[] = []
  lines.push(['对比结果表业务数据'].map(csvCell).join(','))
  lines.push(
    [
      ['方案编号', result.planCode],
      ['基准数据集', `${result.baselineDataset}（版本 ${result.baselineVersion}）`],
      ['对照数据集', `${result.comparisonDataset}（版本 ${result.comparisonVersion}）`],
      ['对比维度', result.dimension],
      ['对比指标', result.metric],
      ['差异阈值', rateText(result.threshold)],
      ['显著性水平', result.significanceLevel],
      ['口径说明', result.levelNote],
      ['结果版本', result.resultVersion],
      ['生成时间', result.createdAt],
    ]
      .map(([key, value]) => `${csvCell(key)},${csvCell(value)}`)
      .join('\n'),
  )
  lines.push('')
  lines.push(
    [
      '维度取值',
      '基准版本',
      '对照版本',
      '基准指标值',
      '对照指标值',
      '基准样本量',
      '对照样本量',
      '样本依据(最小样本量)',
      '差额',
      '差异率',
      '阈值',
      '是否超阈值',
      '进入差异明细',
      '显著性标记',
      '说明',
    ]
      .map(csvCell)
      .join(','),
  )
  for (const detail of result.details) {
    lines.push(
      [
        detail.dimensionValue,
        detail.baselineVersion,
        detail.comparisonVersion,
        detail.baselineValue ?? '',
        detail.comparisonValue ?? '',
        detail.baselineSample,
        detail.comparisonSample,
        `${detail.sampleSize}`,
        detail.diff ?? '',
        rateText(detail.diffRate),
        rateText(detail.threshold),
        detail.overThreshold ? '是' : '否',
        detail.inDetail ? '是' : '否',
        detail.lowSample ? `${detail.significanceMark}（样本不足，非稳定结论）` : detail.significanceMark,
        detail.note,
      ]
        .map(csvCell)
        .join(','),
    )
  }
  return {
    filename: `对比结果表-${result.planCode}-${result.resultVersion}.csv`,
    content: `\uFEFF${lines.join('\n')}`,
  }
}

export function downloadCompareResult(resultId: number): void {
  const { filename, content } = exportCompareResult(resultId)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function resetCompareWorkspace(): void {
  resetRows('compare')
  resetCompareDatasets()
  resetCompareResults()
}
