module.exports = {
  tableName: 'companies',
  columns: ['name', 'website', 'industry', 'contact_email', 'contact_phone', 'is_active'],
  defaults: { is_active: true },
};
