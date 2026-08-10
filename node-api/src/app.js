const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const morgan = require('morgan');

const env = require('./config/env');
const routes = require('./routes');
const healthRoutes = require('./routes/health.routes');
const placementProofFilesRoutes = require('./routes/placementProofFiles.routes');
const { apiLimiter } = require('./middlewares/rateLimiter');
const { notFoundHandler, errorHandler } = require('./middlewares/errorHandler');
const requestId = require('./middlewares/requestId');
const requestLogger = require('./middlewares/requestLogger');
const logger = require('./utils/logger');

const app = express();

// Trust the first proxy hop (Cloud Run / load balancer) so req.ip and rate limiting
// see the real client IP instead of the proxy's.
app.set('trust proxy', 1);

app.use(requestId);
app.use(requestLogger);
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

// Registered *before* apiLimiter, deliberately: these are infrastructure
// probes (load balancer / orchestrator health checks), not attacker-facing
// API surface, and polling them every few seconds from a shared LB IP would
// otherwise burn through the same rate-limit budget as real traffic —
// caught by actually load-testing /health, which started returning 429
// under sustained request volume well below what a real liveness probe
// schedule would produce across several replicas.
app.get('/health', (req, res) => res.status(200).json({ status: 'ok', uptime: process.uptime() }));
app.use('/health', healthRoutes); // adds /health/live (alias), /health/ready, /health/metrics

app.use(apiLimiter);

// Serves uploaded profile photos/signatures (see src/middlewares/upload.js).
// Matches python-service's public /uploads/profile/<file> URL shape. Scoped
// to this one subdirectory (not the whole uploads/ root) specifically so it
// can never fall through to placement-proof/ — that one has its own
// signature-gated route below and must never be reachable as a plain static
// file, publicly, with no check at all (see routes/placementProofFiles.routes.js).
app.use('/uploads/profile', express.static(path.join(process.cwd(), 'uploads', 'profile')));
app.use('/uploads/placement-proof', placementProofFilesRoutes);

app.use(env.apiPrefix, routes);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
