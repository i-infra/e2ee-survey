/**
 * Crypto utilities for end-to-end encryption
 * Compatible with the existing crypter implementation
 */

// These will be loaded from CDN in the browser
let nacl, argon2;

// For Node.js/Worker environment, we'll need to handle module loading
if (typeof window === 'undefined') {
  // Server-side: these would need to be imported differently in Workers
  // For now, we'll implement browser-compatible versions
}

/**
 * Initialize crypto libraries (call this in browser)
 */
export function initCrypto(naclLib, argon2Lib) {
  nacl = naclLib;
  argon2 = argon2Lib;
}

/**
 * Generate cryptographically random bytes
 */
export function randomBytes(length) {
  if (nacl) {
    return nacl.randomBytes(length);
  }
  // Fallback for environments without nacl
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return array;
}

/**
 * Derive encryption key using Argon2i (compatible with existing crypter)
 */
export async function deriveKey(password, salt) {
  const passwordBytes = new TextEncoder().encode(password);
  
  // Use same parameters as existing crypter
  const opslimit = 3; // OPSLIMIT_MODERATE
  const memlimit = 262144; // MEMLIMIT_MODERATE (256MB in KB)
  
  const result = await argon2.hash({
    pass: passwordBytes,
    salt: salt,
    time: opslimit,
    mem: memlimit,
    hashLen: 32,
    parallelism: 1,
    type: argon2.ArgonType.Argon2i
  });
  
  return new Uint8Array(result.hash);
}

/**
 * Encrypt data using NaCl SecretBox
 */
export function encryptData(data, key) {
  const message = new TextEncoder().encode(JSON.stringify(data));
  const nonce = randomBytes(nacl.secretbox.nonceLength);
  const ciphertext = nacl.secretbox(message, nonce, key);
  
  // Format: nonce + ciphertext (compatible with existing format)
  const output = new Uint8Array(nonce.length + ciphertext.length);
  output.set(nonce, 0);
  output.set(ciphertext, nonce.length);
  
  return output;
}

/**
 * Decrypt data using NaCl SecretBox
 */
export function decryptData(encryptedData, key) {
  const nonceLength = nacl.secretbox.nonceLength;
  
  if (encryptedData.length < nonceLength) {
    throw new Error('Invalid encrypted data format');
  }
  
  const nonce = encryptedData.slice(0, nonceLength);
  const ciphertext = encryptedData.slice(nonceLength);
  
  const decrypted = nacl.secretbox.open(ciphertext, nonce, key);
  
  if (!decrypted) {
    throw new Error('Decryption failed - incorrect password or corrupted data');
  }
  
  const jsonString = new TextDecoder().decode(decrypted);
  return JSON.parse(jsonString);
}

/**
 * Create a hash of the key for verification (without storing the key)
 */
export async function createKeyHash(key) {
  const hashBuffer = await crypto.subtle.digest('SHA-256', key);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Generate a ULID for unique identifiers
 */
export function generateUlid() {
  // Simple ULID implementation
  // In production, use the 'ulid' library
  const timestamp = Date.now();
  const randomness = randomBytes(10);
  
  // Convert to base32-like encoding
  const chars = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let result = '';
  
  // Encode timestamp (6 chars)
  let temp = timestamp;
  for (let i = 0; i < 10; i++) {
    result = chars[temp % 32] + result;
    temp = Math.floor(temp / 32);
  }
  
  // Encode randomness (16 chars)
  for (let i = 0; i < randomness.length; i++) {
    const byte = randomness[i];
    result += chars[byte % 32];
    if (i < randomness.length - 1) {
      result += chars[Math.floor(byte / 32)];
    }
  }
  
  return result.slice(0, 26); // ULID is 26 characters
}

/**
 * Validate password strength
 */
export function validatePassword(password) {
  if (!password || password.length < 8) {
    return { valid: false, message: 'Password must be at least 8 characters long' };
  }
  
  if (password.length > 128) {
    return { valid: false, message: 'Password must be less than 128 characters' };
  }
  
  return { valid: true };
}

/**
 * Create complete encrypted survey package
 */
export async function createEncryptedSurvey(surveyData, password) {
  const validation = validatePassword(password);
  if (!validation.valid) {
    throw new Error(validation.message);
  }
  
  // Generate salt and derive key
  const salt = randomBytes(16);
  const key = await deriveKey(password, salt);
  
  // Encrypt survey data
  const encryptedData = encryptData(surveyData, key);
  
  // Create key hash for verification
  const keyHash = await createKeyHash(key);
  
  return {
    id: generateUlid(),
    salt: Array.from(salt),
    encryptedData: Array.from(encryptedData),
    keyHash,
    createdAt: Date.now()
  };
}

/**
 * Decrypt and verify survey data
 */
export async function decryptSurvey(encryptedSurvey, password) {
  const { salt, encryptedData, keyHash } = encryptedSurvey;
  
  // Derive key from password and salt
  const key = await deriveKey(password, new Uint8Array(salt));
  
  // Verify key hash
  const computedHash = await createKeyHash(key);
  if (computedHash !== keyHash) {
    throw new Error('Invalid password');
  }
  
  // Decrypt data
  const surveyData = decryptData(new Uint8Array(encryptedData), key);
  
  return { surveyData, key };
}