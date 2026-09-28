export function buildBillsOverview(rows, kind, formatMoney) {
  const totals = { scheduled: 0, recorded: 0, review: 0 };
  rows.forEach((row) => {
    if (row.baseAmountVerified === false || (kind !== 'all' && row.kind !== kind)) return;
    const amount = Number(row.amount) || 0;
    totals.scheduled += amount;
    if (row.status === 'Paid') totals.recorded += amount;
    if (row.status === 'Partial') {
      const remaining = Number(row.remainingAmount) || 0;
      totals.recorded += Math.max(0, amount - remaining);
      totals.review += remaining;
    } else if (['Overdue', 'Review match', 'Expected charge not recorded'].includes(row.status)) {
      totals.review += amount;
    }
  });
  return [
    { label: 'Scheduled', value: formatMoney(totals.scheduled) },
    { label: 'Recorded', value: formatMoney(totals.recorded) },
    { label: 'To review', value: formatMoney(totals.review) }
  ];
}
