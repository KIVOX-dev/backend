// Paid plans, priced in paise (INR). The server is the only place these amounts
// live: the browser sends a plan id, never an amount, so a price can't be
// changed from the client. Same prices for learners and HR.
const PLANS = Object.freeze({
  pro_6m: Object.freeze({ id: 'pro_6m', label: 'Pro, 6 months', months: 6, amountPaise: 11900 }),
  pro_12m: Object.freeze({ id: 'pro_12m', label: 'Pro, 12 months', months: 12, amountPaise: 21900 }),
});

const PLAN_IDS = Object.keys(PLANS);

// Razorpay rejects orders below 100 paise.
const MIN_AMOUNT_PAISE = 100;

module.exports = { PLANS, PLAN_IDS, MIN_AMOUNT_PAISE };
