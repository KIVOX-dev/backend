module.exports = {
  tableName: 'institutions',
  // location/website ported from python-service's colleges.py.
  columns: ['name', 'code', 'address', 'location', 'website', 'contact_email', 'contact_phone', 'is_active'],
  defaults: { is_active: true },
};
