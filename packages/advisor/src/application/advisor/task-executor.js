import { runAdvisorToolCall } from './tools/registry.js';

const SUBTASK_TOOL_MAP = Object.freeze({
  review_transactions: ['list_transactions'],
  analyze_spending: ['summarize_spending', 'classify_cash_movements'],
  review_categorization: ['review_categorization'],
  simulate_change: ['simulate_spending_change'],
  propose_taxonomy: ['review_categorization'],
  prepare_category_drafts: ['review_categorization']
});

function asString(value) {
  return String(value || '').trim();
}

export function getAdvisorToolsForSubtask(subtask = {}) {
  return SUBTASK_TOOL_MAP[asString(subtask.kind)] || [];
}

export function runAdvisorReadySubtasks({ taskSpec, environment, maxToolCalls = 4 } = {}) {
  const subtasks = Array.isArray(taskSpec && taskSpec.subtasks) ? taskSpec.subtasks : [];
  const results = [];
  let count = 0;
  subtasks.forEach((subtask) => {
    if (count >= maxToolCalls || subtask.status === 'blocked') {
      return;
    }
    const tools = getAdvisorToolsForSubtask(subtask);
    tools.forEach((toolName) => {
      if (count >= maxToolCalls) {
        return;
      }
      count += 1;
      results.push(
        runAdvisorToolCall(
          {
            id: asString(subtask.id) + ':' + toolName,
            tool: toolName,
            arguments: {}
          },
          environment
        )
      );
    });
  });
  return {
    taskSpec,
    toolResults: results,
    completedSubtaskIds: subtasks
      .filter(
        (subtask) =>
          getAdvisorToolsForSubtask(subtask).length === 0 ||
          getAdvisorToolsForSubtask(subtask).some((toolName) =>
            results.some((result) => result.toolName === toolName && result.ok)
          )
      )
      .map((subtask) => subtask.id)
  };
}
