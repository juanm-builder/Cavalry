function asString(value) {
  return String(value || '').trim();
}

function normalizeStringArray(value) {
  return (Array.isArray(value) ? value : []).map((item) => asString(item)).filter(Boolean);
}

export function buildAdvisorDataPlan(turn = {}, route = {}) {
  const targetIntent = asString(turn.targetIntent || turn.intent);
  const taskSpec = turn.taskSpec || {};
  const routePacketKinds = normalizeStringArray(route.packetKinds);
  const dataNeeds = normalizeStringArray(taskSpec.dataNeeds || route.dataNeeds);
  const packetKinds = routePacketKinds.length
    ? routePacketKinds
    : normalizeStringArray(taskSpec.packetKinds);
  const maximumRows = Number.isFinite(Number(route.maximumRows))
    ? Math.max(0, Math.round(Number(route.maximumRows)))
    : targetIntent === 'transaction_list'
      ? 20
      : 12;
  return {
    schema_version: 'cavalry.advisor_data_plan.v1',
    intent: targetIntent,
    required_metrics: normalizeStringArray(route.requiredMetrics),
    data_needs: dataNeeds,
    packet_kinds: packetKinds,
    tool_names: normalizeStringArray(route.toolNames || route.tools),
    action_ids: normalizeStringArray(route.actionIds || route.actions),
    selection_policy: asString(route.selectionPolicy || 'task_specific_packet'),
    maximum_rows: maximumRows,
    include_source_refs: true
  };
}
