module.exports = {
  tableName: 'roadmap_skill_caches',
  columns: [
    // One row per skillCatalog.js skill name — NOT per role and NOT per
    // student. A search.list call costs 100 YouTube quota units against a
    // 10k/day default; keying by skill alone means every role that shares a
    // skill (and every student who views it) reuses the same fetched playlists
    // instead of re-spending quota. See roadmap.service.js#getRoadmap.
    'skill_name',
    // Suggested playlists (youtubeClient.js#searchPlaylists). Older rows may
    // still carry a legacy `videos` array; roadmap.service.js treats those as
    // stale and overwrites them with playlists on the next fetch.
    'playlists',
    'fetched_at',
  ],
};
