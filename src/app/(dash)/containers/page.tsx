import { redirect } from "next/navigation";

// The three list pages became one /docker page; these routes stay as redirects (307, never permanent) for bookmarks.
export default function ContainersRedirect() {
  redirect("/docker?find=containers");
}
