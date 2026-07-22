function asString(value) {
  return String(value || '').trim();
}

function getPrimaryPacket(summary) {
  const packets = summary && summary.data_packets ? summary.data_packets : {};
  const keys = Object.keys(packets);
  return keys.length ? { kind: keys[0], packet: packets[keys[0]] } : { kind: '', packet: null };
}

function buildAction(id, label, icon, prompt, command = {}, metadata = {}) {
  return {
    id,
    type: 'advisor_command',
    label,
    icon,
    prompt,
    visual_kind: metadata.visual_kind || 'chip',
    safety_level: metadata.safety_level || 'read_only',
    creates_proposal: !!metadata.creates_proposal,
    requires_confirmation: !!metadata.requires_confirmation,
    result_behavior: metadata.result_behavior || '',
    command
  };
}

export function normalizeAdvisorCommandAction(action = {}) {
  const command = action.command && typeof action.command === 'object' ? action.command : {};
  return {
    id: asString(action.id),
    type: 'advisor_command',
    label: asString(action.label),
    icon: asString(action.icon || 'north_east'),
    prompt: asString(action.prompt),
    visual_kind: asString(action.visual_kind || action.visualKind || 'chip'),
    safety_level: asString(action.safety_level || action.safetyLevel || 'read_only'),
    creates_proposal: !!(action.creates_proposal || action.createsProposal),
    requires_confirmation: !!(action.requires_confirmation || action.requiresConfirmation),
    result_behavior: asString(action.result_behavior || action.resultBehavior),
    command: {
      intent: asString(command.intent),
      source_refs: Array.isArray(command.source_refs)
        ? command.source_refs.map(asString).filter(Boolean)
        : []
    }
  };
}

export function buildAdvisorReadOnlyActions({ turn, summary } = {}) {
  const targetIntent = asString(turn && turn.targetIntent);
  const primary = getPrimaryPacket(summary);
  const packet = primary.packet || {};
  const selection = packet.selection || {};
  const actions = [];

  if (targetIntent === 'spending_analysis') {
    actions.push(
      buildAction(
        'show_supporting_transactions',
        'Show supporting transactions',
        'receipt_long',
        'Show the transactions behind that spending analysis.',
        { intent: 'transaction_list', source_refs: [] }
      )
    );
    actions.push(
      buildAction(
        'review_category_assignments',
        'Review category assignments',
        'category',
        'Review category assignments for this same period.',
        { intent: 'categorization_review', source_refs: [] }
      )
    );
    actions.push(
      buildAction(
        'simulate_spending_reduction',
        'Run 10% reduction simulation',
        'calculate',
        'Run a 10% reduction simulation using confirmed consumption spending.',
        { intent: 'simulate_spending_change', source_refs: [] },
        { result_behavior: 'append_simulation' }
      )
    );
  } else if (targetIntent === 'transaction_list') {
    if (Number(selection.omitted_count || 0) > 0) {
      actions.push(
        buildAction(
          'show_full_transaction_list',
          'Show full list',
          'format_list_bulleted',
          'Show the full transaction list for this same period.',
          { intent: 'transaction_list', source_refs: [] }
        )
      );
      actions.push(
        buildAction(
          'show_next_page',
          'Show next page',
          'navigate_next',
          'Show the next page of transactions for this same period.',
          { intent: 'transaction_list', source_refs: [] }
        )
      );
    }
  } else if (targetIntent === 'categorization_review') {
    actions.push(
      buildAction(
        'prepare_category_cleanup_draft',
        'Prepare cleanup draft',
        'rule',
        'Create a cleanup draft for the category and label issues from this review.',
        { intent: 'ledger_cleanup', source_refs: [] },
        {
          safety_level: 'creates_proposal',
          creates_proposal: true,
          requires_confirmation: true,
          result_behavior: 'open_draft_review'
        }
      )
    );
    actions.push(
      buildAction(
        'compare_before_after_categories',
        'Compare before/after',
        'compare_arrows',
        'Compare current category totals with the proposed cleanup.',
        { intent: 'compare_before_after_categories', source_refs: [] },
        { result_behavior: 'open_comparison' }
      )
    );
  } else if (targetIntent === 'net_worth_impact_transactions') {
    actions.push(
      buildAction(
        'show_largest_impacts',
        'Show largest impacts',
        'query_stats',
        'Show the largest transactions that affected net worth in this period.',
        { intent: 'net_worth_impact_transactions', source_refs: [] }
      )
    );
    actions.push(
      buildAction(
        'show_excluded_neutral_transactions',
        'Show neutral transactions',
        'swap_horiz',
        'Show the transfers and neutral transactions excluded from net-worth impact.',
        { intent: 'transaction_list', source_refs: [] }
      )
    );
  }

  return actions
    .map(normalizeAdvisorCommandAction)
    .filter((action) => action.id && action.label && action.prompt);
}
