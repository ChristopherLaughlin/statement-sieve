// Launch settings. Only this file needs editing to go live.
export const CONFIG = {
  price: '$9',
  // Payment link (Stripe Payment Link, Lemon Squeezy, Payhip...). Set its after-payment redirect to:
  //   https://YOUR-SITE/#key=THE-KEY-IN-private/unlock-key.txt
  checkoutUrl: '',
  // SHA-256 of the unlock key. The key itself is never shipped in the site.
  unlockHash: '1d9790a05b0fc6a53abd2ad8d8275a73b9a2ef21cbc42e978c29b5c4ae7e5514',
  freeRows: 10,
  supportEmail: '',
};
