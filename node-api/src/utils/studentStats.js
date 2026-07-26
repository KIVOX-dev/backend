const studentRepository = require('../repositories/student.repository');

function isSameUtcDate(a, b) {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

// Applies one completed test attempt to a student's running stats
// (tests_completed / avg_accuracy / day streak). Ported from python-service,
// where this exact algorithm was duplicated verbatim in students.py's
// log_student_test and assessments.py's submit_test — centralized here as
// the one implementation both call sites now share.
async function applyTestResult(studentRowId, percentage) {
  const student = await studentRepository.findById(studentRowId);
  if (!student) return;

  const testsCompleted = (student.tests_completed || 0) + 1;
  const prevAvg = student.avg_accuracy || 0;
  const newAvg = Math.round(((prevAvg * (testsCompleted - 1) + percentage) / testsCompleted) * 100) / 100;

  const today = new Date();
  let streak = student.streak_days || 0;
  if (student.last_test_date) {
    const last = new Date(student.last_test_date);
    if (!isSameUtcDate(last, today)) {
      const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
      streak = isSameUtcDate(last, yesterday) ? streak + 1 : 1;
    }
    // same day as last attempt: streak unchanged
  } else {
    streak = 1;
  }

  await studentRepository.updateById(studentRowId, {
    tests_completed: testsCompleted,
    avg_accuracy: newAvg,
    streak_days: streak,
    last_test_date: today,
  });
}

module.exports = { applyTestResult };
