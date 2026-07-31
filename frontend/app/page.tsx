"use client";
import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { checkSession } from "@/lib/api";
import { ThemeToggle } from "@/components/ThemeToggle";

export default function LandingPage() {
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (token) {
      checkSession().then((ok) => {
        if (!ok) {
          localStorage.removeItem("token");
          localStorage.removeItem("user");
        }
        setAuthed(ok);
      });
    }
  }, []);

  const features = [
    { icon: "🤖", col: "bg-primary/10 text-primary", title: "Conversational Bot", desc: "The RecruitX bot joins Google Meet calls dynamically, greets candidates, and conducts human-like structured conversations based on customizable prompts." },
    { icon: "📝", col: "bg-info/10 text-info", title: "Real-time Transcripts", desc: "Transcribe conversations live. Monitor user responses and interviewer feedback immediately on your dashboard as the interview is conducted." },
    { icon: "📊", col: "bg-success/10 text-success", title: "AI Scorecard Reports", desc: "Receive detailed, dimensions-based scorecards highlighting candidate strengths, areas of concern, overall ratings, and hiring recommendations." },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-surface-base text-fg relative overflow-hidden">
      
      {/* Background gradients managed by globals.css body styles, but we can double check it works */}
      
      {/* Navbar */}
      <header className="sticky top-0 z-50 flex items-center justify-between px-4 sm:px-8 lg:px-12 py-4 sm:py-5 border-b border-outline/10 bg-surface-1/80 backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <Image src="/LogoWithoutName.svg" alt="RecruitX" width={32} height={32} className="object-contain" />
          <div className="flex flex-col">
            <h2 className="text-base sm:text-lg font-extrabold bg-gradient-to-br from-accent to-accent-2 bg-clip-text text-transparent leading-none">
              RecruitX AI
            </h2>
            <p className="text-[9px] sm:text-[10px] font-bold text-fg-muted uppercase tracking-widest leading-tight mt-1">
              AI Interviewer
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <ThemeToggle />
          {authed ? (
            <Link href="/recruiter" className="px-4 py-2 sm:px-6 sm:py-2.5 bg-gradient-to-br from-accent to-accent-2 text-on-accent text-xs sm:text-sm font-bold rounded-lg hover:opacity-90 transition-opacity">
              Dashboard
            </Link>
          ) : (
            <>
              <Link href="/login" className="px-3 py-1.5 sm:px-5 sm:py-2 bg-surface-1 border border-outline/10 text-fg text-xs sm:text-sm font-semibold rounded-lg hover:bg-surface-sunken transition-colors">
                Sign In
              </Link>
              <Link href="/signup" className="px-3 py-1.5 sm:px-5 sm:py-2 bg-gradient-to-br from-accent to-accent-2 text-on-accent text-xs sm:text-sm font-bold rounded-lg hover:opacity-90 transition-opacity whitespace-nowrap">
                Sign Up
              </Link>
            </>
          )}
        </div>
      </header>

      <main className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-8 lg:px-12 py-12 sm:py-16 flex flex-col items-center text-center">
        {/* Hero */}
        <div className="w-full max-w-3xl flex flex-col items-center gap-6 mt-4 sm:mt-8">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-accent/10 border border-accent/20 text-accent text-xs font-bold uppercase tracking-widest">
            <span className="w-1.5 h-1.5 rounded-full bg-accent shadow-[0_0_6px_var(--color-accent)] animate-pulse" />
            Meet RecruitX AI
          </div>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold leading-tight text-fg tracking-tight">
            Force-multiply Candidate Assessment on{" "}
            <span className="bg-gradient-to-br from-accent to-accent-2 bg-clip-text text-transparent">
              Google Meet
            </span>
          </h1>
          <p className="text-base sm:text-lg text-fg-muted leading-relaxed max-w-2xl px-2">
            RecruitX orchestrates intelligent, conversational AI bots directly in your live calls. Conduct structured technical or behavioral interviews, generate real-time transcripts, and receive immediate dimensions-based evaluations.
          </p>
          <div className="flex flex-col sm:flex-row items-center gap-3 sm:gap-4 mt-4 w-full sm:w-auto px-4 sm:px-0">
            <Link href={authed ? "/recruiter" : "/signup"} className="w-full sm:w-auto px-8 py-3.5 bg-gradient-to-br from-accent to-accent-2 text-on-accent text-sm font-bold rounded-xl shadow-[0_4px_20px_var(--color-accent)_0.35] hover:-translate-y-0.5 hover:shadow-[0_6px_25px_var(--color-accent)_0.45] transition-all">
              {authed ? "Go to Dashboard" : "Get Started Free"}
            </Link>
            <a href="#how-to-use" className="w-full sm:w-auto px-8 py-3.5 bg-surface-1 border border-outline/10 text-fg text-sm font-semibold rounded-xl hover:bg-surface-sunken transition-colors">
              How it Works
            </a>
          </div>
        </div>

        {/* Feature cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 w-full mt-24">
          {features.map((f, i) => (
            <div key={i} className="glass-card glass-card-hover p-6 sm:p-8 text-left">
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-2xl mb-6 ${f.col}`}>
                {f.icon}
              </div>
              <h3 className="text-lg font-bold text-fg mb-3">{f.title}</h3>
              <p className="text-sm text-fg-muted leading-relaxed">
                {f.desc}
              </p>
            </div>
          ))}
        </div>

        {/* Steps */}
        <div id="how-to-use" className="w-full max-w-4xl mt-32 text-left">
          <h2 className="text-3xl font-extrabold text-center text-fg mb-3">How to Use the System</h2>
          <p className="text-center text-fg-muted mb-16 text-sm sm:text-base">Get up and running with RecruitX AI Interviewer in four easy steps.</p>
          
          <div className="border-l-[3px] border-accent/20 pl-6 sm:pl-10 ml-4 sm:ml-8 flex flex-col gap-10">
            {[
              { n: 1, title: "Custom Prompt Generation", desc: "Navigate to the Prompt Generator view. Enter the role name and click Generate. OpenAI will design a custom structured system prompt, defining candidate experience parameters and interview flow rules." },
              { n: 2, title: "Start an Interview Room Session", desc: "Go to the Interview Room. Paste your active Google Meet call URL. Choose the target prompt from saved role prompts, type the candidate's name, and click Start Interview." },
              { n: 3, title: "Monitor Live Conversations", desc: "The RecruitX bot joins the Google Meet call, greets the candidate and starts interviewing. You'll see messages appear inside the Live Conversation Feed in real-time." },
              { n: 4, title: "End Session & Analyze Scorecards", desc: "When the interview wraps up, click End Interview. The system disconnects the bot, compiles the full transcript, and triggers an evaluation with a detailed scorecard." },
            ].map((s) => (
              <div key={s.n} className="relative glass-card p-6 sm:p-8">
                <span className="absolute -left-[45.5px] sm:-left-[64px] top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-gradient-to-br from-accent to-accent-2 text-on-accent text-sm font-bold flex items-center justify-center shadow-[0_0_15px_var(--color-accent)] ring-4 ring-bg outline outline-1 outline-accent/20 z-10 transition-all hover:scale-110">
                  {s.n}
                </span>
                <h3 className="text-lg font-bold text-fg mb-2">Step {s.n}: {s.title}</h3>
                <p className="text-sm text-fg-muted leading-relaxed max-w-2xl">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* CTA */}
        <div className="w-full max-w-4xl mt-32 bg-gradient-to-br from-accent to-accent-2 rounded-3xl p-8 sm:p-12 border border-accent/20 shadow-[0_20px_60px_var(--color-accent)_0.2] flex flex-col items-center gap-6">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-on-accent m-0 text-center">
            Ready to transform your hiring workflow?
          </h2>
          <p className="text-on-accent/80 max-w-lg text-sm sm:text-base text-center">
            {authed ? "Access your workspace to orchestrate bots and view candidate transcripts." : "Deploy your first RecruitX interviewer bot and automate screeners effortlessly."}
          </p>
          <Link href={authed ? "/recruiter" : "/signup"} className="mt-2 px-8 py-3.5 bg-surface-1 text-fg hover:text-accent font-bold rounded-xl shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all w-full sm:w-auto text-center">
            {authed ? "Go to Dashboard" : "Create Free Account"}
          </Link>
        </div>
      </main>

      <footer className="text-center py-8 border-t border-outline/10 text-xs text-fg-muted mt-12">
        &copy; 2026 RecruitX AI. All rights reserved. Powered by Convex Cloud.
      </footer>
    </div>
  );
}
