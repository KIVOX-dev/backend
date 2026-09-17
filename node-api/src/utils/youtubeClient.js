const env = require('../config/env');
const logger = require('./logger');

const REQUEST_TIMEOUT_MS = 10000;
const API_BASE = 'https://www.googleapis.com/youtube/v3';
// youtube/v3 caps playlistItems/videos list calls at 50 ids/items per page —
// not configurable, a hard API limit.
const MAX_PAGE_SIZE = 50;

// Both "couldn't reach YouTube" and "YouTube rejected/couldn't find it" —
// course.service.js treats every failure the same way (surface a plain
// message to the import form), so one class is enough, same reasoning as
// GitHubOAuthError.
class YoutubeApiError extends Error {}

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal });
  } catch (err) {
    throw new YoutubeApiError(err.message);
  } finally {
    clearTimeout(timeout);
  }
}

async function apiGet(path, params) {
  if (!env.youtube.apiKey) {
    throw new YoutubeApiError('YouTube integration is not configured');
  }
  const url = new URL(`${API_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, value);
  }
  url.searchParams.set('key', env.youtube.apiKey);

  const response = await fetchWithTimeout(url.toString());
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) {
    const reason = data && data.error && data.error.message;
    logger.error('YouTube API request failed', { path, status: response.status, error: reason });
    throw new YoutubeApiError(reason || 'YouTube API request failed');
  }
  return data;
}

// Accepts a bare video/playlist id or any of YouTube's own URL shapes
// (watch?v=, youtu.be/, /playlist?list=, a video that's also inside a
// playlist via watch?v=X&list=Y — playlist wins there, matching what a user
// pasting a "play all" link from a playlist actually means).
function parseYoutubeInput(raw) {
  const trimmed = (raw || '').trim();
  if (!trimmed) throw new YoutubeApiError('Paste a YouTube video or playlist link');

  // Bare id, no URL at all — a playlist id always starts with "PL"/"UU"/"LL"/etc,
  // an 11-char video id never does, so length is enough to disambiguate.
  if (!/^https?:\/\//i.test(trimmed) && !trimmed.includes('/')) {
    return trimmed.length === 11 ? { type: 'video', id: trimmed } : { type: 'playlist', id: trimmed };
  }

  let url;
  try {
    url = new URL(trimmed);
  } catch {
    throw new YoutubeApiError("That doesn't look like a valid YouTube link");
  }
  if (!/(^|\.)youtube\.com$/i.test(url.hostname) && !/(^|\.)youtu\.be$/i.test(url.hostname)) {
    throw new YoutubeApiError('Only youtube.com / youtu.be links are supported');
  }

  const playlistId = url.searchParams.get('list');
  if (playlistId) return { type: 'playlist', id: playlistId };

  if (/(^|\.)youtu\.be$/i.test(url.hostname)) {
    const id = url.pathname.slice(1);
    if (id) return { type: 'video', id };
  }
  const videoId = url.searchParams.get('v');
  if (videoId) return { type: 'video', id: videoId };
  const shortsMatch = url.pathname.match(/^\/shorts\/([\w-]{11})/);
  if (shortsMatch) return { type: 'video', id: shortsMatch[1] };

  throw new YoutubeApiError("Couldn't find a video or playlist in that link");
}

// ISO 8601 duration (PT#H#M#S, as returned by videos.list's contentDetails)
// -> whole seconds. YouTube never emits fractional seconds here, and a video
// with 0 duration (a live stream still in progress) comes back as "P0D".
function parseIsoDuration(iso) {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso || '');
  if (!match) return 0;
  const [, h, m, s] = match;
  return (parseInt(h, 10) || 0) * 3600 + (parseInt(m, 10) || 0) * 60 + (parseInt(s, 10) || 0);
}

function bestThumbnail(thumbnails) {
  if (!thumbnails) return null;
  return (thumbnails.maxres || thumbnails.high || thumbnails.medium || thumbnails.default || {}).url || null;
}

// videos.list accepts up to 50 comma-separated ids per call — batches
// transparently so callers never have to think about the limit.
async function fetchVideosDetails(videoIds) {
  const results = [];
  for (let i = 0; i < videoIds.length; i += MAX_PAGE_SIZE) {
    const batch = videoIds.slice(i, i + MAX_PAGE_SIZE);
    const data = await apiGet('/videos', { part: 'snippet,contentDetails', id: batch.join(',') });
    for (const item of data.items || []) {
      results.push({
        youtubeVideoId: item.id,
        title: item.snippet.title,
        thumbnailUrl: bestThumbnail(item.snippet.thumbnails),
        durationSeconds: parseIsoDuration(item.contentDetails.duration),
      });
    }
  }
  // videos.list silently drops ids for deleted/private videos rather than
  // erroring — reorder+filter so the caller's lesson list only ever contains
  // videos that actually came back, in their original playlist order.
  const byId = new Map(results.map((v) => [v.youtubeVideoId, v]));
  return videoIds.map((id) => byId.get(id)).filter(Boolean);
}

async function fetchSingleVideo(videoId) {
  const [video] = await fetchVideosDetails([videoId]);
  if (!video) throw new YoutubeApiError('That video is unavailable, private, or has been removed');
  return video;
}

// playlistItems.list only gives id + title + thumbnail (no duration) — a
// second videos.list batch call fills in durationSeconds for every item.
async function fetchPlaylist(playlistId) {
  const playlistData = await apiGet('/playlists', { part: 'snippet', id: playlistId });
  const playlist = (playlistData.items || [])[0];
  if (!playlist) throw new YoutubeApiError('That playlist is unavailable, private, or has been removed');

  const items = [];
  let pageToken;
  do {
    const data = await apiGet('/playlistItems', {
      part: 'snippet',
      playlistId,
      maxResults: MAX_PAGE_SIZE,
      pageToken,
    });
    for (const item of data.items || []) {
      // A playlist can reference a video that's since been deleted/made
      // private — its snippet.title becomes the literal string "Deleted
      // video"/"Private video" with no real videoId to look up; skip those
      // rather than creating an unplayable lesson.
      const videoId = item.snippet?.resourceId?.videoId;
      if (videoId) items.push(videoId);
    }
    pageToken = data.nextPageToken;
  } while (pageToken);

  const videos = await fetchVideosDetails(items);
  return {
    title: playlist.snippet.title,
    thumbnailUrl: bestThumbnail(playlist.snippet.thumbnails),
    videos,
  };
}

module.exports = {
  parseYoutubeInput,
  fetchSingleVideo,
  fetchPlaylist,
  YoutubeApiError,
};
