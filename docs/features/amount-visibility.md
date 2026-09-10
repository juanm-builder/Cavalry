# Show / hide amounts

The eye button in the persistent workbook toolbar hides or shows financial
amounts throughout Cavalry. On narrow Mac windows the button keeps its icon and
accessible label while dropping its visible text.

- Hidden monetary values use `••••`, including zero and negative values.
- Dates, counts, percentages, account names, categories and chart shapes remain
  visible. Chart money labels, tooltips and accessibility labels are masked.
- Amounts in active input fields remain readable so edits can be checked.
- The setting is local to the device and survives app restarts. It is not part
  of the workbook and does not change calculations, exports or saved data.

`AmountVisibilityProvider` owns the device preference. Use `PrivateValue` for
read-only financial presentation, including rich text and accessible labels.
It renders the specified native element without adding a wrapper or leaving
the original amount in hidden DOM text. Use `amount` for a value that is known
to be monetary but does not contain a currency marker. Keep command payloads,
formatters and input values independent of visibility.

Regression coverage: `apps/desktop/tests/renderer/amount-visibility.interaction.test.jsx`.
