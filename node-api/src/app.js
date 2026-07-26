const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const morgan = require('morgan');

const env = require('./config/env');
const routes = require('./routes');
const { apiLimiter } = require('./middlewares/rateLimiter');
const { notFoundHandler, errorHandler } = require('./middlewares/errorHandler');
const logger = require('./utils/logger');

const app = express();

// Trust the first proxy hop (Cloud Run / load balancer) so req.ip and rate limiting
// see the real client IP instead of the proxy's.
app.set('trust proxy', 1);

app.use(helmet());
app.use(
  cors({
    origin(origin, callback) {
      // Allow same-origin/non-browser requests (no Origin header) and whitelisted frontends only.
      if (!origin || env.corsOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
  })
);
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(morgan(env.isProduction ? 'combined' : 'dev', { stream: { write: (msg) => logger.info(msg.trim()) } }));
app.use(apiLimiter);

app.get('/health', (req, res) => res.status(200).json({ status: 'ok', uptime: process.uptime() }));

// Serves uploaded profile photos/signatures (see src/middlewares/upload.js).
// Matches python-service's public /uploads/profile/<file> URL shape.
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

app.use(env.apiPrefix, routes);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
