const authService = require('../services/authService');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');

const register = asyncHandler(async (req, res) => {
  const result = await authService.register(req.body);
  ApiResponse.created(res, result, 'Registration successful');
});

const login = asyncHandler(async (req, res) => {
  const result = await authService.login(req.body);
  ApiResponse.ok(res, result, 'Login successful');
});

const googleLogin = asyncHandler(async (req, res) => {
  const result = await authService.googleLogin(req.body.idToken);
  ApiResponse.ok(res, result, 'Login successful');
});

const refresh = asyncHandler(async (req, res) => {
  const result = await authService.refresh(req.body.refreshToken);
  ApiResponse.ok(res, result, 'Token refreshed');
});

const me = asyncHandler(async (req, res) => {
  const user = await authService.me(req.user.id);
  ApiResponse.ok(res, user);
});

module.exports = { register, login, googleLogin, refresh, me };
