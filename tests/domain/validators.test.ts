import { it, expect } from 'vitest';
import { isValidCpf, isValidCnpj, isValidCep, isValidEmail } from '../../src/domain/validators.ts';
import { encrypt, decrypt } from '../../src/domain/crypto.ts';

it('CPF com dígitos verificadores', () => {
  expect(isValidCpf('529.982.247-25')).toBe(true);
  expect(isValidCpf('52998224725')).toBe(true);
  expect(isValidCpf('529.982.247-24')).toBe(false);
  expect(isValidCpf('111.111.111-11')).toBe(false);
  expect(isValidCpf('123')).toBe(false);
});

it('CNPJ com dígitos verificadores', () => {
  expect(isValidCnpj('11.222.333/0001-81')).toBe(true);
  expect(isValidCnpj('11.222.333/0001-80')).toBe(false);
  expect(isValidCnpj('00.000.000/0000-00')).toBe(false);
});

it('CEP e e-mail', () => {
  expect(isValidCep('50030-230')).toBe(true);
  expect(isValidCep('5003023')).toBe(false);
  expect(isValidEmail('a@b.com')).toBe(true);
  expect(isValidEmail('a@b')).toBe(false);
});

it('cifra e decifra; texto cifrado não contém o original', () => {
  const key = Buffer.alloc(32, 3);
  const c = encrypt('529.982.247-25', key);
  expect(c).not.toContain('529');
  expect(decrypt(c, key)).toBe('529.982.247-25');
  expect(() => decrypt(c, Buffer.alloc(32, 4))).toThrow();
});
