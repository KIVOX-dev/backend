const contactService = require('../services/contact.service');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');

const salesRequest = asyncHandler(async (req, res) => {
  const { name, organization, email, phone, product, message } = req.body;
  await contactService.submitSalesRequest({ name, organization, email, phone, product, message });
  ApiResponse.ok(res, null, 'Thanks — our team will reach out within 24 hours.');
});

module.exports = { salesRequest };
