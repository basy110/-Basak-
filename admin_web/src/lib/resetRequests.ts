/**
 * Password-reset requests still waiting for the admin: not yet used, cancelled or expired.
 * Kept tiny on purpose: it is part of the shared «kit» chunk (vite.config.ts) that the
 * workspace frame loads for its badge. The list, its words and its writes are in
 * lib/passwordRequests.ts.
 */
export const OPEN_RESET_STATUSES = ['pending', 'code_issued'];
export const isOpenReset = (request: { status: string }) => OPEN_RESET_STATUSES.includes(request.status);
