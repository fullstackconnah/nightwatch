/** A signed-out wall display that mistypes a /kiosk URL must land back on /kiosk, not on "/" (which redirects to /login). */
export function notFoundHome(pathname: string | null): { href: string; label: string } {
  return pathname === "/kiosk" || pathname?.startsWith("/kiosk/")
    ? { href: "/kiosk", label: "Back to the wall display" }
    : { href: "/", label: "Back to Home" };
}
