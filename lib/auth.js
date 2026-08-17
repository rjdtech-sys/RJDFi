const crypto = require('crypto');

const PBKDF2_ITERATIONS = 100000; // Upgraded from 1,000 → 100,000
const LEGACY_ITERATIONS = 1000;   // Old iteration count for backward compat

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, 64, 'sha512').toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, hash) {
  // Try current (upgraded) iterations first
  const currentHash = crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, 64, 'sha512').toString('hex');
  if (hash === currentHash) return true;
  // Fallback: try legacy iterations (backward compat with old hashes)
  const legacyHash = crypto.pbkdf2Sync(password, salt, LEGACY_ITERATIONS, 64, 'sha512').toString('hex');
  return hash === legacyHash;
}

/**
 * Verify password and check if hash needs upgrading.
 * Returns { valid, needsRehash, salt, hash }
 * - valid: whether the password is correct
 * - needsRehash: true if the stored hash uses old iterations and should be rehashed
 * - salt, hash: new salt/hash to store (only if needsRehash is true)
 */
function verifyPasswordWithUpgrade(password, salt, storedHash) {
  // Try current (upgraded) iterations first
  const currentHash = crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, 64, 'sha512').toString('hex');
  if (storedHash === currentHash) {
    return { needsRehash: false }; // Already on latest iterations
  }
  // Try legacy iterations
  const legacyHash = crypto.pbkdf2Sync(password, salt, LEGACY_ITERATIONS, 64, 'sha512').toString('hex');
  if (storedHash === legacyHash) {
    // Password matches but uses old iterations — generate new hash
    const newSalt = crypto.randomBytes(16).toString('hex');
    const newHash = crypto.pbkdf2Sync(password, newSalt, PBKDF2_ITERATIONS, 64, 'sha512').toString('hex');
    return { needsRehash: true, salt: newSalt, hash: newHash };
  }
  // Password doesn't match at all
  return { needsRehash: false };
}

module.exports = { hashPassword, verifyPassword, verifyPasswordWithUpgrade, PBKDF2_ITERATIONS };
