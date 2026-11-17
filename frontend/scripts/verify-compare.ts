/* 对比分析差异计算的规则验证：不依赖浏览器，用 Node 直接跑数据层与本地服务。 */
import assert from 'node:assert/strict'

import { computeCompareResult, parseThreshold } from '../src/data/compare-engine'
import { SEED_DATASETS } from '../src/data/compare-datasets'
import {
  exportCompareResult,
  generateCompareResult,
  listResultsForCompare,
} from '../src/api/local-service'
import { listRows } from '../src/data/local-store'
import { upsertCompareResult } from '../src/data/compare-results'
import type { EntryRow } from '../src/data/types'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed += 1
  console.log(`✓ ${name}`)
}

const plans = listRows('compare')
const planByCode = (code: string): EntryRow => {
  const plan = plans.find((row) => row['方案编号'] === code)
  assert.ok(plan, `缺少方案 ${code}`)
  return plan
}
const datasetByCode = (code: string) => {
  const dataset = SEED_DATASETS.find((item) => item.code === code)
  assert.ok(dataset, `缺少数据集 ${code}`)
  return dataset
}

// 1. 阈值解析
check('阈值解析：5% / 0.05 / 5 统一为 0.05', () => {
  assert.equal(parseThreshold('5%'), 0.05)
  assert.equal(parseThreshold('0.05'), 0.05)
  assert.equal(parseThreshold('5'), 0.05)
})

// 2. COMP-0003：区域销售额两期对比
const salesPlan = planByCode('COMP-0003')
const salesOutcome = computeCompareResult({
  plan: salesPlan,
  baseline: datasetByCode('DS-BASE-SALES'),
  comparison: datasetByCode('DS-COMP-SALES'),
  minSample: 30,
})
assert.ok(salesOutcome.ok, 'COMP-0003 计算应当成功')
if (salesOutcome.ok) {
  const result = salesOutcome.result
  const byRegion = new Map(result.details.map((item) => [item.dimensionValue, item]))

  check('COMP-0003 全量 6 个区域都保留，没有静默丢弃', () => {
    assert.equal(result.details.length, 6)
  })

  check('COMP-0003 华东差异率 9% 超过 5%，进入差异明细且标记显著', () => {
    const east = byRegion.get('华东')!
    assert.equal(east.diff, 108)
    assert.equal(east.diffRate, 0.09)
    assert.equal(east.overThreshold, true)
    assert.equal(east.inDetail, true)
    assert.equal(east.lowSample, false)
    assert.equal(east.significanceMark, '显著')
  })

  check('COMP-0003 华北差异率 3% 未超阈值，不进入差异明细', () => {
    const north = byRegion.get('华北')!
    assert.equal(north.overThreshold, false)
    assert.equal(north.inDetail, false)
    assert.equal(north.significanceMark, '不显著')
  })

  check('COMP-0003 西南/西北超阈值但样本不足，保留并带待复核标记', () => {
    for (const region of ['西南', '西北']) {
      const item = byRegion.get(region)!
      assert.equal(item.inDetail, true, `${region} 应进入差异明细`)
      assert.equal(item.lowSample, true, `${region} 应识别为低样本`)
      assert.equal(item.significanceMark, '待复核')
      assert.ok(item.note.includes('不作为稳定结论'))
      assert.ok(item.baselineSample > 0 && item.comparisonSample > 0, '样本依据必须保留')
    }
    assert.equal(result.detailCount, 3)
    assert.equal(result.reviewCount, 2)
  })

  check('两侧数据版本与结果版本同时可见、可追溯', () => {
    assert.equal(result.baselineVersion, 'v2024')
    assert.equal(result.comparisonVersion, 'v2025')
    assert.equal(result.resultVersion, 'R[v2024~v2025]')
    for (const detail of result.details) {
      assert.equal(detail.baselineVersion, 'v2024')
      assert.equal(detail.comparisonVersion, 'v2025')
    }
  })
}

// 3. 口径冲突：显著性水平 0.05 vs 0.01，从严取 0.01
const orderPlan = planByCode('COMP-0002')
const orderOutcome = computeCompareResult({
  plan: orderPlan,
  baseline: datasetByCode('DS-BASE-ORDER'),
  comparison: datasetByCode('DS-COMP-ORDER'),
  minSample: 30,
})
assert.ok(orderOutcome.ok)
if (orderOutcome.ok) {
  check('口径冲突时取更严格显著性水平并记录取舍说明', () => {
    assert.equal(orderOutcome.result.significanceLevel, '0.01')
    assert.ok(orderOutcome.result.levelNote.includes('冲突'))
    assert.ok(orderOutcome.result.levelNote.includes('0.01'))
  })
  check('门店低样本差异同样保留为待复核', () => {
    const store = orderOutcome.result.details.find((item) => item.dimensionValue === '门店')!
    assert.equal(store.inDetail, true)
    assert.equal(store.significanceMark, '待复核')
  })
}

// 4. 引擎单侧失败场景
check('维度不一致时整体计算失败', () => {
  const fail = computeCompareResult({
    plan: salesPlan,
    baseline: datasetByCode('DS-BASE-SALES'),
    comparison: { ...datasetByCode('DS-COMP-ORDER'), suggestedLevel: '0.05' },
    minSample: 30,
  })
  assert.equal(fail.ok, false)
})
check('单侧明细为空时整体计算失败，不产出半张表', () => {
  const fail = computeCompareResult({
    plan: salesPlan,
    baseline: { ...datasetByCode('DS-BASE-SALES'), points: [] },
    comparison: datasetByCode('DS-COMP-SALES'),
    minSample: 30,
  })
  assert.equal(fail.ok, false)
})

// 5. 本地服务：单侧失败不发布、重复提交一份、重算整维度替换
check('COMP-0001 对照数据集未登记：差异计算失败且对比结果表为空', () => {
  const before = listResultsForCompare().length
  const fail = generateCompareResult(Number(planByCode('COMP-0001').id))
  assert.equal(fail.ok, false)
  assert.ok(fail.ok === false && fail.message.includes('中止发布'))
  assert.equal(listResultsForCompare().length, before)
})

check('COMP-0003 重复提交只写入一份对比结果表业务数据', () => {
  const first = generateCompareResult(Number(salesPlan.id))
  assert.equal(first.ok, true)
  const second = generateCompareResult(Number(salesPlan.id))
  assert.equal(second.ok, true)
  assert.equal(second.reused, true)
  const mine = listResultsForCompare().filter((item) => item.planId === Number(salesPlan.id))
  assert.equal(mine.length, 1)
})

check('重算只替换完整维度：版本变化后仍是一份结果且明细全量重算', () => {
  const current = listResultsForCompare().find((item) => item.planId === Number(salesPlan.id))!
  const replaced = upsertCompareResult({
    ...current,
    comparisonVersion: 'v2026',
    resultVersion: 'R[v2024~v2026]',
    details: current.details.map((detail) => ({ ...detail, comparisonVersion: 'v2026' })),
  })
  assert.equal(replaced.reused, false)
  const mine = listResultsForCompare().filter((item) => item.planId === Number(salesPlan.id))
  assert.equal(mine.length, 1)
  assert.equal(mine[0].resultVersion, 'R[v2024~v2026]')
  assert.equal(mine[0].details.length, 6)
  // 还原，便于后续导出断言
  generateCompareResult(Number(salesPlan.id))
})

// 6. 导出与页面明细一致、同版本文件、低样本不当稳定结论
check('导出文件与页面明细一致且为同版本文件，低样本差异带待复核提示', () => {
  const result = listResultsForCompare().find((item) => item.planId === Number(salesPlan.id))!
  const file = exportCompareResult(result.id)
  assert.ok(file.filename.includes(result.resultVersion), '文件名必须带结果版本')
  assert.ok(file.content.includes('华东'))
  const lines = file.content.split('\n')
  assert.equal(
    lines.filter((line) => line.includes('华东') || line.includes('华北') || line.includes('西南')).length,
    3,
    '页面保留的维度都必须出现在导出文件里',
  )
  const southwestLine = lines.find((line) => line.startsWith('西南,'))!
  assert.ok(southwestLine.includes('待复核（样本不足，非稳定结论）'))
  const eastLine = lines.find((line) => line.startsWith('华东,'))!
  assert.ok(eastLine.includes(',显著,'))
  assert.ok(file.content.includes(`结果版本,${result.resultVersion}`))
})

console.log(`\n全部 ${passed} 项规则验证通过`)
