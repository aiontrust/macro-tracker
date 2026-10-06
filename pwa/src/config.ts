/**
 * Pro early access — a branded version for a gym.
 *
 * Leave this empty. The form stays on screen and stays disabled until an
 * endpoint is set. Nothing is sent anywhere while it is empty.
 *
 * Javier: create a form that accepts a field named `email`
 * (Formspree does this: https://formspree.io). Paste the endpoint below,
 * rebuild (`npm run build` in /pwa), and redeploy. Example:
 *
 *   export const PRO_SIGNUP_ENDPOINT = "https://formspree.io/f/xxxxxxxx";
 *
 * The browser POSTs application/x-www-form-urlencoded with `email`.
 * When this device first opened a link such as `/?src=flyer` or
 * `/?src=trainer-mike`, the same POST also includes an optional `src`
 * field (a short slug). Map `src` to a Mailchimp or Formspree merge field
 * if the tag should land on the subscriber. The field is omitted when no
 * tag was stored. The macro log is not included. There is still no backend
 * in this repo.
 */
export const PRO_SIGNUP_ENDPOINT = "";
