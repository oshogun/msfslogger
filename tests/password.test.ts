import crypto from 'crypto';
import { describe, expect, it } from 'vitest';
import {
  DUMMY_PASSWORD_HASH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  SCRYPT_PARAMS,
  USERNAME_MAX_LENGTH,
  hashPassword,
  verifyPassword,
} from '../src/auth/password';

// src/auth/password.ts is pure — no DB, no express, no I/O — so nothing is
// mocked here. scrypt at N=16384 costs ~45 ms per derivation, so each test
// below deliberately performs only a handful.

const STORED = /^scrypt\$16384\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/;

describe('SCRYPT_PARAMS', () => {
  it('is the frozen parameter set', () => {
    expect(SCRYPT_PARAMS).toEqual({ N: 16384, r: 8, p: 1, keylen: 32, saltlen: 16 });
  });

  it('exposes the length limits', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(12);
    expect(PASSWORD_MAX_LENGTH).toBe(200);
    expect(USERNAME_MAX_LENGTH).toBe(64);
  });
});

describe('hashPassword', () => {
  it('returns the scrypt$N$r$p$salt$key encoding', () => {
    expect(hashPassword('correct horse battery staple')).toMatch(STORED);
  });

  it('salts randomly — two hashes of the same password differ', () => {
    const a = hashPassword('correct horse battery staple');
    const b = hashPassword('correct horse battery staple');
    expect(a).not.toBe(b);
  });

  it('encodes a 16-byte salt and a 32-byte key', () => {
    const [, , , , salt, key] = hashPassword('correct horse battery staple').split('$');
    expect(Buffer.from(salt, 'base64')).toHaveLength(SCRYPT_PARAMS.saltlen);
    expect(Buffer.from(key, 'base64')).toHaveLength(SCRYPT_PARAMS.keylen);
  });
});

describe('verifyPassword', () => {
  it('round-trips the password it was given', () => {
    expect(verifyPassword('correct horse battery staple', hashPassword('correct horse battery staple'))).toBe(true);
  });

  it('rejects a wrong password', () => {
    expect(verifyPassword('Correct horse battery staple', hashPassword('correct horse battery staple'))).toBe(false);
  });

  it('does not trim — surrounding whitespace is part of the password', () => {
    const stored = hashPassword(' padded password ');
    expect(verifyPassword(' padded password ', stored)).toBe(true);
    expect(verifyPassword('padded password', stored)).toBe(false);
  });

  // A corrupt or foreign auth_user row must be a failed login, never a 500.
  it.each([
    ['empty string', ''],
    ['one character', 'x'],
    ['too few fields', 'scrypt$16384$8$1$abc'],
    ['unknown scheme', 'argon2$a$b$c$d$e'],
    ['non-numeric N', 'scrypt$abc$8$1$YWJj$YWJj'],
    ['non-base64 salt and key', 'scrypt$16384$8$1$!!!$!!!'],
  ])('returns false without throwing for %s', (_label, stored) => {
    expect(verifyPassword('correct horse battery staple', stored)).toBe(false);
  });

  it('re-derives with the stored row\'s own parameters, not the current ones', () => {
    // A hash written under a cheaper N still verifies, which is what lets the
    // scrypt parameters be raised later without a migration.
    const cheap = 'scrypt$1024$8$1$' +
      Buffer.from('0123456789abcdef').toString('base64') + '$' +
      crypto.scryptSync('legacy password', Buffer.from('0123456789abcdef'), 32, { N: 1024, r: 8, p: 1 }).toString('base64');
    expect(verifyPassword('legacy password', cheap)).toBe(true);
    expect(verifyPassword('wrong password', cheap)).toBe(false);
  });
});

describe('DUMMY_PASSWORD_HASH', () => {
  it('is a well-formed hash so the wrong-username path costs a real derivation', () => {
    expect(DUMMY_PASSWORD_HASH).toMatch(STORED);
  });

  it('never verifies', () => {
    expect(verifyPassword('', DUMMY_PASSWORD_HASH)).toBe(false);
    expect(verifyPassword('correct horse battery staple', DUMMY_PASSWORD_HASH)).toBe(false);
  });
});
