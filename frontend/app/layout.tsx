import type { Metadata } from "next";
import "./globals.css";

import { ThemeProvider } from "@/components/ThemeProvider";

export const metadata: Metadata = {
  title: "RecruitX AI Interviewer",
  description: "Orchestrate AI interview bots on Google Meet, track transcripts, and generate scorecards.",
  icons: { icon: "/LogoWithoutName.svg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen flex flex-col">
        <ThemeProvider attribute="data-theme" defaultTheme="dark" enableSystem={false} storageKey="recruitx-theme">
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}

