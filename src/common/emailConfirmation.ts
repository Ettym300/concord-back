import env from './env';

/**
 * Email confirmation is disabled until SMTP is configured.
 * Set EMAIL_CONFIRMATION_ENABLED=true on the API when ready to turn it back on.
 */
export function isEmailConfirmed(emailConfirmed?: boolean | null) {
  if (!env.EMAIL_CONFIRMATION_ENABLED) return true;
  return !!emailConfirmed;
}
