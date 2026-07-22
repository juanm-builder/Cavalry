import { buildAdvisorTaskSpec, buildAdvisorTaskSpecV2 } from '../../domain/advisor/task-spec.js';

export function buildAdvisorPlannedTask({
  question,
  turn,
  previousState,
  dateScope,
  visibleRange,
  useV2 = true
} = {}) {
  return useV2
    ? buildAdvisorTaskSpecV2({ question, turn, previousState, dateScope, visibleRange })
    : buildAdvisorTaskSpec({ question, turn, previousState, dateScope, visibleRange });
}

export function getAdvisorReadySubtasks(taskSpec = {}) {
  return (Array.isArray(taskSpec.subtasks) ? taskSpec.subtasks : []).filter(
    (subtask) =>
      subtask &&
      (subtask.status === 'ready' || !subtask.dependsOn || subtask.dependsOn.length === 0)
  );
}

export function summarizeAdvisorTaskProgress(taskSpec = {}, completedSubtaskIds = []) {
  const completed = new Set(
    (Array.isArray(completedSubtaskIds) ? completedSubtaskIds : []).map((id) =>
      String(id || '').trim()
    )
  );
  const subtasks = Array.isArray(taskSpec.subtasks) ? taskSpec.subtasks : [];
  return {
    taskSpecId: String(
      taskSpec.id || taskSpec.taskSpecId || taskSpec.specVersion || taskSpec.spec_version || ''
    ),
    objective: String(taskSpec.objective || ''),
    completedSubtasks: subtasks
      .filter((subtask) => completed.has(String(subtask.id || '')))
      .map((subtask) => subtask.id),
    blockedSubtasks: subtasks
      .filter((subtask) => subtask.status === 'blocked')
      .map((subtask) => subtask.id),
    pendingQuestion:
      taskSpec.clarification && taskSpec.clarification.level === 'blocking'
        ? String(taskSpec.clarification.question || '')
        : ''
  };
}
