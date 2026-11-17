<template>
  <section class="page" data-module="compare">
    <header class="page-head">
      <div>
        <h2>对比分析管理</h2>
        <p class="page-desc">读取基准与对照两期数据集，按对比维度和指标计算差额，生成可核对、可导出的对比结果表业务数据。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记对比方案</button>
        <button class="btn" type="button" @click="exportRows">导出对比分析清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <h3 class="section-title">对比方案</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
            <button class="link primary-link" type="button" @click="compute(row)">计算差异</button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无对比分析数据，可先登记对比方案</td>
        </tr>
      </tbody>
    </table>

    <h3 class="section-title">数据集登记（基准 / 对照两侧数据版本）</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th>数据集编号</th>
          <th>数据集名称</th>
          <th>期次</th>
          <th>对比维度</th>
          <th>对比指标</th>
          <th>数据版本</th>
          <th>建议显著性水平</th>
          <th>维度明细数</th>
          <th>样本总量</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="dataset in datasets" :key="dataset.code">
          <td>{{ dataset.code }}</td>
          <td>{{ dataset.name }}</td>
          <td>{{ dataset.periodLabel }}</td>
          <td>{{ dataset.dimension }}</td>
          <td>{{ dataset.metric }}</td>
          <td><strong>{{ dataset.version }}</strong></td>
          <td>{{ dataset.suggestedLevel ?? '—' }}</td>
          <td>{{ dataset.points.length }}</td>
          <td>{{ dataset.points.reduce((sum, point) => sum + point.sampleSize, 0) }}</td>
        </tr>
        <tr v-if="!datasets.length">
          <td colspan="9" class="empty-state">暂无可供对比的数据集登记</td>
        </tr>
      </tbody>
    </table>

    <h3 class="section-title">对比结果表业务数据</h3>
    <p v-if="!resultRows.length" class="empty-state result-empty">
      尚未生成对比结果：在上方对比方案点击「计算差异」，两侧数据集同时可读时才会发布完整对比结果表。
    </p>
    <table v-else class="data-table">
      <thead>
        <tr>
          <th>结果编号</th>
          <th>方案编号</th>
          <th>基准数据集 / 版本</th>
          <th>对照数据集 / 版本</th>
          <th>结果版本</th>
          <th>差异明细数</th>
          <th>待复核数</th>
          <th>显著性口径</th>
          <th>生成时间</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="result in resultRows" :key="result.id">
          <td>{{ result.id }}</td>
          <td>{{ result.planCode }}</td>
          <td>{{ result.baselineDataset }} / <strong>{{ result.baselineVersion }}</strong></td>
          <td>{{ result.comparisonDataset }} / <strong>{{ result.comparisonVersion }}</strong></td>
          <td><strong>{{ result.resultVersion }}</strong></td>
          <td>{{ result.detailCount }}</td>
          <td>
            <span :class="{ 'mark-review': result.reviewCount > 0 }">{{ result.reviewCount }}</span>
          </td>
          <td>{{ result.significanceLevel }}</td>
          <td>{{ formatTime(result.createdAt) }}</td>
          <td class="row-actions">
            <button class="link" type="button" @click="toggleDetail(result.id)">
              {{ selectedResultId === result.id ? '收起明细' : '差异明细核对' }}
            </button>
            <button class="link primary-link" type="button" @click="downloadResult(result.id)">
              导出文件
            </button>
          </td>
        </tr>
      </tbody>
    </table>

    <div v-if="selectedResult" class="detail-panel">
      <header class="detail-head">
        <div>
          <h4>{{ selectedResult.planCode }} 差异明细核对（{{ selectedResult.dimension }} / {{ selectedResult.metric }}）</h4>
          <p class="page-desc">
            基准版本 {{ selectedResult.baselineVersion }} 对照版本 {{ selectedResult.comparisonVersion }}
            · 结果版本 {{ selectedResult.resultVersion }}
            · 阈值 {{ rateText(selectedResult.threshold) }}
          </p>
          <p class="page-desc level-note">{{ selectedResult.levelNote }}</p>
        </div>
        <div class="view-switch" role="group">
          <button
            v-for="option in detailViewOptions"
            :key="option.value"
            type="button"
            class="btn"
            :class="{ primary: detailView === option.value }"
            @click="detailView = option.value"
          >
            {{ option.label }}
          </button>
        </div>
      </header>
      <table class="data-table detail-table">
        <thead>
          <tr>
            <th>维度取值</th>
            <th>基准版本</th>
            <th>对照版本</th>
            <th>基准指标值</th>
            <th>对照指标值</th>
            <th>基准样本</th>
            <th>对照样本</th>
            <th>样本依据</th>
            <th>差额</th>
            <th>差异率</th>
            <th>阈值</th>
            <th>超阈值</th>
            <th>差异明细</th>
            <th>显著性标记</th>
            <th>说明</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="detail in visibleDetails" :key="detail.dimensionValue">
            <td>{{ detail.dimensionValue }}</td>
            <td>{{ detail.baselineVersion }}</td>
            <td>{{ detail.comparisonVersion }}</td>
            <td>{{ detail.baselineValue ?? '—' }}</td>
            <td>{{ detail.comparisonValue ?? '—' }}</td>
            <td>{{ detail.baselineSample }}</td>
            <td>{{ detail.comparisonSample }}</td>
            <td>{{ detail.sampleSize }}</td>
            <td>{{ detail.diff ?? '—' }}</td>
            <td :class="{ 'cell-over': detail.overThreshold }">{{ rateText(detail.diffRate) }}</td>
            <td>{{ rateText(detail.threshold) }}</td>
            <td>{{ detail.overThreshold ? '是' : '否' }}</td>
            <td>{{ detail.inDetail ? '进入' : '—' }}</td>
            <td>
              <span class="mark" :class="markClass(detail.significanceMark)">{{ detail.significanceMark }}</span>
            </td>
            <td class="note-cell">{{ detail.note }}</td>
          </tr>
          <tr v-if="!visibleDetails.length">
            <td colspan="15" class="empty-state">当前视图下没有差异明细</td>
          </tr>
        </tbody>
      </table>
    </div>

    <footer class="page-foot">
      <span>共 {{ total }} 条对比方案 · 对比结果 {{ resultRows.length }} 份，数据保存在本机浏览器，切换视图后仍可追溯</span>
      <span v-if="feedback" :class="feedback.ok ? 'success-text' : 'error-text'">{{ feedback.text }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadCompareResult,
  downloadEntries,
  generateCompareResult,
  listDatasetsForCompare,
  listEntries,
  listResultsForCompare,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { CompareDatasetRegistration } from '@/data/compare-datasets'
import type { CompareResult, EntryRow } from '@/data/types'

const meta = moduleMeta('compare')
const columns = [
  '方案编号',
  '基准数据集',
  '对照数据集',
  '对比维度',
  '对比指标',
  '差异阈值',
  '显著性水平',
  '最小样本量',
  '输出展示',
]
const actions = ['提交校验', '启用方案', '停用方案']
const statuses = ['草稿', '待校验', '已启用', '已停用']
const detailViewOptions = [
  { label: '全量维度', value: 'all' },
  { label: '仅差异明细', value: 'detail' },
] as const

type DetailView = (typeof detailViewOptions)[number]['value']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const feedback = ref<{ ok: boolean; text: string } | null>(null)
const datasets = ref<CompareDatasetRegistration[]>([])
const resultRows = ref<CompareResult[]>([])
const selectedResultId = ref<number | null>(null)
const detailView = ref<DetailView>('all')

const stats = computed(() => [
  { label: '对比方案总数', value: rows.value.length },
  { label: '已启用方案', value: rows.value.filter((row) => String(row.status) === '已启用').length },
  { label: '对比结果表份数', value: resultRows.value.length },
  { label: '待复核差异明细', value: resultRows.value.reduce((sum, item) => sum + item.reviewCount, 0) },
])

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const selectedResult = computed(
  () => resultRows.value.find((item) => item.id === selectedResultId.value) ?? null,
)

const visibleDetails = computed(() => {
  if (!selectedResult.value) return []
  return detailView.value === 'detail'
    ? selectedResult.value.details.filter((detail) => detail.inDetail)
    : selectedResult.value.details
})

function rateText(rate: number | null): string {
  return rate === null ? '—' : `${(rate * 100).toFixed(2)}%`
}

function markClass(mark: string): string {
  if (mark === '待复核') return 'mark-review'
  if (mark === '显著') return 'mark-significant'
  return 'mark-plain'
}

function formatTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  feedback.value = { ok: false, text: '对比方案登记入口尚未接入审批流' }
}

function runAction(action: string, row: EntryRow) {
  feedback.value = null
  const result = applyAction(meta.key, Number(row.id), action)
  feedback.value = { ok: result.ok, text: result.message }
  if (result.ok) reload()
}

// 差异计算：单侧失败时服务层不会落任何对比结果表数据，这里只回显失败原因。
function compute(row: EntryRow) {
  feedback.value = null
  const outcome = generateCompareResult(Number(row.id))
  if (!outcome.ok) {
    feedback.value = { ok: false, text: outcome.message }
    reloadResults()
    return
  }
  feedback.value = { ok: true, text: outcome.message }
  reloadResults()
  selectedResultId.value = outcome.result.id
}

function toggleDetail(resultId: number) {
  selectedResultId.value = selectedResultId.value === resultId ? null : resultId
}

function downloadResult(resultId: number) {
  try {
    downloadCompareResult(resultId)
    feedback.value = { ok: true, text: '对比结果表业务数据已按同版本导出，文件内容与页面明细一致' }
  } catch (error) {
    feedback.value = {
      ok: false,
      text: error instanceof Error ? error.message : '对比结果导出失败',
    }
  }
}

function reload() {
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    feedback.value = {
      ok: false,
      text: error instanceof Error ? error.message : '对比分析列表读取失败',
    }
  }
}

function reloadResults() {
  resultRows.value = listResultsForCompare()
  if (selectedResultId.value !== null && !resultRows.value.some((item) => item.id === selectedResultId.value)) {
    selectedResultId.value = null
  }
}

onMounted(() => {
  datasets.value = listDatasetsForCompare()
  reload()
  reloadResults()
})
</script>

<style scoped>
.section-title {
  margin: 22px 0 8px;
  font-size: 15px;
}
.result-empty {
  padding: 14px;
  background: #fff;
  border: 1px dashed var(--border);
  border-radius: 8px;
}
.primary-link {
  font-weight: 600;
}
.detail-panel {
  margin-top: 14px;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px;
}
.detail-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 8px;
}
.detail-head h4 {
  margin: 0 0 4px;
}
.level-note {
  margin-top: 2px;
}
.view-switch {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}
.detail-table {
  font-size: 12px;
}
.detail-table th,
.detail-table td {
  padding: 6px 8px;
  white-space: nowrap;
}
.note-cell {
  white-space: normal;
  min-width: 220px;
}
.cell-over {
  color: #b42318;
  font-weight: 600;
}
.mark {
  display: inline-block;
  border-radius: 999px;
  padding: 2px 10px;
  font-size: 12px;
}
.mark-significant {
  background: #fee4e2;
  color: #b42318;
}
.mark-review {
  background: #fef0c7;
  color: #b54708;
  font-weight: 600;
}
.mark-plain {
  background: #eef2f7;
  color: var(--muted);
}
.success-text {
  color: #027a48;
}
</style>
