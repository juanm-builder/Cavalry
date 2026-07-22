# Cavalry Action Plan

`CavalryActionPlan` is the shared JSON format used by the ChatGPT-facing API and the manual import path.

The parser is forgiving at the boundary: it accepts raw JSON, Markdown code blocks, and safe aliases such as `add_transaction`. The normalized plan is strict and only supports these v1 actions:

- `create_transaction`
- `create_transaction_batch`
- `create_recurring_item`
- `update_category_assignment`
- `update_budget`

Direct mutation actions such as apply, post, delete, archive, account creation, and workbook updates are rejected. They do not become workbook changes.

Minimum example:

```json
{
  "cavalry_action_plan_version": "1.0",
  "source": "chatgpt",
  "date_default": "2026-06-27",
  "currency_default": "PHP",
  "actions": [
    {
      "type": "create_transaction",
      "description": "OpenAI API credits",
      "amount": 15,
      "currency": "USD",
      "direction": "expense",
      "payment_account_hint": "Credit Card",
      "category_hint": "Software"
    }
  ]
}
```

Validation rules:

- Amounts must be positive for transactions and budgets.
- Dates must be valid `YYYY-MM-DD` values.
- Currency falls back to `currency_default` or the workbook currency when safe.
- Account/category hints never create accounts or categories silently.
- Ambiguous accounts/categories become reviewable draft issues.
- Possible duplicates are warnings and require review.
- Unsupported direct mutation requests are blocked.

Versioning policy: v1 remains backward compatible. New actions should be added as optional v1 capabilities only when older clients can safely ignore or reject them.
