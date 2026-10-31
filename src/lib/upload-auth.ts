import { jwtVerify } from "jose";
import { secretKey } from "./auth.ts";

// Full admin session only. verifySessionToken() accepts any token signed with
// the shared secret, which includes a kiosk elevation token (claim kiosk:true)
// sent as the session cookie; the upload route must refuse that.
export async function uploadAuthorized(sessionToken: string | undefined): Promise<boolean> {
  if (!sessionToken) return false;
  try {
    const { payload } = await jwtVerify(sessionToken, secretKey());
    return payload.kiosk !== true;
  } catch {
    return false;
  }
}
