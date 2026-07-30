import { redirect } from "next/navigation";

// GPU moved into the /resources metric switcher (?metric=gpu) — this route stays as a
// redirect so existing bookmarks and browser history entries for /gpu keep working.
export default function GpuRedirect() {
  redirect("/resources?metric=gpu");
}
