# AI Companion capabilities

The in-app Cavalry Companion discovers feature-owned capability manifests at build time. A feature
that should be available to the model adds this exact file:

```text
apps/desktop/src/renderer/features/<feature>/cavalry-assistant-capability.js
```

The file default-exports a provider created with `defineCavalryAssistantCapability`. Vite eagerly
discovers these manifests, and the validating registry derives the model tool definitions, dispatch
table, confirmation metadata, runtime availability, and capability guidance from the same source.
Adding, changing, deprecating, or removing a feature capability therefore must not require a second
Companion catalog or a hand-maintained prompt list.

Discovery is intentionally opt-in. A product feature is not safe for Companion use until it provides
a bounded adapter that reuses the feature's normal command and validation boundary. The model can
request a capability, but application code resolves entities, validates arguments, asks for any
required confirmation, executes the handler, persists the result, and produces the result receipt.

## Provider and action contract

Each provider has a stable lowercase `id`, title, description, instructions, version, compatibility
metadata, and one or more actions. Each action keeps all of the following beside its executor:

| Contract field         | Purpose                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------ |
| `definition`           | Provider-facing function name, description, and JSON input schema.                   |
| `outputSchema`         | Application-facing structured result contract.                                       |
| `actionId` and `title` | Stable identity and user-facing action name.                                         |
| `access`               | Declares `read` or `write`; read actions cannot require confirmation.                |
| `entityRequirements`   | Names required entity types and roles and declares that ambiguity must be clarified. |
| `confirmation`         | Declares `none`, `conditional`, or `always`, with host-controlled approval fields.   |
| `requiresWorkbook`     | Makes workbook-independent actions, such as local memory operations, explicit.       |
| `atomicity`            | Documents the commit boundary a write action promises.                               |
| `idempotency`          | Documents the retry key or scope used to prevent duplicate mutations.                |
| `validate`             | Optional deterministic pre-execution validation.                                     |
| `execute`              | Required feature-owned handler that calls the normal application boundary.           |
| `present`              | Optional application-owned projection into a safe receipt.                           |
| `availability`         | Runtime predicate used to withhold an unavailable action from the model.             |
| `deprecated`           | Removes an action from discovery and execution while retaining migration metadata.   |
| `version`              | Action compatibility identifier, inherited from the provider when omitted.           |
| `compatibility`        | Optional minimum/maximum app versions and workbook-schema compatibility.             |

The registry rejects duplicate provider IDs, action IDs, or tool names; missing handlers; invalid
compatibility identifiers; malformed approval fields; undeclared host-controlled arguments; host
fields missing from the internal schema; and confirmation on a read-only action. Host-only fields
are removed from the model-facing schema. Declared approval booleans are forced to `false` unless the
execution context records explicit user approval. Canonical non-approval host fields, such as an
operation key or proposal fingerprint, are accepted only from an application-owned replay of the
preserved proposal; provider arguments cannot establish them. Dynamic definitions are revalidated
before exposure. An unavailable or deprecated action is excluded from the current tool list, and
direct execution fails closed.

The registry manifest exposes both the currently available tool names and complete action metadata.
This lets tests and application surfaces inspect availability and deprecation without asking the
model to infer support. Removal is performed by deleting the feature manifest entry; no central
assistant array should be left behind.

Core workspace actions are paired with their schemas and executors in one registry provider. Feature
actions such as transactions, budgets, and local memory live beside their owning implementations and
are auto-discovered. There is no separate schema array, handler map, confirmation-verb inventory, or
prompt catalog to keep synchronized. New actions and material changes belong in a provider contract,
and provider instructions are derived from registry metadata.

## Entity resolution and confirmation

An explicit account, card, budget, transaction, or other named entity must resolve to a canonical
application ID before mutation. Stable IDs are authoritative; normalized labels and aliases may help
find a candidate, but more than one valid candidate is an ambiguity, not permission to choose. The
action returns a clarification proposal that preserves candidate IDs and the user's intended role.

Write actions that require confirmation preserve their canonical proposal across the confirmation
round trip. The replay uses the proposal's IDs, operation key, and fingerprint instead of resolving
names again. Model-supplied values such as `confirmed`, duplicate allowance, or currency-conversion
allowance are never treated as user approval by themselves.

## Structured action results

Every action result is normalized before conversation code can describe it. The public lifecycle is
one of:

```text
requested -> proposed -> awaiting_confirmation -> attempted
          -> completed | cancelled | failed | rolled_back
```

The structured envelope includes `ok`, `status`, `changed`, lifecycle, commit status, verification
status, warnings, errors, and a safe action receipt. Receipts can identify the action, entity,
accounts, amount, currency, date, and persistence outcome. Internal stacks, raw payloads, command
output, and log paths are removed before receipt errors reach the renderer.

Conversation copy is derived from this receipt. A proposal is not described as completed, a
cancelled action says that no change was made, a rollback says the original was retained, and a
committed-but-unverified action is reported as saved but needing review. Model prose cannot promote
an attempted or failed action into a completed financial change.

For workbook writes, the Assistant uses the normal application command result and persistence
adapter. A changed candidate workbook is saved before the renderer swaps its current state. If save
fails, the original in-memory workbook remains current and the action cannot receive a committed
receipt. Once persistence succeeds, the change is durably `committed`. If post-save application and
reconciliation also succeed, it is `verified`; if that later reconciliation fails, Cavalry reports
`committed` and `unverified` (saved but needing review) rather than claiming that the durable change
rolled back.

## Adding or changing a capability

1. Reuse the owning feature's existing command, validation, and persistence boundary.
2. Define bounded input and output schemas using canonical finance concepts.
3. Declare entity roles, ambiguity behavior, access, confirmation, atomicity, idempotency,
   availability, version, and compatibility.
4. Return structured data and receipts; do not make provider prose the source of truth.
5. Add focused registry, handler, confirmation, rollback, retry, and presentation tests.
6. Verify that adding, deprecating, and removing the feature manifest changes the discovered catalog
   without editing Companion orchestration or prompt code.

Use finance-core's canonical types and calculations instead of copying them. Existing finance
semantics remain authoritative. In particular, reimbursements continue to use their established
income treatment and warning unless the event is explicitly a merchant refund; capability routing
and correction work does not silently reclassify them.

See [Companion trust architecture](companion-trust-architecture.md) for the streaming, persistence,
receipt, and local-memory boundaries that surround capability execution.
