const path = require('path');
const fs = require('fs');

/**
 * Load and validate user configuration from JSON file.
 * @param {string} [configPath] - Path to users.json file
 * @returns {Array<{username: string, passwordHash: string, displayName: string}>} Array of user objects
 * @throws {Error} If config file is missing, malformed, or invalid
 */
function loadUsers(configPath) {
  const defaultPath = path.join(process.cwd(), 'config', 'users.json');
  const filePath = configPath || defaultPath;

  // Check if file exists
  if (!fs.existsSync(filePath)) {
    throw new Error(`User config file not found: ${filePath}`);
  }

  // Read and parse JSON
  let users;
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    users = JSON.parse(content);
  } catch (err) {
    throw new Error(`Failed to parse user config: ${err.message}`);
  }

  // Validate structure
  if (!Array.isArray(users)) {
    throw new Error('User config must be an array');
  }

  if (users.length === 0) {
    throw new Error('User config must contain at least one user');
  }

  // Validate each user
  for (const user of users) {
    if (!user.username || typeof user.username !== 'string') {
      throw new Error('Each user must have a username (string)');
    }

    if (!user.passwordHash || typeof user.passwordHash !== 'string') {
      throw new Error(`User ${user.username}: missing passwordHash (string)`);
    }

    if (!user.passwordHash.startsWith('$argon2id$')) {
      throw new Error(
        `User ${user.username}: passwordHash must be Argon2id (starts with $argon2id$). ` +
        `Use scripts/hash-password.js to generate valid hashes.`
      );
    }

    if (!user.displayName || typeof user.displayName !== 'string') {
      throw new Error(`User ${user.username}: missing displayName (string)`);
    }
  }

  // Check for duplicate usernames
  const usernames = users.map(u => u.username);
  const uniqueUsernames = new Set(usernames);
  if (uniqueUsernames.size !== usernames.length) {
    throw new Error('Duplicate usernames found in user config');
  }

  return users;
}

module.exports = { loadUsers };

// CLI: Load and print user count
if (require.main === module) {
  try {
    const configPath = process.argv[2];
    const users = loadUsers(configPath);
    console.log(`Loaded ${users.length} user(s):`);
    users.forEach(u => console.log(`  - ${u.username} (${u.displayName})`));
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}
