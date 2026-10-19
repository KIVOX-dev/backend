// Background job that sends notification emails (test assigned, drive
// assigned, round shortlisted), so the admin's request returns immediately
// instead of waiting on Brevo. One job = one scope:
//   { entityType, entityId, eventType, roundNumber }
//
// BullMQ on Redis (REDIS_URL). The worker runs either inside the API process
// (NOTIFICATION_WORKER_MODE=inprocess, local dev) or as its own process
// (`npm run worker`, production) — see src/worker.js.
//
// Without REDIS_URL there is no queue: outside tests, the send runs in-process
// right after the request instead. The rows are always recorded first, so a
// lost or failed job never loses a recipient — startWorker() re-enqueues any
// scope that still has queued rows.
const { Queue, Worker } = require('bullmq');
const env = require('../config/env');
const logger = require('../utils/logger');

const QUEUE_NAME = 'email-notifications';

let queue = null;
let worker = null;

function redisConnection() {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port) || 6379,
    username: u.username ? decodeURIComponent(u.username) : undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    db: u.pathname.length > 1 ? Number(u.pathname.slice(1)) : undefined,
    tls: u.protocol === 'rediss:' ? {} : undefined,
  };
}

function getQueue() {
  if (queue) return queue;
  const connection = redisConnection();
  if (!connection) return null;
  // Fail fast when Redis is down, so an assign request never hangs on enqueue.
  queue = new Queue(QUEUE_NAME, { connection: { ...connection, enableOfflineQueue: false } });
  queue.on('error', (err) => logger.warn('Notification queue error', { error: err.message }));
  return queue;
}

async function enqueue(scope) {
  if (env.nodeEnv === 'test') return false; // tests drive processScope() directly
  const q = getQueue();
  if (!q) {
    logger.warn('REDIS_URL unset — sending notification emails in-process', scope);
    global.setImmediate(() => {
      require('../services/emailNotification.service')
        .processScope(scope)
        .catch((err) => logger.error('In-process notification send failed', { ...scope, error: err.message }));
    });
    return true;
  }
  try {
    await q.add('send', scope, { removeOnComplete: true, removeOnFail: 100 });
    return true;
  } catch (err) {
    // Rows stay `queued`; the next worker start re-enqueues them.
    logger.error('Could not enqueue notification emails', { ...scope, error: err.message });
    return false;
  }
}

async function startWorker() {
  const connection = redisConnection();
  if (!connection) {
    logger.warn('Notification worker not started: REDIS_URL is unset');
    return null;
  }
  if (worker) return worker;
  const service = require('../services/emailNotification.service');

  worker = new Worker(QUEUE_NAME, (job) => service.processScope(job.data), {
    connection: { ...connection, maxRetriesPerRequest: null },
    // One job at a time: Brevo is rate limited, and a single worker draining a
    // scope's rows in order is what keeps the per-request pacing honest.
    concurrency: 1,
  });
  worker.on('failed', (job, err) => logger.error('Notification job failed', { ...job?.data, error: err.message }));
  worker.on('error', (err) => logger.warn('Notification worker error', { error: err.message }));
  logger.info('Notification worker started');

  // Pick up work whose job was lost (Redis outage, crash after insert).
  const repository = require('../repositories/emailNotification.repository');
  for (const scope of await repository.pendingScopes()) await enqueue(scope);
  return worker;
}

async function closeNotificationQueue() {
  await Promise.allSettled([worker?.close(), queue?.close()]);
  worker = null;
  queue = null;
}

module.exports = { enqueue, startWorker, closeNotificationQueue };
