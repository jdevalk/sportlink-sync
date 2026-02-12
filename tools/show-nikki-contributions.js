require('dotenv/config');

const {
  openDb,
  getAllContributions,
  getContributionsByKnvbId,
  getContributionsByYear,
  getMembersWithOutstandingBalance,
  getContributionCount
} = require('../lib/nikki-db');

/**
 * Format currency as Euro
 * @param {number} amount - Amount in Euros
 * @returns {string} - Formatted string like "€123,45"
 */
function formatEuro(amount) {
  if (amount === null || amount === undefined) return '€0,00';
  return '€' + amount.toFixed(2).replace('.', ',');
}

/**
 * Parse command line arguments
 */
function parseArgs(argv) {
  const args = {
    knvbId: null,
    year: null,
    outstanding: false,
    json: false,
    help: false
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--knvb-id' && argv[i + 1]) {
      args.knvbId = argv[++i];
    } else if (arg === '--year' && argv[i + 1]) {
      args.year = parseInt(argv[++i], 10);
    } else if (arg === '--outstanding') {
      args.outstanding = true;
    } else if (arg === '--json') {
      args.json = true;
    } else if (!arg.startsWith('-') && !args.knvbId) {
      // Positional argument treated as KNVB ID
      args.knvbId = arg;
    }
  }

  return args;
}

function printUsage() {
  console.log(`
Usage: node show-nikki-contributions.js [options] [knvb-id]

Options:
  --knvb-id <id>   Filter by member KNVB ID (Lidnr.)
  --year <year>    Filter by contribution year
  --outstanding    Show only members with outstanding balance
  --json           Output as JSON
  --help, -h       Show this help

Examples:
  node show-nikki-contributions.js                    # Show all
  node show-nikki-contributions.js --year 2024        # Filter by year
  node show-nikki-contributions.js --knvb-id ABC123   # Filter by member
  node show-nikki-contributions.js ABC123             # Same as above
  node show-nikki-contributions.js --outstanding      # Only unpaid
  node show-nikki-contributions.js --json             # JSON output
`);
}

function formatContribution(contrib) {
  const status = contrib.status || '-';
  const saldo = formatEuro(contrib.saldo);
  return `${contrib.year}  ${contrib.knvb_id.padEnd(15)}  ${contrib.nikki_id.padEnd(10)}  ${saldo.padStart(12)}  ${status}`;
}

async function main() {
  const args = parseArgs(process.argv);

  if (args.help) {
    printUsage();
    return;
  }

  const db = openDb();
  try {
    let contributions = [];

    if (args.knvbId) {
      contributions = getContributionsByKnvbId(db, args.knvbId);
    } else if (args.year) {
      contributions = getContributionsByYear(db, args.year);
    } else if (args.outstanding) {
      contributions = getMembersWithOutstandingBalance(db);
    } else {
      contributions = getAllContributions(db);
    }

    if (contributions.length === 0) {
      console.log('No contributions found matching the criteria.');
      console.log(`Total records in database: ${getContributionCount(db)}`);
      return;
    }

    if (args.json) {
      console.log(JSON.stringify(contributions, null, 2));
      return;
    }

    // Print header
    console.log('');
    console.log('Year  KNVB ID          Nikki ID    Saldo         Status');
    console.log('─'.repeat(70));

    // Print contributions
    for (const contrib of contributions) {
      console.log(formatContribution(contrib));
    }

    console.log('─'.repeat(70));
    console.log(`Total: ${contributions.length} contributions`);

    // Calculate totals
    const totalSaldo = contributions.reduce((sum, c) => sum + (c.saldo || 0), 0);
    if (totalSaldo > 0) {
      console.log(`Outstanding total: ${formatEuro(totalSaldo)}`);
    }

  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exitCode = 1;
});
