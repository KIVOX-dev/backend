module.exports = {
  tableName: 'courses',
  columns: [
    'student_id',
    'title',
    'thumbnail_url',
    // 'playlist' | 'video' — see youtubeClient.js#parseYoutubeInput. Kept
    // even though every lesson already carries its own youtube_video_id,
    // since a single-video course has exactly one lesson and the UI treats
    // that case slightly differently (no "course content" list needed).
    'source_type',
    'source_url',
    'youtube_playlist_id',
    'lesson_count',
    'total_duration_seconds',
  ],
};
