import { describe, expect, it, vi } from 'vitest';
import { makeBasicSpendingWorkbook } from '@cavalry/finance-core/test-fixtures/core-workbook-fixtures.js';
import {
  executeCavalryAssistantTool,
  getCavalryAssistantToolDefinitions
} from '../../src/renderer/features/assistant/cavalry-assistant-tools.js';

function harness() {
  let workbook = structuredClone(makeBasicSpendingWorkbook());
  workbook.recurringItems = [
    {
      id: 'reviewed-streaming',
      name: 'Streaming',
      kind: 'subscription',
      categoryId: 'subscriptions',
      accountId: 'bank',
      amount: 500,
      currency: 'PHP',
      frequency: 'Monthly',
      anchorDate: '2026-09-15',
      autoRenew: true,
      isActive: true
    }
  ];
  const commit = vi.fn((result) => {
    workbook = result.workbook;
    return {
      ...result,
      commitStatus: 'committed',
      verificationStatus: 'verified',
      persistence: { status: 'saved', durable: true }
    };
  });
  return {
    get workbook() {
      return workbook;
    },
    commit,
    call(name, args, approved = false) {
      return executeCavalryAssistantTool(
        { name, arguments: args },
        {
          getWorkbook: () => workbook,
          commitCommandResult: commit,
          approvedByUser: approved,
          services: { defaultDate: () => '2026-09-10', createId: () => 'synthetic-id' }
        }
      );
    }
  };
}

for (const toolName of ['archive_bill', 'update_bill']) {
  describe(`${toolName} reviewed tracker protection`, () => {
    const args = {
      recurringItemId: 'reviewed-streaming',
      scope: 'month',
      monthKey: '2026-10',
      ...(toolName === 'update_bill' ? { isActive: false } : {})
    };
    it.each(['amount', 'schedule', 'workbook', 'scope'])(
      'rejects stale confirmation after %s changes without altering any data',
      async (change) => {
        const h = harness();
        const proposal = await h.call(toolName, args);
        expect(proposal.status).toBe('confirmation_required');
        const replay = { ...proposal.confirmation.proposal.arguments, confirmed: true };
        if (change === 'amount') h.workbook.recurringItems[0].amount = 700;
        if (change === 'schedule')
          h.workbook.recurringItems[0].monthOverrides = {
            '2026-10': { amount: 800, anchorDate: '2026-10-20' }
          };
        if (change === 'workbook') h.workbook.id = 'different-workbook';
        if (change === 'scope') replay.monthKey = '2026-11';
        const before = structuredClone(h.workbook);
        expect(await h.call(toolName, replay, true)).toMatchObject({
          ok: false,
          changed: false,
          status: 'conflict',
          errors: [{ code: 'confirmation_target_changed' }]
        });
        expect(h.workbook).toEqual(before);
        expect(h.commit).not.toHaveBeenCalled();
      }
    );

    it('requires a host-captured snapshot even with approval and hides it from model schemas', async () => {
      const h = harness();
      expect(await h.call(toolName, { ...args, confirmed: true }, true)).toMatchObject({
        ok: false,
        changed: false,
        status: 'confirmation_required'
      });
      const definition = getCavalryAssistantToolDefinitions().find(
        (entry) => entry.name === toolName
      );
      expect(definition.parameters.properties).not.toHaveProperty('expectedTargetState');
      expect(h.commit).not.toHaveBeenCalled();
    });
  });
}
