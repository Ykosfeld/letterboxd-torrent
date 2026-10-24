const test = require('node:test');
const assert = require('node:assert');

// Test AES-GCM 256-bit encryption and decryption logic using WebCrypto SubtleCrypto
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

async function encryptSecret(plainText, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plainText);
  const cipherBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoded
  );
  return {
    iv: arrayBufferToBase64(iv.buffer),
    ciphertext: arrayBufferToBase64(cipherBuffer),
  };
}

async function decryptSecret(encryptedObj, key) {
  const iv = base64ToArrayBuffer(encryptedObj.iv);
  const data = base64ToArrayBuffer(encryptedObj.ciphertext);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(iv) },
    key,
    data
  );
  return new TextDecoder().decode(decrypted);
}

test('AES-GCM 256-bit encryption and decryption of passwords', async () => {
  const masterKey = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );

  const originalPassword = 'SuperSecretQBitPassword!#@123_çáé';
  const encrypted = await encryptSecret(originalPassword, masterKey);

  assert.notStrictEqual(encrypted.ciphertext, originalPassword);
  assert.ok(encrypted.iv);
  assert.ok(encrypted.ciphertext);

  const decrypted = await decryptSecret(encrypted, masterKey);
  assert.strictEqual(decrypted, originalPassword);
});

test('Crypto key export and import via JWK', async () => {
  const originalKey = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
  const jwk = await crypto.subtle.exportKey('jwk', originalKey);
  assert.strictEqual(jwk.kty, 'oct');
  assert.strictEqual(jwk.alg, 'A256GCM');

  const importedKey = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'AES-GCM' },
    true,
    ['encrypt', 'decrypt']
  );

  const secret = 'TestPassword123';
  const enc = await encryptSecret(secret, originalKey);
  const dec = await decryptSecret(enc, importedKey);
  assert.strictEqual(dec, secret);
});
