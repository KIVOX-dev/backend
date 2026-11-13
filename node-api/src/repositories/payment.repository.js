const BaseRepository = require('./BaseRepository');
const { tableName, columns, defaults } = require('../models/payment.model');

class PaymentRepository extends BaseRepository {
  constructor() {
    super(tableName, columns, { defaults });
  }
}

module.exports = new PaymentRepository();
