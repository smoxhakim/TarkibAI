/**
 * The confirmation code, without a database (T22.3).
 *
 * A confirmed write is accepted only when the user's WHOLE message is the code
 * the application showed them. These are the messages that must not count as a
 * yes — including the ones that contain the code — and the ones that must.
 */
import { describe, expect, it } from 'vitest';
import { CONFIRMATION_CODE_LENGTH, codeInMessage, confirmationCode } from './confirmation';

const CODE = '482915';

describe('what counts as sending the code', () => {
  it.each([
    ['the code alone', CODE],
    ['surrounded by spaces', `  ${CODE}  `],
    ['split by a space', '482 915'],
    ['with the full stop a phone keyboard adds', `${CODE}.`],
    ['in Arabic-Indic digits', '٤٨٢٩١٥'],
    ['in Eastern Arabic-Indic digits', '۴۸۲۹۱۵'],
  ])('accepts %s', (_label, message) => {
    expect(codeInMessage(message)).toBe(CODE);
  });

  it.each([
    // Acknowledgement is not consent — the Darija module's own warning.
    ['wakha'],
    ['ok'],
    ['okay'],
    ['iyeh'],
    ['yes'],
    ['oui'],
    ["d'accord"],
    ['iyeh, dirha. confirm.'],
    ['👍'],
    // Clarification, even when it quotes the code.
    ['chhal ghadi ykoun TVA?'],
    [`wach ${CODE} howa l code?`],
    [`${CODE}?`],
    // Refusal, even when it quotes the code.
    ['la'],
    ['la, ma bghitch daba'],
    [`la, ma tdirch ${CODE}`],
    [`non ${CODE}`],
    // Near misses.
    [`${CODE}0`],
    [CODE.slice(1)],
    [`#${CODE}`],
    [''],
  ])('refuses %j', (message) => {
    expect(codeInMessage(message)).toBeNull();
  });

  it('refuses a turn with no message at all', () => {
    expect(codeInMessage(undefined)).toBeNull();
  });
});

describe('the code for a write', () => {
  const parts = ['create_quote', 'project', 'user', '{"clientName":"A"}', 'Title', 'cost', 12_345];

  it(`is ${CONFIRMATION_CODE_LENGTH} digits`, () => {
    expect(confirmationCode(parts)).toMatch(new RegExp(`^\\d{${CONFIRMATION_CODE_LENGTH}}$`));
  });

  it('is the same for the same write', () => {
    expect(confirmationCode(parts)).toBe(confirmationCode([...parts]));
  });

  it.each(parts.map((_, index) => index))('changes when part %i changes', (index) => {
    const changed = [...parts];
    changed[index] = typeof parts[index] === 'number' ? (parts[index] as number) + 1 : `${parts[index]}x`;
    expect(confirmationCode(changed)).not.toBe(confirmationCode(parts));
  });
});
