import fs from 'fs';

import chalk from 'chalk';
import { Command } from 'commander';
import { DateTime, Interval, Settings, Duration } from 'luxon';

Settings.defaultZone = 'utc';

const CELL_DURATION = 30; // in minutes

// Parse user arguments
const program = new Command();

program
  .name('analyse')
  .description('Because adz was lazy')
  .option('-d, --data <name>', 'Name of the data folder', 'data')
  .option(
    '-f, --from <date>',
    'Analyse data from that date on, formatted as ISO 8601 string',
    '2021-09-01T00:00:00',
  )
  .option(
    '-t, --to <date>',
    'Analyse data until that date, formatted as ISO 8601 string',
    '2022-09-30T23:59:59',
  )
  .option(
    '-d, --threshold <minutes>',
    'Consider a working phase within this duration',
    60 * 2,
  );

program.parse();
const options = program.opts();

// =======
// Helpers
// =======

function printTitle(title) {
  const line = title
    .split('')
    .reduce((acc, _, index) => {
      acc.push(index % 2 === 0 ? '❉' : ' ');
      return acc;
    }, [])
    .join('');

  console.log(chalk.bgMagenta.black.bold(line));
  console.log(chalk.bgMagenta.black.bold(title));
  console.log(chalk.bgMagenta.black.bold(line));
  console.log();
}

// ============
// Date methods
// ============

function getWorkDuringTimeframe(workIntervals, timeframe) {
  return workIntervals
    .filter((interval) => {
      return timeframe.overlaps(interval);
    })
    .map((interval) => {
      return timeframe.intersection(interval);
    })
    .reduce((acc, interval) => {
      return acc + interval.toDuration(['minutes']).toObject()['minutes'];
    }, 0);
}

function printDuration(minutes) {
  return minutes > 0
    ? Duration.fromObject({ minutes }).normalize().toFormat('hh:mm:ss')
    : '';
}

// ===============
// Read JSON files
// ===============

function listAllJSONFiles() {
  return fs.readdirSync(`./${options.data}`).filter((file) => {
    return file.includes('.json');
  });
}

function loadFile(filePath) {
  const data = fs.readFileSync(`./${options.data}/${filePath}`, 'utf8');
  return JSON.parse(data);
}

// ============
// Analyse data
// ============

function gatherAllEvents() {
  printTitle('Gather data from all files into a timeline');

  const files = listAllJSONFiles();
  const timeline = [];

  for (const file of files) {
    console.log(`Read data from "${chalk.blue(file)}"`);

    const { commits, issues } = loadFile(file);

    for (const commit of commits) {
      timeline.push({
        type: 'commit',
        date: commit.date,
        data: commit,
      });
    }

    for (const issue of issues) {
      timeline.push({
        type: 'issue',
        date: issue.date,
        data: issue,
      });
    }
  }

  console.log(`✔ Got ${chalk.bold(timeline.length)} timeline events\n`);

  return timeline.sort((a, b) => {
    return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
  });
}

function calculateWorkPhases(timeline) {
  const phases = [];

  let phaseFrom = DateTime.fromISO(timeline[0].date).toISO();
  let phaseTo;

  for (let i = 0; i < timeline.length - 1; i += 1) {
    const from = timeline[i];
    const to = timeline[i + 1];

    const fromDate = DateTime.fromISO(from.date);
    const toDate = DateTime.fromISO(to.date);
    const { minutes } = toDate.diff(fromDate, 'minutes').toObject();

    if (minutes > options.threshold) {
      phases.push({
        from: phaseFrom,
        to: fromDate.plus({ minutes: 5 }).toISO(),
      });

      phaseFrom = toDate.toISO();
    } else {
      phaseTo = toDate.toISO();
    }
  }

  phases.push({
    from: phaseFrom,
    to: phaseTo,
  });

  return phases.map((phase) => {
    return Interval.fromDateTimes(
      DateTime.fromISO(phase.from),
      DateTime.fromISO(phase.to),
    );
  });
}

function printCalendar(timeline, phases) {
  printTitle('Calendar');

  const from = DateTime.fromISO(options.from);
  const to = DateTime.fromISO(options.to);

  const eventsByDay = timeline.reduce((acc, event) => {
    const day = event.date.split('T')[0];
    if (!(day in acc)) {
      acc[day] = [];
    }

    acc[day].push(event);

    return acc;
  }, {});

  let currentDay = from.minus({ day: 1 });

  while (currentDay.plus({ day: 1 }) < to) {
    const nextDay = currentDay.plus({ day: 1 });

    // Print month
    if (!nextDay.hasSame(currentDay, 'month')) {
      console.log();
      console.log(chalk.bold.underline(nextDay.toFormat('LLLL yyyy')));
      console.log();
    }

    currentDay = nextDay;

    // Interval of the whole day
    const dayInterval = Interval.fromDateTimes(
      currentDay,
      currentDay.endOf('day'),
    );

    // Calculate how many minutes we worked during that day
    const minutesWorked = getWorkDuringTimeframe(phases, dayInterval);

    // Print cells to visualise day
    const cells = new Array((24 * 60) / CELL_DURATION)
      .fill(0)
      .map((_, index) => {
        // Create an interval for that cell
        const cellFrom = currentDay.plus({ minutes: CELL_DURATION * index });
        const cellTo = cellFrom.plus({ minutes: CELL_DURATION });
        const phase = Interval.fromDateTimes(cellFrom, cellTo);

        // Check if we worked during that cell
        const cellIsInPhase = !!phases.some((interval) => {
          return interval.overlaps(phase);
        });

        // How many commits / events did take place during that cell?
        const day = currentDay.toFormat('yyyy-MM-dd');
        const events =
          day in eventsByDay
            ? eventsByDay[day].filter((event) => {
                return phase.contains(DateTime.fromISO(event.date));
              })
            : [];

        // Print cell and show intensity
        let char;
        if (events.length === 0) {
          char = ' ';
        } else if (events.length === 1) {
          char = '◔';
        } else if (events.length > 1 && events.length < 4) {
          char = '◓';
        } else if (events.length > 4 && events.length < 10) {
          char = '◕';
        } else {
          char = '●';
        }

        // Underline cell when it is part of working phase
        if (cellIsInPhase) {
          return chalk.underline(char);
        }

        return char;
      })
      .join('');

    console.log(
      `┆ ${currentDay.toFormat('dd.MM.yy')} ┆ ${cells} ┆ ${printDuration(
        minutesWorked,
      )}`,
    );
  }

  console.log();
}

function printMonthSummary(phases) {
  printTitle('Months summary');

  console.log('  Month         Hours');
  console.log('------------------------');

  let currentMonth = DateTime.fromISO(options.from);
  while (currentMonth <= DateTime.fromISO(options.to)) {
    const from = currentMonth;
    const to = currentMonth.endOf('month');

    const timeframe = Interval.fromDateTimes(from, to);
    const minutesWorked = getWorkDuringTimeframe(phases, timeframe);

    console.log(
      [
        '▶',
        currentMonth.toFormat('LLLL yy').padEnd(12),
        printDuration(minutesWorked).padStart(9),
      ].join(' '),
    );
    currentMonth = currentMonth.plus({ month: 1 });
  }

  console.log();
}

function printTotal(phases) {
  printTitle('Total hours');
  const timeframe = Interval.fromDateTimes(
    DateTime.fromISO(options.from),
    DateTime.fromISO(options.to),
  );
  const minutesWorked = getWorkDuringTimeframe(phases, timeframe);
  console.log(`${printDuration(minutesWorked)} hours`);
  console.log();
}

// ===========
// Here we go!
// ===========

const timeline = gatherAllEvents();
const workPhases = calculateWorkPhases(timeline);
printCalendar(timeline, workPhases);
printMonthSummary(workPhases);
printTotal(workPhases);

console.log('Done!');
