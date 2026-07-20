"use client";
import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { checkSession } from "@/lib/api";

export default function LandingPage() {
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (token) checkSession().then((ok) => {
      if (!ok) { localStorage.removeItem("token"); localStorage.removeItem("user"); }
      setAuthed(ok);
    });
  }, []);

  const features = [
    { icon: "🤖", col: "rgba(139,92,246,0.15)", title: "Conversational Bot", desc: "The RecruitX bot joins Google Meet calls dynamically, greets candidates, and conducts human-like structured conversations based on customizable prompts." },
    { icon: "📝", col: "rgba(96,165,250,0.12)", title: "Real-time Transcripts", desc: "Transcribe conversations live. Monitor user responses and interviewer feedback immediately on your dashboard as the interview is conducted." },
    { icon: "📊", col: "rgba(52,211,153,0.12)", title: "AI Scorecard Reports", desc: "Receive detailed, dimensions-based scorecards highlighting candidate strengths, areas of concern, overall ratings, and hiring recommendations." },
  ];

  return (
    <div style={{
      minHeight: "100vh", display: "flex", flexDirection: "column",
      background: "#07070f",
      backgroundImage: "radial-gradient(ellipse 80% 60% at 5% 10%, rgba(139,92,246,0.14) 0%, transparent 60%), radial-gradient(ellipse 60% 40% at 95% 90%, rgba(99,102,241,0.10) 0%, transparent 60%)",
      backgroundAttachment: "fixed",
      color: "#f1f5f9",
    }}>
      {/* Navbar */}
      <header style={{
        background: "rgba(8,8,17,0.80)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
        borderBottom: "1px solid rgba(255,255,255,0.08)", padding: "20px 48px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        position: "sticky", top: 0, zIndex: 50,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Image src="/LogoWithoutName.svg" alt="RecruitX" width={36} height={36} style={{ objectFit: "contain" }} />
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, background: "linear-gradient(135deg,#a78bfa,#818cf8)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>RecruitX AI</h2>
            <p style={{ margin: 0, fontSize: 9, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: ".1em" }}>AI Interviewer Hub</p>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {authed ? (
            <Link href="/recruiter" style={{ padding: "9px 20px", textDecoration: "none", background: "linear-gradient(135deg,#7c3aed,#4f46e5)", color: "#fff", borderRadius: 8, fontSize: 13, fontWeight: 700 }}>
              Go to Dashboard
            </Link>
          ) : (
            <>
              <Link href="/login" style={{ padding: "9px 18px", textDecoration: "none", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.10)", color: "#e2e8f0", borderRadius: 8, fontSize: 13, fontWeight: 600 }}>Sign In</Link>
              <Link href="/signup" style={{ padding: "9px 18px", textDecoration: "none", background: "linear-gradient(135deg,#7c3aed,#4f46e5)", color: "#fff", borderRadius: 8, fontSize: 13, fontWeight: 700 }}>Sign Up</Link>
            </>
          )}
        </div>
      </header>

      <main style={{ flex: 1, maxWidth: 1152, width: "100%", margin: "0 auto", padding: "64px 48px", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
        {/* Hero */}
        <div style={{ maxWidth: 768, display: "flex", flexDirection: "column", alignItems: "center", gap: 24, marginTop: 32 }}>
          <div style={{ background: "rgba(139,92,246,0.12)", border: "1px solid rgba(139,92,246,0.25)", color: "#c4b5fd", padding: "5px 14px", borderRadius: 9999, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>
            <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: "#8b5cf6", marginRight: 7, boxShadow: "0 0 6px #8b5cf6" }} />
            Meet RecruitX AI Interviewer
          </div>
          <h1 style={{ margin: 0, fontSize: 52, fontWeight: 800, lineHeight: 1.12, color: "#f1f5f9" }}>
            Automate Candidate Interviews on{" "}
            <span style={{ background: "linear-gradient(135deg,#a78bfa,#818cf8)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              Google Meet
            </span>
          </h1>
          <p style={{ margin: 0, color: "#94a3b8", fontSize: 17, lineHeight: 1.7, maxWidth: 580 }}>
            RecruitX orchestrates intelligent, conversational AI bots directly in your live calls. Conduct structured technical or behavioral interviews, generate real-time transcripts, and receive immediate dimensions-based evaluations.
          </p>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", justifyContent: "center", marginTop: 16 }}>
            <Link href={authed ? "/recruiter" : "/signup"} style={{ padding: "13px 28px", fontSize: 15, fontWeight: 700, textDecoration: "none", background: "linear-gradient(135deg,#7c3aed,#4f46e5)", color: "#fff", borderRadius: 12, boxShadow: "0 4px 20px rgba(139,92,246,0.35)" }}>
              {authed ? "Go to Dashboard" : "Get Started Free"}
            </Link>
            <a href="#how-to-use" style={{ padding: "13px 28px", fontSize: 15, fontWeight: 600, textDecoration: "none", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.10)", color: "#e2e8f0", borderRadius: 12 }}>
              How it Works
            </a>
          </div>
        </div>

        {/* Feature cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 24, width: "100%", marginTop: 96 }}>
          {features.map(f => (
            <div key={f.title} style={{ background: "rgba(255,255,255,0.04)", backdropFilter: "blur(20px)", border: "1px solid rgba(255,255,255,0.09)", borderRadius: 16, padding: 32, textAlign: "left" }}>
              <div style={{ width: 48, height: 48, borderRadius: 12, background: f.col, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, marginBottom: 16 }}>{f.icon}</div>
              <h3 style={{ margin: "0 0 8px", fontSize: 17, fontWeight: 700, color: "#f1f5f9" }}>{f.title}</h3>
              <p style={{ margin: 0, fontSize: 14, color: "#94a3b8", lineHeight: 1.65 }}>{f.desc}</p>
            </div>
          ))}
        </div>

        {/* Steps */}
        <div id="how-to-use" style={{ width: "100%", marginTop: 120, textAlign: "left", maxWidth: 960 }}>
          <h2 style={{ textAlign: "center", fontSize: 32, fontWeight: 800, marginBottom: 10, color: "#f1f5f9" }}>How to Use the System</h2>
          <p style={{ textAlign: "center", color: "#64748b", marginBottom: 64, fontSize: 15 }}>Get up and running with RecruitX AI Interviewer in four easy steps.</p>
          <div style={{ borderLeft: "2px solid rgba(139,92,246,0.3)", paddingLeft: 24, display: "flex", flexDirection: "column", gap: 48, marginLeft: 16 }}>
            {[
              { n: 1, title: "Custom Prompt Generation", desc: "Navigate to the Prompt Generator view. Enter the role name and click Generate. OpenAI will design a custom structured system prompt, defining candidate experience parameters and interview flow rules." },
              { n: 2, title: "Start an Interview Room Session", desc: "Go to the Interview Room. Paste your active Google Meet call URL. Choose the target prompt from saved role prompts, type the candidate's name, and click Start Interview." },
              { n: 3, title: "Monitor Live Conversations", desc: "The RecruitX bot joins the Google Meet call, greets the candidate and starts interviewing. You'll see messages appear inside the Live Conversation Feed in real-time." },
              { n: 4, title: "End Session & Analyze Scorecards", desc: "When the interview wraps up, click End Interview. The system disconnects the bot, compiles the full transcript, and triggers an evaluation with a detailed scorecard." },
            ].map(s => (
              <div key={s.n}>
                <h3 style={{ margin: "0 0 8px", fontSize: 17, fontWeight: 700, display: "flex", alignItems: "center", gap: 12, color: "#e2e8f0" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, borderRadius: "50%", background: "linear-gradient(135deg,#7c3aed,#4f46e5)", color: "#fff", fontSize: 13, fontWeight: 700, flexShrink: 0 }}>{s.n}</span>
                  Step {s.n}: {s.title}
                </h3>
                <p style={{ margin: 0, color: "#94a3b8", fontSize: 14, lineHeight: 1.7, paddingLeft: 42 }}>{s.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* CTA */}
        <div style={{ marginTop: 120, width: "100%", maxWidth: 896, background: "linear-gradient(135deg,rgba(124,58,237,0.9),rgba(79,70,229,0.9))", backdropFilter: "blur(20px)", borderRadius: 24, padding: 48, border: "1px solid rgba(139,92,246,0.3)", display: "flex", flexDirection: "column", alignItems: "center", gap: 16, boxShadow: "0 20px 60px rgba(139,92,246,0.2)" }}>
          <h2 style={{ margin: 0, fontSize: 28, fontWeight: 800, color: "#fff" }}>Ready to transform your hiring workflow?</h2>
          <p style={{ margin: 0, color: "#ddd6fe", maxWidth: 500, fontSize: 15, lineHeight: 1.6 }}>
            {authed ? "Access your workspace to orchestrate bots and view candidate transcripts." : "Deploy your first RecruitX interviewer bot and automate screeners effortlessly."}
          </p>
          <Link href={authed ? "/recruiter" : "/signup"} style={{ background: "#fff", color: "#7c3aed", padding: "12px 28px", fontSize: 15, fontWeight: 700, borderRadius: 12, textDecoration: "none", marginTop: 8 }}>
            {authed ? "Go to Dashboard" : "Create Free Account"}
          </Link>
        </div>
      </main>

      <footer style={{ textAlign: "center", padding: 24, borderTop: "1px solid rgba(255,255,255,0.07)", fontSize: 12, color: "#475569", marginTop: 80 }}>
        &copy; 2026 RecruitX AI. All rights reserved. Powered by Convex Cloud.
      </footer>
    </div>
  );
}
