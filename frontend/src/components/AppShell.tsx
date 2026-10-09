"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import Topbar from "@/components/Topbar";
import CommandPalette from "@/components/CommandPalette";
import { getStoredLearner } from "@/lib/learner";
import FeatureGate from "@/components/FeatureGate";
import ChoosePassword from "@/components/ChoosePassword";
import { api } from "@/lib/api";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [ready, setReady] = useState(false);
  // A password somebody else chose. Read from storage first so there is no
  // flash of the application, then re-asked of the server below — storage is
  // the fast answer, the server is the authority.
  const [mustChoose, setMustChoose] = useState(
    typeof window !== "undefined" && localStorage.getItem("dqai.must_change_password") === "1",
  );
  const pathname = usePathname();
  const router = useRouter();
  const isLogin = pathname === "/login";
  // A guest invitation is opened by somebody with no account, from an email.
  // Wrapping it in the internal sidebar would show a stranger the company's
  // navigation, and offer them pages they cannot open.
  const isGuest = pathname.startsWith("/guest/");

  // Front door: anyone signed out lands on /login (SSO or handle).
  useEffect(() => {
    if (isLogin || isGuest) {
      setReady(true);
      return;
    }
    const check = () => {
      if (!getStoredLearner()) {
        router.replace(`/login?next=${encodeURIComponent(pathname)}`);
      } else {
        setReady(true);
      }
    };
    check();
    window.addEventListener("dqai-learner-changed", check);
    return () => window.removeEventListener("dqai-learner-changed", check);
  }, [isLogin, isGuest, pathname, router]);

  // The server's answer, so clearing one key in devtools is not a way past it.
  useEffect(() => {
    if (isLogin || isGuest || !getStoredLearner()) return;
    api
      .authMe()
      .then((me) => {
        localStorage.setItem("dqai.must_change_password", me.must_change_password ? "1" : "");
        setMustChoose(me.must_change_password);
      })
      .catch(() => {
        /* signed out or offline — the redirect above owns that case */
      });
  }, [isLogin, isGuest]);

  // These bring their own full-screen layout — no chrome around them.
  if (isLogin || isGuest) return <>{children}</>;
  if (!ready) return null; // avoid flashing the app before the redirect check
  // Before the sidebar, before the feature gate: there is nothing to navigate
  // to until the password is the person's own.
  if (mustChoose) return <ChoosePassword />;

  return (
    <div className="flex min-h-screen">
      <Sidebar mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onMenu={() => setMobileOpen(true)} />
        <main className="flex-1 px-4 py-6 md:px-8 md:py-8">
          <div className="mx-auto w-full max-w-6xl">
            <FeatureGate>{children}</FeatureGate>
          </div>
        </main>
        <footer className="border-t border-border px-4 py-5 text-center text-xs text-text-subtle md:px-8">
          UpSkill · learn by doing
        </footer>
      </div>
      <CommandPalette />
    </div>
  );
}
