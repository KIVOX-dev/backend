module.exports = {
  tableName: 'payments',
  columns: [
    'user_id', 'role', 'plan_id', 'amount', 'currency', 'receipt',
    'razorpay_order_id', 'razorpay_payment_id',
    'status', 'paid_at', 'plan_expires_at',
  ],
  defaults: { status: 'created', currency: 'INR' },
};
