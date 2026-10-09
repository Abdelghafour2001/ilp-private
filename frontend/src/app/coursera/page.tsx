import { redirect } from "next/navigation";

/**
 * Coursera used to be its own analytics page. It is now a source on the
 * analytics screen, so the same reader can put app figures and provider
 * figures side by side instead of walking between two pages. Old links and
 * bookmarks land on that screen with Coursera already selected.
 */
export default function CourseraRedirect() {
  redirect("/org?source=coursera");
}
