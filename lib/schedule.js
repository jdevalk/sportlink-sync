/**
 * Schedule definitions and next-run calculator for pipeline schedules.
 *
 * This module computes the next scheduled run time for each pipeline based on
 * the cron schedules defined in scripts/install-cron.sh. All times are in
 * Europe/Amsterdam timezone.
 */

/**
 * Pipeline schedule definitions (matching install-cron.sh)
 * @type {Object<string, Object>}
 */
const PIPELINE_SCHEDULES = {
  people: {
    times: [
      { hour: 8, minute: 0 },
      { hour: 11, minute: 0 },
      { hour: 14, minute: 0 },
      { hour: 17, minute: 0 }
    ],
    dayOfWeek: null, // daily
    label: '4x daily'
  },
  nikki: {
    times: [{ hour: 7, minute: 0 }],
    dayOfWeek: null, // daily
    label: 'Daily'
  },
  freescout: {
    times: [{ hour: 8, minute: 0 }],
    dayOfWeek: null, // daily
    label: 'Daily'
  },
  teams: {
    times: [{ hour: 6, minute: 0 }],
    dayOfWeek: 0, // Sunday
    label: 'Weekly (Sun)'
  },
  functions: {
    times: [
      { hour: 7, minute: 30 },
      { hour: 10, minute: 30 },
      { hour: 13, minute: 30 },
      { hour: 16, minute: 30 }
    ],
    dayOfWeek: null, // daily
    label: '4x daily'
  },
  discipline: {
    times: [{ hour: 23, minute: 30 }],
    dayOfWeek: 1, // Monday
    label: 'Weekly (Mon)'
  }
};

/**
 * Convert UTC date to Amsterdam time components
 * @param {Date} date - UTC date
 * @returns {Object} { year, month, day, hour, minute, dayOfWeek }
 * @private
 */
function getAmsterdamComponents(date) {
  const amsterdamString = date.toLocaleString('en-US', {
    timeZone: 'Europe/Amsterdam',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });

  // Parse format: "MM/DD/YYYY, HH:MM:SS"
  const [datePart, timePart] = amsterdamString.split(', ');
  const [month, day, year] = datePart.split('/').map(Number);
  const [hour, minute] = timePart.split(':').map(Number);

  // Get day of week in Amsterdam timezone
  const amsterdamDate = new Date(date.toLocaleString('en-US', { timeZone: 'Europe/Amsterdam' }));
  const dayOfWeek = amsterdamDate.getDay();

  return { year, month, day, hour, minute, dayOfWeek };
}

/**
 * Create UTC Date from Amsterdam wall-clock time
 * @param {number} year
 * @param {number} month - 1-12
 * @param {number} day
 * @param {number} hour
 * @param {number} minute
 * @returns {Date} UTC date representing that Amsterdam wall-clock time
 * @private
 */
function createAmsterdamDate(year, month, day, hour, minute) {
  // Try both CET (+01:00) and CEST (+02:00) offsets
  const paddedMonth = String(month).padStart(2, '0');
  const paddedDay = String(day).padStart(2, '0');
  const paddedHour = String(hour).padStart(2, '0');
  const paddedMinute = String(minute).padStart(2, '0');
  const baseString = `${year}-${paddedMonth}-${paddedDay}T${paddedHour}:${paddedMinute}:00`;

  // Try +01:00 (CET)
  const cetDate = new Date(baseString + '+01:00');
  const cetComponents = getAmsterdamComponents(cetDate);
  if (cetComponents.hour === hour && cetComponents.minute === minute) {
    return cetDate;
  }

  // Try +02:00 (CEST)
  const cestDate = new Date(baseString + '+02:00');
  const cestComponents = getAmsterdamComponents(cestDate);
  if (cestComponents.hour === hour && cestComponents.minute === minute) {
    return cestDate;
  }

  // Fallback: use CET
  return cetDate;
}

/**
 * Get the next run time for a pipeline
 * @param {string} pipelineName - Name of the pipeline
 * @param {Date} [now=new Date()] - Reference time (for testing)
 * @returns {Object|null} { time: Date, label: string } or null if unknown pipeline
 */
function getNextRun(pipelineName, now = new Date()) {
  const schedule = PIPELINE_SCHEDULES[pipelineName];
  if (!schedule) {
    return null;
  }

  const nowComponents = getAmsterdamComponents(now);

  // For daily schedules
  if (schedule.dayOfWeek === null) {
    // Find next time slot today that hasn't passed
    for (const timeSlot of schedule.times) {
      if (timeSlot.hour > nowComponents.hour ||
          (timeSlot.hour === nowComponents.hour && timeSlot.minute > nowComponents.minute)) {
        // This time slot today hasn't passed yet
        const nextRun = createAmsterdamDate(
          nowComponents.year,
          nowComponents.month,
          nowComponents.day,
          timeSlot.hour,
          timeSlot.minute
        );
        return { time: nextRun, label: schedule.label };
      }
    }

    // All time slots today have passed - return first slot tomorrow
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowComponents = getAmsterdamComponents(tomorrow);
    const firstSlot = schedule.times[0];
    const nextRun = createAmsterdamDate(
      tomorrowComponents.year,
      tomorrowComponents.month,
      tomorrowComponents.day,
      firstSlot.hour,
      firstSlot.minute
    );
    return { time: nextRun, label: schedule.label };
  }

  // For weekly schedules
  const targetDayOfWeek = schedule.dayOfWeek;
  const timeSlot = schedule.times[0];

  // Check if today is the target day and time hasn't passed
  if (nowComponents.dayOfWeek === targetDayOfWeek) {
    if (timeSlot.hour > nowComponents.hour ||
        (timeSlot.hour === nowComponents.hour && timeSlot.minute > nowComponents.minute)) {
      // Time hasn't passed yet today
      const nextRun = createAmsterdamDate(
        nowComponents.year,
        nowComponents.month,
        nowComponents.day,
        timeSlot.hour,
        timeSlot.minute
      );
      return { time: nextRun, label: schedule.label };
    }
  }

  // Find next occurrence of target day
  let daysUntilTarget = targetDayOfWeek - nowComponents.dayOfWeek;
  if (daysUntilTarget <= 0) {
    daysUntilTarget += 7;
  }

  const nextOccurrence = new Date(now);
  nextOccurrence.setDate(nextOccurrence.getDate() + daysUntilTarget);
  const nextComponents = getAmsterdamComponents(nextOccurrence);

  const nextRun = createAmsterdamDate(
    nextComponents.year,
    nextComponents.month,
    nextComponents.day,
    timeSlot.hour,
    timeSlot.minute
  );
  return { time: nextRun, label: schedule.label };
}

module.exports = {
  getNextRun,
  PIPELINE_SCHEDULES
};

// CLI self-test
if (require.main === module) {
  console.log('Schedule module self-test\n');
  console.log('Current time (UTC):', new Date().toISOString());
  console.log('Current time (Amsterdam):', new Date().toLocaleString('en-US', { timeZone: 'Europe/Amsterdam' }));
  console.log('');

  console.log('Next run times:\n');
  for (const pipelineName of Object.keys(PIPELINE_SCHEDULES)) {
    const nextRun = getNextRun(pipelineName);
    if (nextRun) {
      const amsterdamTime = nextRun.time.toLocaleString('en-US', {
        timeZone: 'Europe/Amsterdam',
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
      console.log(`${pipelineName.padEnd(12)} ${amsterdamTime.padEnd(30)} (${nextRun.label})`);
    } else {
      console.log(`${pipelineName.padEnd(12)} Unknown pipeline`);
    }
  }

  console.log('\nSelf-test complete!');
}
