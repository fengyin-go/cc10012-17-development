/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

// ===== 对比分析：两期数据、差异计算与对比结果表 =====

// 一侧数据集在某个维度取值上的聚合口径：指标值 + 样本量 + 数据版本
export type CompareMeasurePoint = {
  dimensionValue: string
  value: number
  sampleSize: number
  version: string
}

// 参与对比的一期数据集（基准期或对照期）
export type CompareDataset = {
  code: string
  name: string
  dimension: string
  metric: string
  version: string
  suggestedLevel?: string
  points: CompareMeasurePoint[]
}

// 对比结果表中的单条差异明细（全量维度都会保留，不满足阈值的行 inDetail=false）
export type CompareDetail = {
  dimensionValue: string
  baselineVersion: string
  comparisonVersion: string
  baselineValue: number | null
  comparisonValue: number | null
  baselineSample: number
  comparisonSample: number
  sampleSize: number
  diff: number | null
  diffRate: number | null
  threshold: number
  overThreshold: boolean
  inDetail: boolean
  lowSample: boolean
  significanceMark: string
  significanceLevel: string
  note: string
}

// 对比结果表业务数据：承载对比方案、两侧数据版本与完整差异明细
export type CompareResult = {
  id: number
  planId: number
  planCode: string
  baselineDataset: string
  comparisonDataset: string
  dimension: string
  metric: string
  threshold: number
  significanceLevel: string
  levelNote: string
  baselineVersion: string
  comparisonVersion: string
  resultVersion: string
  generatedFrom: string
  createdAt: string
  details: CompareDetail[]
  detailCount: number
  reviewCount: number
}
