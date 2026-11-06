const { createHash } = require('node:crypto');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');

// Voice "slots" the client may ask for. The client never names a Google voice, rate or pitch, so
// it can't pick a pricier voice or abuse the key; everything below is decided server-side.
// Bot slots 0-3 map by index onto TTS_BOT_VOICES (WaveNet en-IN) and are differentiated by
// speaking rate (0.92-1.05) and pitch (-2..+2 semitones). The interviewer uses Chirp 3 HD, which
// does not support SSML or pitch, so it is sent as plain text at normal rate.
const BOT_PROFILES = [
  { rate: 1.05, pitch: -2 }, // 0 Dominator: fast, deep
  { rate: 1.0, pitch: 0 }, //   1 Fact Quoter: neutral
  { rate: 0.92, pitch: 2 }, //  2 Off-topic Drifter: slow, lighter
  { rate: 0.96, pitch: 1 }, //  3 Mediator: calm
];
const SLOTS = ['bot0', 'bot1', 'bot2', 'bot3', 'interviewer'];

const MAX_CHARS = 300; // bot/interviewer lines are 1-3 short sentences; keeps cost bounded
const MEM_MAX = 300;
const memCache = new Map(); // key -> Buffer (small LRU in front of the bucket)
let storage = null;

const escapeXml = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Short SSML: a small break between sentences, nothing else.
function toSsml(text) {
  const sentences = text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  return `<speak>${sentences.map(escapeXml).join('<break time="250ms"/>')}</speak>`;
}

function resolve(slot) {
  if (slot === 'interviewer') return { voice: env.tts.interviewerVoice, chirp: true, rate: 1.0, pitch: 0 };
  const i = Number(slot.slice(3));
  const voice = env.tts.botVoices[i % Math.max(env.tts.botVoices.length, 1)];
  return { voice, chirp: false, ...BOT_PROFILES[i] };
}

function cacheKey(cfg, text) {
  return createHash('sha256').update(JSON.stringify([cfg.voice, cfg.rate, cfg.pitch, text])).digest('hex');
}

function bucketFile(key) {
  if (!env.tts.cacheBucket) return null;
  if (!storage) {
    const { Storage } = require('@google-cloud/storage');
    storage = new Storage();
  }
  return storage.bucket(env.tts.cacheBucket).file(`tts/${key}.mp3`);
}

async function readBucket(key) {
  try {
    const file = bucketFile(key);
    if (!file) return null;
    const [exists] = await file.exists();
    return exists ? (await file.download())[0] : null;
  } catch (err) {
    logger.warn('TTS cache read failed', { error: err.message });
    return null; // a cache problem must never break speech
  }
}

async function writeBucket(key, buffer) {
  try {
    const file = bucketFile(key);
    if (file) await file.save(buffer, { contentType: 'audio/mpeg', resumable: false, metadata: { cacheControl: 'private, max-age=86400' } });
  } catch (err) {
    logger.warn('TTS cache write failed', { error: err.message });
  }
}

function remember(key, buffer) {
  if (memCache.size >= MEM_MAX) memCache.delete(memCache.keys().next().value);
  memCache.set(key, buffer);
}

async function synthesizeRemote(cfg, text) {
  const body = {
    input: cfg.chirp ? { text } : { ssml: toSsml(text) },
    voice: { languageCode: env.tts.languageCode, name: cfg.voice },
    audioConfig: { audioEncoding: 'MP3', speakingRate: cfg.rate, ...(cfg.chirp ? {} : { pitch: cfg.pitch }) },
  };
  let res;
  try {
    res = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
      method: 'POST',
      // Key in a header, not the URL, so it can't leak into request logs.
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': env.tts.apiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    logger.error('TTS request failed', { error: err.message });
    throw ApiError.serviceUnavailable('Voice is unavailable right now');
  }
  if (!res.ok) {
    logger.error('TTS API error', { status: res.status, voice: cfg.voice });
    throw ApiError.serviceUnavailable('Voice is unavailable right now');
  }
  const json = await res.json();
  return Buffer.from(json.audioContent, 'base64');
}

// Returns an MP3 Buffer. Order: memory -> bucket -> Google (then written back to both).
async function synthesize(slot, rawText) {
  if (!SLOTS.includes(slot)) throw ApiError.badRequest('Unknown voice');
  if (!env.tts.apiKey) throw ApiError.serviceUnavailable('Voice is not configured');
  const text = String(rawText || '').replace(/\s+/g, ' ').trim().slice(0, MAX_CHARS);
  if (!text) throw ApiError.badRequest('text is required');

  const cfg = resolve(slot);
  const key = cacheKey(cfg, text);
  const hit = memCache.get(key) || (await readBucket(key));
  if (hit) {
    remember(key, hit);
    return hit;
  }
  const audio = await synthesizeRemote(cfg, text);
  remember(key, audio);
  await writeBucket(key, audio);
  return audio;
}

module.exports = { synthesize, toSsml, SLOTS, MAX_CHARS };
