import { describe, expect, it } from 'vitest';
import {
  firstNameOf,
  frenchDate,
  initialsOf,
  invitationEmailContext,
  memberCountLabel,
  ofOrganization,
  roleLabel,
} from './invitation-email-wording.js';

describe('invitation e-mail wording', () => {
  it('names the proposed roles as the mockup does', () => {
    expect(roleLabel('admin')).toBe('Administrateur');
    expect(roleLabel('member')).toBe('Membre');
    expect(roleLabel('guest')).toBe('Invité');
  });

  it('writes the expiry day in French, in Paris', () => {
    expect(frenchDate(new Date('2026-11-16T09:15:00.000Z'))).toBe('16 novembre 2026');
    // 23:30 in UTC is already the next day in Paris.
    expect(frenchDate(new Date('2026-11-16T23:30:00.000Z'))).toBe('17 novembre 2026');
    expect(frenchDate(new Date('2026-07-31T22:30:00.000Z'))).toBe('1er août 2026');
    expect(frenchDate(new Date('2027-01-11T12:00:00.000Z'))).toBe('11 janvier 2027');
  });

  it('takes the initials of the first two words, in capitals', () => {
    expect(initialsOf('Hugo Durand')).toBe('HD');
    expect(initialsOf('Atelier Nord')).toBe('AN');
    expect(initialsOf('Coopérative Lumen Sud')).toBe('CL');
    expect(initialsOf('lumen')).toBe('L');
    expect(initialsOf('élodie Ébrard')).toBe('ÉÉ');
    expect(initialsOf('')).toBe('');
  });

  it('calls the inviter by the first word of the name', () => {
    expect(firstNameOf('Hugo Durand')).toBe('Hugo');
    expect(firstNameOf('Jean-Pierre Martin')).toBe('Jean-Pierre');
    expect(firstNameOf('Inès')).toBe('Inès');
  });

  it('elides "de" before a vowel, and keeps it before a consonant or an h', () => {
    expect(ofOrganization('Atelier Nord')).toBe('d’Atelier Nord');
    expect(ofOrganization('Échelle')).toBe('d’Échelle');
    expect(ofOrganization('Studio Pivot')).toBe('de Studio Pivot');
    expect(ofOrganization('Hachette')).toBe('de Hachette');
  });

  it('counts the members in French, singular for one', () => {
    expect(memberCountLabel(1)).toBe('1 membre');
    expect(memberCountLabel(18)).toBe('18 membres');
    // French separates thousands with a narrow no-break space.
    expect(memberCountLabel(1200)).toBe('1 200 membres');
  });

  it('links the button to the invitation in the web application', () => {
    const context: ReturnType<typeof invitationEmailContext> = invitationEmailContext(
      {
        invitationId: '01938f71-5d0b-7c3e-9a51-2f0c4b8d7e10',
        inviterName: 'Hugo Durand',
        organizationName: 'Atelier Nord',
        memberCount: 18,
        role: 'member',
        expiresAt: new Date('2026-11-16T09:15:00.000Z'),
      },
      'http://app.cadenway.localhost',
    );

    expect(context).toEqual({
      inviterName: 'Hugo Durand',
      inviterFirstName: 'Hugo',
      inviterInitials: 'HD',
      organizationName: 'Atelier Nord',
      organizationInitials: 'AN',
      ofOrganization: 'd’Atelier Nord',
      memberCountLabel: '18 membres',
      roleLabel: 'Membre',
      expiryDate: '16 novembre 2026',
      invitationUrl: 'http://app.cadenway.localhost/invite/01938f71-5d0b-7c3e-9a51-2f0c4b8d7e10',
    });
  });
});
