import { describe, expect, it } from 'vitest';
import {
  aggregateBenchmarkResults,
  formatMarkdownTable,
  type RunRecord,
  RunRecordSchema,
} from './table.ts';

describe('benchmark table aggregation', () => {
  it('aggregates task x variant records and formats markdown table', () => {
    const records: readonly RunRecord[] = [
      {
        task: 'docs-layout-a',
        variant: '26',
        rep: 1,
        success: true,
        status: 'achieved',
        claimedDone: true,
        steps: { count: 2, names: ['step1', 'step2'] },
        usage: { requests: 2, inputTokens: 4000 },
        wallClockMs: 3000,
        firstTickOpsSize: { topLevel: 10, leaves: 10 },
      },
      {
        task: 'docs-layout-a',
        variant: '26',
        rep: 2,
        success: false,
        status: 'achieved',
        claimedDone: true,
        reason: 'wrong page',
        steps: { count: 1, names: ['step1'] },
        usage: { requests: 3, inputTokens: 5000 },
        wallClockMs: 4000,
        firstTickOpsSize: { topLevel: 10, leaves: 10 },
      },
      {
        task: 'docs-layout-a',
        variant: '255',
        rep: 1,
        success: true,
        status: 'achieved',
        claimedDone: true,
        steps: { count: 2, names: ['step1', 'step2'] },
        usage: { requests: 2, inputTokens: 3500 },
        wallClockMs: 2500,
        firstTickOpsSize: { topLevel: 3, leaves: 10 },
      },
    ];

    const agg = aggregateBenchmarkResults(records);
    expect(agg.rows).toHaveLength(2);

    const row26 = agg.rows.find(r => r.task === 'docs-layout-a' && r.variant === '26');
    expect(row26).toBeDefined();
    expect(row26?.reps).toBe(2);
    expect(row26?.timeouts).toBe(0);
    expect(row26?.falseDone).toBe(1);
    expect(row26?.infra).toBe(0);
    expect(row26?.successCount).toBe(1);
    expect(row26?.successRate).toBe(50);
    expect(row26?.meanRequests).toBe(2.5);
    expect(row26?.meanInputTokens).toBe(4500);
    expect(row26?.meanWallMs).toBe(3500);

    const row255 = agg.rows.find(r => r.task === 'docs-layout-a' && r.variant === '255');
    expect(row255).toBeDefined();
    expect(row255?.reps).toBe(1);
    expect(row255?.timeouts).toBe(0);
    expect(row255?.falseDone).toBe(0);
    expect(row255?.infra).toBe(0);
    expect(row255?.successCount).toBe(1);
    expect(row255?.successRate).toBe(100);

    expect(agg.totals).toHaveLength(2);
    const total26 = agg.totals.find(t => t.variant === '26');
    expect(total26?.totalRuns).toBe(2);
    expect(total26?.timeouts).toBe(0);
    expect(total26?.falseDone).toBe(1);
    expect(total26?.infra).toBe(0);
    expect(total26?.successCount).toBe(1);

    const md = formatMarkdownTable(agg);
    expect(md).toContain(
      '| Task | Variant | Success Rate | False done | Timeouts | Infra | Mean Requests | Mean Input Tokens | Mean Wall (s) |',
    );
    expect(md).toContain('| docs-layout-a | 26 | 50% (1/2) | 1 | 0 | 0 | 2.5 | 4,500 | 3.5s |');
    expect(md).toContain('| docs-layout-a | 255 | 100% (1/1) | 0 | 0 | 0 | 2.0 | 3,500 | 2.5s |');
    expect(md).toContain(
      '| **Total** | **26** | **50% (1/2)** | **1** | **0** | **0** | **2.5** | **4,500** | **3.5s** |',
    );
  });

  it('excludes timeouts from request/token/time means and reports timeout counts', () => {
    const records: readonly RunRecord[] = [
      {
        task: 'docs-layout-a',
        variant: '26',
        rep: 1,
        success: true,
        status: 'achieved',
        claimedDone: true,
        steps: { count: 2, names: ['step1', 'step2'] },
        usage: { requests: 2, inputTokens: 4000 },
        wallClockMs: 3000,
        firstTickOpsSize: { topLevel: 10, leaves: 10 },
      },
      {
        task: 'docs-layout-a',
        variant: '26',
        rep: 2,
        success: false,
        status: 'timeout',
        reason: '3-minute hard wall timeout exceeded',
        steps: { count: 0, names: [] },
        wallClockMs: 180_000,
        firstTickOpsSize: { topLevel: 0, leaves: 0 },
      },
    ];

    const agg = aggregateBenchmarkResults(records);
    const row = agg.rows[0];
    expect(row).toBeDefined();
    expect(row?.reps).toBe(2);
    expect(row?.timeouts).toBe(1);
    expect(row?.falseDone).toBe(0);
    expect(row?.infra).toBe(0);
    expect(row?.successCount).toBe(1);
    expect(row?.meanRequests).toBe(2);
    expect(row?.meanInputTokens).toBe(4000);
    expect(row?.meanWallMs).toBe(3000);

    const total = agg.totals[0];
    expect(total?.timeouts).toBe(1);
    expect(total?.falseDone).toBe(0);
    expect(total?.infra).toBe(0);
    expect(total?.meanRequests).toBe(2);
    expect(total?.meanInputTokens).toBe(4000);
    expect(total?.meanWallMs).toBe(3000);

    const md = formatMarkdownTable(agg);
    expect(md).toContain(
      '| Task | Variant | Success Rate | False done | Timeouts | Infra | Mean Requests | Mean Input Tokens | Mean Wall (s) |',
    );
    expect(md).toContain('| docs-layout-a | 26 | 50% (1/2) | 0 | 1 | 0 | 2.0 | 4,000 | 3.0s |');
    expect(md).toContain(
      '| **Total** | **26** | **50% (1/2)** | **0** | **1** | **0** | **2.0** | **4,000** | **3.0s** |',
    );
  });

  it('excludes infra records from success rate and means, reporting them in Infra column', () => {
    const records: readonly RunRecord[] = [
      {
        task: 'docs-layout-a',
        variant: 'ultrafast',
        rep: 1,
        success: true,
        status: 'done',
        claimedDone: true,
        steps: { count: 3, names: ['click', 'click', 'done'] },
        usage: { requests: 3, inputTokens: 6000 },
        wallClockMs: 5000,
        firstTickOpsSize: { topLevel: 0, leaves: 0 },
      },
      {
        task: 'docs-layout-a',
        variant: 'ultrafast',
        rep: 2,
        success: false,
        status: 'infra',
        reason: 'harness timeout (_IPCResponseTimeout)',
        steps: { count: 0, names: [] },
        usage: { requests: 0, inputTokens: 0 },
        wallClockMs: 12000,
        firstTickOpsSize: { topLevel: 0, leaves: 0 },
      },
    ];

    const agg = aggregateBenchmarkResults(records);
    const row = agg.rows[0];
    expect(row).toBeDefined();
    expect(row?.reps).toBe(2);
    expect(row?.evalReps).toBe(1);
    expect(row?.infra).toBe(1);
    expect(row?.successCount).toBe(1);
    expect(row?.successRate).toBe(100);
    expect(row?.meanRequests).toBe(3);
    expect(row?.meanInputTokens).toBe(6000);
    expect(row?.meanWallMs).toBe(5000);

    const md = formatMarkdownTable(agg);
    expect(md).toContain(
      '| docs-layout-a | ultrafast | 100% (1/1) | 0 | 0 | 1 | 3.0 | 6,000 | 5.0s |',
    );
    expect(md).toContain(
      '| **Total** | **ultrafast** | **100% (1/1)** | **0** | **0** | **1** | **3.0** | **6,000** | **5.0s** |',
    );
  });
  it('validates RunRecordSchema and rejects malformed records', () => {
    const valid = {
      task: 'task1',
      variant: '255',
      rep: 1,
      success: true,
      status: 'achieved',
      steps: { count: 1, names: ['click'] },
      wallClockMs: 1200,
      firstTickOpsSize: { topLevel: 1, leaves: 1 },
    };
    expect(RunRecordSchema.safeParse(valid).success).toBe(true);

    const invalid = {
      task: 'task1',
      rep: 'not-a-number',
    };
    expect(RunRecordSchema.safeParse(invalid).success).toBe(false);
  });
});
