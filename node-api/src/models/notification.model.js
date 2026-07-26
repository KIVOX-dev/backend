module.exports = {
  tableName: 'notifications',
  columns: ['user_id', 'title', 'message', 'type', 'is_read'],
  defaults: { type: 'info', is_read: false },
};
