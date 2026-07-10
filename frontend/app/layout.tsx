import type { Metadata } from "next";
import { Outfit } from "next/font/google";
import "./globals.css";

const outfit = Outfit({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "RecruitX AI Interviewer",
  description: "Orchestrate AI interview bots on Google Meet, track transcripts, and generate scorecards.",
  icons: { icon: "/LogoWithoutName.svg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={outfit.className}>
      <body className="min-h-screen flex flex-col">{children}</body>
    </html>
  );
}
