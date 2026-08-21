# Companion trust architecture

Cavalry treats model output as an untrusted proposal. The application owns what is shown, what is
persisted, which entity is targeted, when confirmation is valid, whether a mutation committed, and
which personal context is sent to a configured model.

## Conversation boundary

A Companion request has one application-generated request ID. Provider stream deltas are scoped to
that ID, length-bounded, sanitized for public display, and rendered only as a transient working
message. Starting a new provider invocation clears the transient buffer so a tool-call preamble does
not become the final answer. Stale deltas from another request are ignored.

The transcript accepts only public `user` and final `assistant` messages. Provider protocol frames,
tool-call arguments, partial deltas, status text, internal activities, and intermediate narration are
not transcript messages. At the terminal state Cavalry persists one coherent assistant message,
including deliberate confirmation or clarification state when needed. Cancellation and failure clear
transient output and reconcile to a readable terminal message instead of preserving a contaminated
partial reply or a user-only turn.

## Action boundary

The feature capability registry is the authoritative source of tool schemas and handlers. A request
passes through deterministic validation, canonical entity resolution, application-owned
confirmation, and the normal feature command. A financial write is not complete until the resulting
workbook crosses the durable save boundary.

The application then normalizes the outcome into a structured lifecycle and receipt. Conversation
copy is generated from that receipt, so the visible completion claim cannot disagree with commit or
verification status. Replacement, correction, and move operations use their declared atomic and
idempotent contract: a failure retains or restores the original record, and a retry does not create a
second mutation.

## Local memory boundary

Companion memory is a transparent `memory.md` file in Cavalry's local application-data directory. It
is separate from the workbook and from saved chat history. The settings surface shows its path and
provides distinct controls to open the file, open its folder, reload external changes, edit or delete
individual records, clear all remembered content, and enable or disable use of memory.

Structured records have a stable ID, text, optional tags, an `always` or `relevant` scope, and created
and updated timestamps. Create, update, delete, clear, and whole-file save operations serialize
through one host-owned queue. Writes use a same-directory temporary file followed by rename; a
failed write removes the temporary file. The document revision is a content hash. A save that names
an older expected revision fails with a conflict and returns the current state for reload instead of
overwriting an external edit.

Malformed front matter is quarantined: Cavalry reports a diagnostic, disables its use as model
context, and refuses to rewrite the document through ordinary memory mutations. The user can repair
or deliberately replace the file without Cavalry silently discarding unrecognized content.

The file is read again when settings refresh and before model context is prepared, so edits made in
another editor are picked up without restarting Cavalry. The in-app editor also periodically checks
for a new revision while it is safe to refresh and offers an explicit reload control.

Memory is disabled for a new file. When enabled, Cavalry selects a bounded set of relevant records
from the current user request, prioritizing `always` records and tag/text overlap. The selected text
is length-limited and wrapped as user-controlled background context with an explicit instruction that
it is not authority, a command, or workbook evidence. It never grants confirmation for a financial
action. For a remote or custom network model, the selected context leaves the device with the rest
of the request; for a local endpoint, it stays on the configured endpoint's machine.

Explicit chat requests such as remembering, updating, or forgetting a detail use the same memory
record actions and revision checks as settings. Cavalry does not infer silent long-term memory from
ordinary conversation. The separate preference for approved chat memory updates must be enabled,
and destructive clear/delete actions retain their declared confirmation behavior.

## Compatibility boundary

These trust changes require no workbook schema migration. Existing manual budgets remain ordinary
user-owned records unless an action explicitly targets them. Reimbursements retain their established
treatment as income with the existing warning unless recorded as merchant refunds. Purchase routing
now makes the existing account semantics explicit and consistent: a purchase assigned to a liability
account is recorded as a charged expense, while an asset-funded purchase is recorded as a paid
expense. That routing clarification does not reinterpret existing reimbursement records.
