import { describe, expect, it } from 'vitest';

import { greetingName } from './recipient-name.js';

describe('greetingName', () => {
  it('keeps a name as it was typed', () => {
    expect(greetingName('Camille Martin')).toBe('Camille Martin');
    expect(greetingName('Hélène D’Arcy-Durand')).toBe('Hélène D’Arcy-Durand');
  });

  it('turns line breaks into spaces, so a name cannot add lines to the e-mail', () => {
    expect(greetingName('Camille\r\nVotre compte est suspendu.\nMartin')).toBe(
      'Camille Votre compte est suspendu. Martin',
    );
  });

  it('drops the characters that reorder text or hide it', () => {
    expect(greetingName('Camille ‮niatram‬')).toBe('Camille niatram');
    expect(greetingName('Cam​ille Martin')).toBe('Cam ille Martin');
  });

  it('collapses and trims the spaces, down to an empty name', () => {
    expect(greetingName('  Camille   Martin  ')).toBe('Camille Martin');
    expect(greetingName('​\n\t')).toBe('');
  });
});
