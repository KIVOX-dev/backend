// Every date shown in an email is in IST, whatever the server's timezone.
const dateTime = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

const dateOnly = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

function valid(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// "20 Nov 2026, 10:30 am IST", or `fallback` when there is no usable date.
function formatIstDateTime(value, fallback = '') {
  const date = valid(value);
  return date ? `${dateTime.format(date)} IST` : fallback;
}

// "20 Nov 2026" — for fields that are a day, not a moment (drive date, deadline).
function formatIstDate(value, fallback = '') {
  const date = valid(value);
  return date ? dateOnly.format(date) : fallback;
}

module.exports = { formatIstDateTime, formatIstDate };
