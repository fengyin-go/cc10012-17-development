import type { CompareDataset } from './types'

// 参与对比的数据集登记：每个数据集自带数据版本、维度/指标口径与逐维度样本量，
// 差异计算必须同时读到基准侧和对照侧才允许发布对比结果表。

export type CompareDatasetRegistration = CompareDataset & {
  periodLabel: string
}

const DATASET_STORAGE_KEY = 'data-explore-studio:compare-datasets'

// 两期区域销售额：COMP-0003 的核对场景。
// 华东差异率 +9% 超过 5% 阈值进入差异明细；西南/西北同样超阈值但样本量低于 30，保留并标待复核。
const SALES_BASELINE: CompareDatasetRegistration = {
  code: 'DS-BASE-SALES',
  name: '区域销售额-基准期',
  periodLabel: '2024年一期',
  dimension: '区域',
  metric: '销售额(万元)',
  version: 'v2024',
  suggestedLevel: '0.05',
  points: [
    { dimensionValue: '华东', value: 1200, sampleSize: 120, version: 'v2024' },
    { dimensionValue: '华北', value: 980, sampleSize: 96, version: 'v2024' },
    { dimensionValue: '华南', value: 860, sampleSize: 88, version: 'v2024' },
    { dimensionValue: '西南', value: 540, sampleSize: 28, version: 'v2024' },
    { dimensionValue: '西北', value: 320, sampleSize: 18, version: 'v2024' },
    { dimensionValue: '东北', value: 410, sampleSize: 45, version: 'v2024' },
  ],
}

const SALES_COMPARISON: CompareDatasetRegistration = {
  code: 'DS-COMP-SALES',
  name: '区域销售额-对照期',
  periodLabel: '2025年一期',
  dimension: '区域',
  metric: '销售额(万元)',
  version: 'v2025',
  suggestedLevel: '0.05',
  points: [
    { dimensionValue: '华东', value: 1308, sampleSize: 130, version: 'v2025' },
    { dimensionValue: '华北', value: 1009.4, sampleSize: 102, version: 'v2025' },
    { dimensionValue: '华南', value: 894.4, sampleSize: 90, version: 'v2025' },
    { dimensionValue: '西南', value: 575.1, sampleSize: 25, version: 'v2025' },
    { dimensionValue: '西北', value: 342.4, sampleSize: 16, version: 'v2025' },
    { dimensionValue: '东北', value: 418.2, sampleSize: 48, version: 'v2025' },
  ],
}

// 两期渠道订单量：两侧显著性水平口径不一致（0.05 vs 0.01），用于演示口径冲突从严取舍。
const ORDER_BASELINE: CompareDatasetRegistration = {
  code: 'DS-BASE-ORDER',
  name: '渠道订单量-基准期',
  periodLabel: '2024年四季度',
  dimension: '渠道',
  metric: '订单量(万单)',
  version: 'v2024Q4',
  suggestedLevel: '0.05',
  points: [
    { dimensionValue: '线上直营', value: 220, sampleSize: 60, version: 'v2024Q4' },
    { dimensionValue: '分销', value: 150, sampleSize: 42, version: 'v2024Q4' },
    { dimensionValue: '门店', value: 90, sampleSize: 35, version: 'v2024Q4' },
  ],
}

const ORDER_COMPARISON: CompareDatasetRegistration = {
  code: 'DS-COMP-ORDER',
  name: '渠道订单量-对照期',
  periodLabel: '2025年一季度',
  dimension: '渠道',
  metric: '订单量(万单)',
  version: 'v2025Q1',
  suggestedLevel: '0.01',
  points: [
    { dimensionValue: '线上直营', value: 242, sampleSize: 64, version: 'v2025Q1' },
    { dimensionValue: '分销', value: 153, sampleSize: 40, version: 'v2025Q1' },
    { dimensionValue: '门店', value: 84.6, sampleSize: 22, version: 'v2025Q1' },
  ],
}

export const SEED_DATASETS: CompareDatasetRegistration[] = [
  SALES_BASELINE,
  SALES_COMPARISON,
  ORDER_BASELINE,
  ORDER_COMPARISON,
]

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

let datasetCache: CompareDatasetRegistration[] | null = null

function readDatasets(): CompareDatasetRegistration[] {
  if (datasetCache) return datasetCache
  const fallback = clone(SEED_DATASETS)
  if (typeof window === 'undefined' || !window.localStorage) {
    datasetCache = fallback
    return fallback
  }
  const raw = window.localStorage.getItem(DATASET_STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(DATASET_STORAGE_KEY, JSON.stringify(fallback))
    datasetCache = fallback
    return fallback
  }
  try {
    datasetCache = JSON.parse(raw) as CompareDatasetRegistration[]
    return datasetCache
  } catch {
    window.localStorage.setItem(DATASET_STORAGE_KEY, JSON.stringify(fallback))
    datasetCache = fallback
    return fallback
  }
}

export function listCompareDatasets(): CompareDatasetRegistration[] {
  return readDatasets()
}

export function getCompareDataset(code: string): CompareDatasetRegistration | undefined {
  return readDatasets().find((item) => item.code === code)
}

export function resetCompareDatasets(): CompareDatasetRegistration[] {
  const fallback = clone(SEED_DATASETS)
  datasetCache = fallback
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(DATASET_STORAGE_KEY, JSON.stringify(fallback))
  }
  return fallback
}
