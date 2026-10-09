import { redirect } from "next/navigation";

/**
 * The person page stopped being a Coursera page: it carries what somebody did
 * here as well as on the provider, and it now opens for colleagues who have
 * never touched Coursera at all. It lives under /people. Old links — in
 * emails, in bookmarks, in the Coursera panel — land on the same record.
 */
export default async function CourseraPersonRedirect({
  params,
}: {
  params: Promise<{ email: string }>;
}) {
  const { email } = await params;
  redirect(`/people/${email}`);
}
