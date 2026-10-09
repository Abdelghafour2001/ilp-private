import "./globals.css";
import type { Metadata } from "next";
import { Hanken_Grotesk, JetBrains_Mono } from "next/font/google";
import AppShell from "@/components/AppShell";
import { LocaleProvider } from "@/lib/i18n";
import { themeScript } from "@/lib/theme";

const sans = Hanken_Grotesk({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "UpSkill — Learning & development",
  description:
    "Learn AI & data engineering by doing — interactive labs, a local toolbox, and an AI tutor.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // `lang` is corrected client-side once the stored locale is known.
    <html lang="fr" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="font-sans">
        <LocaleProvider>
          <AppShell>{children}</AppShell>
        </LocaleProvider>
      </body>
    </html>
  );
}
