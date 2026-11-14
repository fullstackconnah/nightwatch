/** The kiosk is a wall display with no login: a lapsed elevation must surface as an error there, never navigate away. */
export const shouldRedirectToLogin = (pathname: string): boolean => pathname !== "/kiosk" && !pathname.startsWith("/kiosk/");

/** Where a password login lands: keeps a plain page anchor (the desk widget's `#backup`), same rule as `hrefFor` in desk-glance.ts. Anything else is "/", so the result can never be off-site or a script URL. */
export const postLoginPath = (hash: string): string => (/^#[a-z][a-z0-9-]*$/.test(hash) ? `/${hash}` : "/");
