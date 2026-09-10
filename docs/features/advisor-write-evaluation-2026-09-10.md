# Advisor actions and reply presets — September 10, 2026

This extends the [conversation and memory evaluation](advisor-conversation-evaluation-2026-09-10.md).
The native tests use the configured `gpt-5.6-luna` model and synthetic workbook records through
Computer Use. The API key was not viewed. Automated capability checks exercise application rules;
they do not establish that every model will choose the right tool for every phrasing.

## Live failures that motivated the changes

| Request                                                                     | Observed behavior in the earlier build                                                                        | Correction                                                                                                                                                                               |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Create a named September budget line under Food, leaving other months alone | Invented a new category for the line name; failed a sheet/month lookup before retrying                        | Explain that the current budget editor supports one category plan; ask before creating an additional category. Use an explicit month, and never substitute a workbook title for a sheet. |
| Edit that September plan from PHP 3,000 to PHP 3,500                        | Tried the workbook title as a sheet, then recovered; the final answer repeated the failed attempt and success | Prefer verified sheet IDs or a concrete YYYY-MM month. Validate the month consistently across reads, writes, and removal.                                                                |
| Start a PHP 499 monthly subscription on October 5                           | September's list correctly excluded the future subscription                                                   | Retain this behavior and cover start dates, end dates, and rollover in schedule tests.                                                                                                   |
| Change only that October charge to PHP 599, with November onward PHP 499    | Recorded a future payment instead of changing the expected charge                                             | Add explicit month and future schedule edits; distinguish scheduled charges from recorded payments.                                                                                      |
| Review a destructive change                                                 | Repeated confirmation boilerplate, internal retry instructions, and technical receipt descriptions            | Show one concrete review card; keep routine activity in a closed Details disclosure.                                                                                                     |
| Save an advisor mutation                                                    | Chat said Saved while the top bar showed Unsaved changes                                                      | Applying an already persisted candidate must preserve the actual saved/cache status.                                                                                                     |

The incorrectly created PHP 599 payment was deleted through a reviewed confirmation. Synthetic trackers and budget records were retained during the follow-up native checks; their
cleanup is recorded below.

## Regression matrix

| Area                | Cases covered by the updated application checks                                                                                                                                                                                                                        |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reply style         | Brief, Balanced, Detailed; next-message application; persistence failure keeps the old selection; explicit detail requests override the default; saving style preserves provider credentials in fixture tests.                                                         |
| Budgets             | Explicit-month read/create/update/upsert/remove; missing or ambiguous month/category; contradictory ID/name and sheet/month; duplicate plans; stale deletion approval; zero/sub-cent/unsafe amounts; invalid dates and currency; unrelated months and notes unchanged. |
| Recurring schedules | Future first charge; one-time tracker; inclusive end; one-month amount change or skip; from-month changes supersede conflicting later fields; stale tracker/scope approvals; archive precedence; month-end boundaries; persistence and manual editing.                 |
| Confirmations       | Several proposed changes in one tool batch; approve one at a time; cancel remaining changes; chained approvals; no actionable approvals after reload; a new freeform message invalidates earlier pending changes.                                                      |
| Outcome honesty     | Application-owned saved/failed/proposed outcomes override model claims; save failures remain visible; a model narration failure cannot erase a completed change; readable account names in receipts.                                                                   |
| UI                  | Routine receipts collapsed; warnings visible; concise confirmation and historical proposal state; simple reply presets; memory file details collapsed; saved versus cached status retained; persisted update timestamps match manual edits.                            |

## Local model capacity

A source-only Vitest measurement of the normalized Chat Completions payload found 42 tools,
including clarification. Their schemas occupy about 42,300 characters; the persona and capability
instructions add about 12,500. An initial turn without conversation history is approximately
55,000 characters, or 60,000 with the maximum 4,500-character workspace snapshot. The same tool
catalog is supplied for a greeting, broad financial guidance, and a budget action.

Using Cavalry's conservative estimate of three characters per token plus 1,024 tokens reserved for
the reply, those fixed inputs alone need roughly 19,300–21,000 context tokens. A configured 32k
context is a practical baseline; 8k–16k cannot fit the current fixed catalog under that estimate,
even after dropping history. Tool outputs, memory, and longer conversations need additional space.
These are source measurements taken before the final prompt wording changes, not exact provider
token counts or a live local-model test. Tool routing or a smaller catalog was not added in this
pass. No local provider was exercised on this machine.

## Automated verification

The broad run passed 812 desktop unit tests, 326 renderer tests, 448 finance-core tests, and 319
Advisor tests (1,905 total). Subsequent targeted checks passed for confirmation-origin metadata,
persisted timestamps, the helper extraction, recurring schedule precedence, and stale subscription
approvals. These focused runs reuse many broad-suite cases; their counts must not be added to the
broad total as if every case were distinct.

Lint, formatting, type checks, and the architecture boundary verifier passed. The root architecture
test retained its existing failure: `TransactionRoute.jsx` has 1,134 lines against a 1,100-line limit.
A separate per-module scan also found the existing UI edits at 1,113 lines in `CategoryRoute.jsx`
and 1,107 lines in `SettingsRoute.jsx`; these pre-existing edits were preserved. The other 61 root
tests passed; no limit was relaxed. Oversized task-owned assistant helpers were extracted into
cohesive modules. The final per-module scan places runtime at 1,091 lines, references at 1,081,
and tool support at 1,039, with no task-owned renderer module above the limit.

## Native follow-up

The final host sidecar was rebuilt after all shared finance-core changes. The arm64 app built and
passed strict whole-bundle signature verification and an isolated bundled-host smoke test. It was
installed at `~/Applications/Cavalry for Mac.app`, verified again after copying, and launched
through Computer Use. The system `/Applications` copy remains the earlier build.
Later renderer-only rebuilds reused that verified host sidecar and passed strict whole-bundle
signature verification. These are locally signed development builds; they were not notarized or
distributed.

The native Preferences screen showed Brief selected by default, working Brief/Balanced/Detailed
controls, zero saved memory records, and collapsed Memory details. Selecting Detailed saved it and
updated the selection immediately. The blue, cream, and paper styling was preserved.

| Native check                                                    | Observed result                                                                                                                                                                                                                                                                           |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repeat the previously failing October-only edit                 | Updated the expected October charge to PHP 599 with a scoped saved receipt; no payment action appeared. The top bar retained Saved locally with the current save time.                                                                                                                    |
| Independent Bills-list verification                             | September excluded Advisor QA Stream; October displayed PHP 599 on October 5; November displayed the original PHP 499 on November 5.                                                                                                                                                      |
| Create current-month-only and next-month subscriptions together | September Only was created as One-time, due/end September 20 at PHP 199. Next Month was created Monthly, first due October 8 at PHP 149.                                                                                                                                                  |
| Independent visibility of the two new subscriptions             | September displayed only September Only; October and November displayed Next Month and excluded September Only.                                                                                                                                                                           |
| Future and one-month subscription edits                         | Stream changed to PHP 699 from November onward; September Only changed to PHP 249 for September only. Scoped saved receipts appeared and November’s actual list showed PHP 699.                                                                                                           |
| Two proposed removals, partial approval, then cancellation      | UI showed two remaining reviews. Confirm applied only the Stream November skip and removed its November row. Cancel cleared the Next Month removal; its PHP 149 November row remained. Cancellation correctly referred only to pending changes.                                           |
| Unsupported named budget line                                   | Explained that budgets belong to categories and asked before creating a separate Advisor QA Envelope category. No write occurred; the follow-up explicitly declined category creation.                                                                                                    |
| Month-specific budget edits and correction                      | September changed to PHP 3,600; October was added at PHP 4,000. A pending September removal was invalidated by “Actually, remove October instead.” Confirm removed only October. After restart the normal Budget page independently showed September PHP 3,600 and October no saved plan. |
| Relative date while viewing a different month                   | With the Bills page on November, “first charge on the 10th of next month” resolved to October 10, based on the current September date. November also moved to the 10th.                                                                                                                   |
| Final Brief reply                                               | After restart, a conversation-only business-cash constraint and unknown affordable savings amount produced a 48-word, two-sentence answer. It excluded business money and asked to determine personal surplus before selecting a contribution.                                            |
| Missing subscription details                                    | A name-only creation request asked for amount, category, first due date, and frequency. No tracker was created; the follow-up declined creation.                                                                                                                                          |
| Confirmed future-only removal                                   | Stopping Next Month from November onward removed its December row; the normal October Bills page still showed PHP 149 on October 10.                                                                                                                                                      |
| Manual editor preserves month exceptions                        | The editor showed the usual PHP 499 schedule and explained that specific-month changes stay in place. Saving a note retained October’s PHP 599 occurrence.                                                                                                                                |
| Repeated subscription creation                                  | Repeating Stream’s original name, monthly PHP 499, RCBC account and October 5 start recognized the existing tracker, did not create a duplicate, and explicitly preserved the PHP 599 October override.                                                                                   |

Two final native checks exposed read-side issues despite correct saved data. A mixed budget and
subscription request looked only in budgets and reported no saved plans for the subscriptions. A
single recurring read reported December's baseline PHP 499 even though the Bills page correctly
showed PHP 699 after a future schedule change and a November-only skip. The final follow-up addresses
entity resolution and supplies computed per-month occurrences instead of asking the model to apply
raw schedule patches. A named empty transaction search correctly found no payment, but a harmless
“nothing changed” read-only assurance was incorrectly treated as an unsupported financial claim;
that wording is included in the final regression checks.

### Final installed read regression

Repeating the exact mixed budget/subscription question in a fresh chat after the resolved-month
build produced all nine correct rows: Coffee September PHP 3,600 and October no saved plan;
Stream October PHP 599, November PHP 0/no charge, December PHP 699; September Only September
PHP 249 and October PHP 0; Next Month October PHP 149 on the 10th and November PHP 0 after the
confirmed future stop. These values agreed with the independent native Budget and Bills checks.
The final follow-up also tightens citation matching: an October no-plan row must not cite a September
plan, and the word September embedded in a subscription name must not add a generic budget source.

A read-only assurance now survives correctly as “I changed nothing during this read-only check.”
The exact no-payment phrasing “for the exact text” exposed another conservative wording mismatch
in empty-query grounding and is included in the final focused regression.

The last signed build was copied to the user Applications folder and strictly verified again. On
reopening the saved nine-row table, the October Coffee row no longer linked September's plan and
September Only rows retained only their subscription source. A fresh chat repeating the exact
payment question answered: “No payment is recorded for the exact text ‘Advisor QA Stream’ between
September 1 and November 30, 2026. I made no changes during this read-only check.” No fallback
verification warning appeared. Later focused suites covered the per-month read/citation integration,
ordinary scoped absence wording, wrong-month links, and embedded month-name links; these overlap
the broader suites and are not added to their total.

### Cleanup and remaining limits

Four reviewed changes were queued and approved one at a time: remove Coffee's September plan,
archive Stream, archive September Only, and archive Next Month. The unused Coffee category was
then deleted through its own review. The normal Bills page showed all three QA trackers under
Inactive, with Restore controls; the two original active items remained. September and October's
normal Budget pages showed no saved manual plan and only the original PHP 7,822.50 recurring
commitments. Searching Categories for Advisor QA returned zero visible categories. The synthetic
future payment had already been deleted and the final exact-name transaction search found none.
The archived trackers and test chat history remain available; this is not a claim of byte-for-byte
workbook restoration. No fake saved memories remain.

The model once asked an extra conversational confirmation before presenting the four cleanup
review cards; prompting it to prepare those cards produced the correct four-item queue. The action
boundary remained intact, but occasional redundant model wording is still possible. Only the
configured remote Luna model was exercised live; local-model capacity and the preserved UI file-size
failures remain the limits described above.

A final app restart preserved the archived trackers and removed September budget. The dashboard's
net worth and account balances matched the earlier baseline. Cavalry was left on the Dashboard with
a fresh conversation, Brief selected, both memory preferences enabled, zero saved memory records,
and Memory details collapsed. The configured API key was never viewed.
