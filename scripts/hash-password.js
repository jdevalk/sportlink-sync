const argon2 = require('argon2');

/**
 * Hash a password using Argon2id.
 * Usage: node scripts/hash-password.js <password>
 */
async function hashPassword() {
  const password = process.argv[2];

  if (!password) {
    console.error('Usage: node scripts/hash-password.js <password>');
    process.exit(1);
  }

  try {
    const hash = await argon2.hash(password);
    console.log(hash);
  } catch (err) {
    console.error(`Failed to hash password: ${err.message}`);
    process.exit(1);
  }
}

hashPassword();
