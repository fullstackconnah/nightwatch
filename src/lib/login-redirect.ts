/** The kiosk is a wall display with no login: a lapsed elevation must surface as an error there, never navigate away. */
export const shouldRedirectToLogin = (pathname: string): boolean => pathname !== "/kiosk" && !pathname.startsWith("/kiosk/");
