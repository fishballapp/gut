import { z } from 'zod';

export const RunRecordSchema = z.object({
  task: z.string(),
  variant: z.string(),
  rep: z.number(),
  success: z.boolean(),
  status: z.string(),
  reason: z.string().optional(),
  steps: z.object({
    count: z.number(),
    names: z.array(z.string()),
  }),
  usage: z
    .object({
      requests: z.number(),
      inputTokens: z.number(),
    })
    .optional(),
  wallClockMs: z.number(),
  claimedDone: z.boolean().optional(),
  firstRoundOpsSize: z.object({
    topLevel: z.number(),
    leaves: z.number(),
  }),
});

export type RunRecord = z.infer<typeof RunRecordSchema>;

export type TaskVariantSummary = {
  readonly task: string;
  readonly variant: string;
  readonly reps: number;
  readonly evalReps: number;
  readonly successCount: number;
  readonly successRate: number;
  readonly falseDone: number;
  readonly timeouts: number;
  readonly infra: number;
  readonly meanRequests: number;
  readonly meanInputTokens: number;
  readonly meanWallMs: number;
};

export type VariantSummary = {
  readonly variant: string;
  readonly totalRuns: number;
  readonly evalRuns: number;
  readonly successCount: number;
  readonly successRate: number;
  readonly falseDone: number;
  readonly timeouts: number;
  readonly infra: number;
  readonly meanRequests: number;
  readonly meanInputTokens: number;
  readonly meanWallMs: number;
};

export type BenchmarkAggregation = {
  readonly rows: readonly TaskVariantSummary[];
  readonly totals: readonly VariantSummary[];
};

export const aggregateBenchmarkResults = (records: readonly RunRecord[]): BenchmarkAggregation => {
  const taskVariantMap = new Map<string, RunRecord[]>();
  const variantMap = new Map<string, RunRecord[]>();

  for (const record of records) {
    const tvKey = `${record.task}__${record.variant}`;
    const existingTv = taskVariantMap.get(tvKey) ?? [];
    existingTv.push(record);
    taskVariantMap.set(tvKey, existingTv);

    const existingV = variantMap.get(record.variant) ?? [];
    existingV.push(record);
    variantMap.set(record.variant, existingV);
  }

  const rows: TaskVariantSummary[] = [];
  for (const group of taskVariantMap.values()) {
    const first = group[0];
    if (first === undefined) continue;

    const reps = group.length;
    const infra = group.filter(r => r.status === 'infra').length;
    const evalRuns = group.filter(r => r.status !== 'infra');
    const evalReps = evalRuns.length;
    const timeouts = evalRuns.filter(r => r.status === 'timeout').length;
    const falseDone = evalRuns.filter(r => r.claimedDone === true && !r.success).length;
    const nonTimeouts = evalRuns.filter(r => r.status !== 'timeout');
    const validCount = nonTimeouts.length;
    const successCount = evalRuns.filter(r => r.success).length;
    const successRate = evalReps > 0 ? (successCount / evalReps) * 100 : 0;
    const meanRequests =
      validCount > 0
        ? nonTimeouts.reduce((sum, r) => sum + (r.usage?.requests ?? 0), 0) / validCount
        : 0;
    const meanInputTokens =
      validCount > 0
        ? nonTimeouts.reduce((sum, r) => sum + (r.usage?.inputTokens ?? 0), 0) / validCount
        : 0;
    const meanWallMs =
      validCount > 0 ? nonTimeouts.reduce((sum, r) => sum + r.wallClockMs, 0) / validCount : 0;

    rows.push({
      task: first.task,
      variant: first.variant,
      reps,
      evalReps,
      successCount,
      successRate,
      falseDone,
      timeouts,
      infra,
      meanRequests,
      meanInputTokens,
      meanWallMs,
    });
  }

  const totals: VariantSummary[] = [];
  for (const [variant, group] of variantMap.entries()) {
    const totalRuns = group.length;
    const infra = group.filter(r => r.status === 'infra').length;
    const evalRuns = group.filter(r => r.status !== 'infra');
    const evalCount = evalRuns.length;
    const timeouts = evalRuns.filter(r => r.status === 'timeout').length;
    const falseDone = evalRuns.filter(r => r.claimedDone === true && !r.success).length;
    const nonTimeouts = evalRuns.filter(r => r.status !== 'timeout');
    const validCount = nonTimeouts.length;
    const successCount = evalRuns.filter(r => r.success).length;
    const successRate = evalCount > 0 ? (successCount / evalCount) * 100 : 0;
    const meanRequests =
      validCount > 0
        ? nonTimeouts.reduce((sum, r) => sum + (r.usage?.requests ?? 0), 0) / validCount
        : 0;
    const meanInputTokens =
      validCount > 0
        ? nonTimeouts.reduce((sum, r) => sum + (r.usage?.inputTokens ?? 0), 0) / validCount
        : 0;
    const meanWallMs =
      validCount > 0 ? nonTimeouts.reduce((sum, r) => sum + r.wallClockMs, 0) / validCount : 0;

    totals.push({
      variant,
      totalRuns,
      evalRuns: evalCount,
      successCount,
      successRate,
      falseDone,
      timeouts,
      infra,
      meanRequests,
      meanInputTokens,
      meanWallMs,
    });
  }

  return { rows, totals };
};

export const formatMarkdownTable = (aggregation: BenchmarkAggregation): string => {
  const header = [
    '| Task | Variant | Success Rate | False done | Timeouts | Infra | Mean Requests | Mean Input Tokens | Mean Wall (s) |',
    '| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |',
  ];

  const rowLines = aggregation.rows.map(row => {
    const rate = `${row.successRate.toFixed(0)}% (${row.successCount}/${row.evalReps})`;
    const requests = row.meanRequests.toFixed(1);
    const tokens = Math.round(row.meanInputTokens).toLocaleString();
    const wallSec = `${(row.meanWallMs / 1000).toFixed(1)}s`;
    return `| ${row.task} | ${row.variant} | ${rate} | ${row.falseDone} | ${row.timeouts} | ${row.infra} | ${requests} | ${tokens} | ${wallSec} |`;
  });

  const totalLines = aggregation.totals.map(total => {
    const rate = `${total.successRate.toFixed(0)}% (${total.successCount}/${total.evalRuns})`;
    const requests = total.meanRequests.toFixed(1);
    const tokens = Math.round(total.meanInputTokens).toLocaleString();
    const wallSec = `${(total.meanWallMs / 1000).toFixed(1)}s`;
    return `| **Total** | **${total.variant}** | **${rate}** | **${total.falseDone}** | **${total.timeouts}** | **${total.infra}** | **${requests}** | **${tokens}** | **${wallSec}** |`;
  });

  return [...header, ...rowLines, ...totalLines].join('\n');
};
