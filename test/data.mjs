// One fictional month of transactions, rendered in three statement layouts by make-samples.mjs.
export const OPENING = 2500.0;

export const TX = [
  ['2026-01-02', 'TESCO STORES 3412 LONDON', -45.2],
  ['2026-01-03', 'SALARY ACME LTD', 3200.0],
  ['2026-01-05', 'AMAZON MKTPLACE USD 25.00 RATE 1.08', -27.0],
  ['2026-01-06', 'CITY GYM MEMBERSHIP', -39.99],
  ['2026-01-08', 'ELECTRIC CO DIRECT DEBIT', -86.4],
  ['2026-01-09', 'CASH WITHDRAWAL ATM 0042', -100.0],
  ['2026-01-13', 'RENT STANDING ORDER', -1250.0],
  ['2026-01-15', 'COFFEE HOUSE', -3.75],
  ['2026-01-16', 'TRANSFER FROM SAVINGS', 400.0],
  ['2026-01-19', 'RAIL TICKETS ONLINE', -64.3],
  ['2026-01-20', 'REFUND SHOE SHOP', 59.99],
  ['2026-01-22', 'MOBILE PHONE BILL', -22.0],
  ['2026-01-23', 'GROCER MARKET 12 MARCH ST', -71.18],
  ['2026-01-26', 'STREAMING SUBSCRIPTION', -11.99],
  ['2026-01-28', 'INTEREST PAID', 1.12],
  ['2026-01-30', 'INSURANCE PREMIUM', -1048.5],
];

let bal = OPENING;
export const ROWS = TX.map(([date, description, amount]) => {
  bal = Math.round((bal + amount) * 100) / 100;
  return { date, description, amount, balance: bal };
});
