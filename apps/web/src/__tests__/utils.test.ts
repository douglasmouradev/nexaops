import { describe, it, expect } from 'vitest';
import { parseNaturalLanguageFilter } from '@nexaops/shared';

describe('parseNaturalLanguageFilter', () => {
  it('detecta dispositivos offline', () => {
    const result = parseNaturalLanguageFilter('mostrar dispositivos offline');
    expect(result.status).toBe('OFFLINE');
  });

  it('detecta servidores', () => {
    const result = parseNaturalLanguageFilter('listar servidores');
    expect(result.type).toBe('SERVER');
  });

  it('detecta patches pendentes', () => {
    const result = parseNaturalLanguageFilter('dispositivos com patch pendente');
    expect(result.hasPatches).toBe(true);
  });

  it('extrai texto entre aspas', () => {
    const result = parseNaturalLanguageFilter('buscar "SRV-ACME"');
    expect(result.search).toBe('SRV-ACME');
  });
});
