/** Same three rules as the designer's auth.js password checklist. */
const COMMON = /password|casevoya|123456|qwerty/i;

export type PasswordRules = {
  len: boolean;
  mix: boolean;
  known: boolean;
};

export function passwordRules(value: string): PasswordRules {
  return {
    len: value.length >= 12,
    mix: /[a-z]/i.test(value) && /[^a-z]/i.test(value),
    known: value.length > 0 && !COMMON.test(value),
  };
}

export function passwordOk(value: string): boolean {
  const rules = passwordRules(value);
  return rules.len && rules.mix && rules.known;
}
