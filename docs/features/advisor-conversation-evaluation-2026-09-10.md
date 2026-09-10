# Companion conversation evaluation — September 10, 2026

The native Cavalry for Mac app was exercised through Computer Use with synthetic financial data and
the existing provider configuration. The user identified the selected model as 5.6 Luna. Credentials
were left inside the app. These observations describe the installed app before the conversation and
memory changes in this evaluation; they are not a certification of every provider or a latency study.

## Initial native observations

| Observed behavior                                                                                                                                                                                     | Required behavior                                                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Reading memory while it was disabled appeared as a failed operation.                                                                                                                                  | Explain that memory is disabled as a normal availability state, without returning saved content or making the whole conversation look broken. |
| After memory was enabled, a naturally prefaced remember request did not call the save tool and claimed it could not save. A direct follow-up, “save those preferences,” succeeded after confirmation. | Recognize explicit remember intent within a normal conversational message and describe the actual save result.                                |
| In a new chat, general guidance missed the saved fictional name, goal, and distinction between company money and personal money.                                                                      | Retrieve applicable saved context for broad personal questions, including when the question does not repeat the record's keywords.            |
| The general response called net worth strong despite the saved context about business funds. An explicit Company Cash follow-up recalled that distinction.                                            | Separate workbook totals from personal spending capacity and use the saved ownership context without treating it as verified ledger evidence. |
| A correction preserved the compound memory record, but the confirmation showed only a raw UUID.                                                                                                       | Show the content and proposed correction in the confirmation so the user can review what will change.                                         |

The observed failures motivate a conversational check in addition to tool correctness tests. A
successful tool call alone does not establish that the advisor understood the user's intent, selected
the relevant context, or communicated a financial conclusion with the right qualifications.

## Validation scope

The baseline Advisor tests passed (318 tests), action-review tests passed (69 tests), and the renderer
Advisor certification passed (4 tests). The certification command uses controlled renderer fixtures;
it does not launch a native app or contact a live provider.

The initial whole-workspace test command stopped at an existing architecture limit: the unrelated
`TransactionRoute.jsx` working-tree file contained 1,134 lines against a 1,100-line maximum. The
architecture report itself found no workspace or renderer boundary violations. This limit must not be
reported as a passing full check or silently relaxed to certify conversation changes.

Repeat the [native conversation evaluation](advisor-acceptance.md#native-conversation-evaluation)
against the updated app and record the observed results separately. Local-model behavior remains
unverified until the same cases are exercised against an available local provider.

## Updated-source validation

After the memory retrieval, confirmation copy, conversation instructions, context budgeting, and
reference qualification changes were complete:

- All 733 desktop unit tests, 317 renderer interaction tests, and 318 Advisor tests passed.
- Formatting, lint, type checks, architecture boundary checks, and whitespace checks passed.
- The root architecture test still failed only on the unrelated 1,134-line transaction route noted
  above; the complete repository check is therefore not green.
- Production renderer and host builds, arm64 sidecar packaging, and the native app build passed.
- The app was signed for local development with the certificate matching the existing source
  provisioning profile. Deep, strict code-signature verification passed, including the resource seal.
  The helper had only the required JIT entitlements, and its smoke test passed against an isolated
  temporary profile.

This is a local development build, not a notarized release. A successful build and sidecar smoke test
do not substitute for the native conversation checks or prove local-model behavior.

The updated app was installed in the user's Applications directory and launched successfully through
Computer Use with the same configured workbook. The original system Applications installation was
left intact because its ownership prevented replacement. The configured API key was not viewed.
The final tested installation is `~/Applications/Cavalry for Mac.app`; opening the original
`/Applications/Cavalry for Mac.app` still opens the prior build.

## Updated native observations

The native UI showed `gpt-5.6-luna`. The following checks used fresh conversations where indicated:

| Check                                       | Observed result                                                                                                                                                                                                                                               |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Broad personalized priorities in a new chat | Used the fictional name Sam, the then-current PHP 250,000 emergency-fund goal, and the distinction between Company Cash and personal funds. The answer used three concise bullets and did not call net worth strong.                                          |
| Naturally prefaced explicit memory request  | “For this test, please remember that I like to review my budget on Sundays.” produced a readable confirmation on the first attempt, then a saved and verified result after approval.                                                                          |
| Correction and new-chat recall              | The PHP 250,000 goal was changed to PHP 300,000 with readable confirmation while preserving the other facts in the record. A fresh chat recalled the corrected goal, Sunday review preference, and business-funds distinction in the requested two sentences. |
| Missing data and bank-access limits         | Distinguished zero recorded transactions from proof of no spending and stated that workbook account information did not provide independent access to the actual bank. The two-sentence answer had no malformed dates or citation text.                       |
| Disabled memory in a new chat               | Explained the disabled state without exposing the fictional name, goal, Sunday preference, or business-funds memory. The read completed without a failed-operation banner.                                                                                    |
| Test cleanup                                | Exactly two synthetic records were removed through the UI. Settings showed zero saved records and zero freeform characters; memory and approved chat updates were enabled. The evaluation made no financial workbook changes.                                 |

A correction required a noticeably longer wait across provider and tool calls. The subsequent runtime
change returns an application-owned confirmation as soon as the tool batch completes, avoiding a
redundant provider request before showing that confirmation. Automated tests cover both provider
transports, cancellation, and valid confirmation detection. No controlled provider-latency benchmark
was performed.

The final rebuilt app also passed the native confirmation and cancellation check. A naturally
prefaced remember request showed readable confirmation, and Cancel returned “Cancelled. No changes
were made.” A new chat's settings still showed zero saved records and zero freeform characters, with
memory and approved chat updates enabled.

The final local build was left open on a blank conversation, with no synthetic test memories remaining.
Only the configured remote model was exercised live; local-model conversation quality remains
unverified.
