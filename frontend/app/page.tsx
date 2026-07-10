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
    { icon: "🤖", bg: "#f5f3ff", title: "Conversational Bot", desc: "The RecruitX bot joins Google Meet calls dynamically, greets candidates, and conducts human-like structured conversations based on customizable prompts." },
    { icon: "📝", bg: "#e0e7ff", title: "Real-time Transcripts", desc: "Transcribe conversations live. Monitor user responses and interviewer feedback immediately on your app dashboard as the interview is conducted." },
    { icon: "📊", bg: "#ecfdf5", title: "AI Scorecard Reports", desc: "Receive detailed, dimensions-based scorecards highlighting candidate strengths, areas of concern, overall ratings, and hiring recommendations." },
  ];

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "#f8fafc", color: "#0f172a" }}>
      {/* Navbar */}
      <header style={{
        background: "rgba(255,255,255,0.8)", backdropFilter: "blur(8px)",
        borderBottom: "1px solid #e2e8f0", padding: "24px 48px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        position: "sticky", top: 0, zIndex: 50,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Image src="/LogoWithoutName.svg" alt="RecruitX" width={40} height={40} style={{ objectFit: "contain" }} />
          <div>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>RecruitX AI</h2>
            <p style={{ margin: 0, fontSize: 10, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: ".1em" }}>AI Interviewer Hub</p>
          </div>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          {authed ? (
            <Link href="/recruiter" style={{ padding: "10px 20px", textDecoration: "none", background: "linear-gradient(135deg,#8b5cf6,#7c3aed)", color: "#fff", borderRadius: 8, fontSize: 14, fontWeight: 600 }}>
              Go to Dashboard
            </Link>
          ) : (
            <>
              <Link href="/login" style={{ padding: "10px 20px", textDecoration: "none", background: "transparent", border: "1px solid #e2e8f0", color: "#0f172a", borderRadius: 8, fontSize: 14, fontWeight: 600 }}>Sign In</Link>
              <Link href="/signup" style={{ padding: "10px 20px", textDecoration: "none", background: "linear-gradient(135deg,#8b5cf6,#7c3aed)", color: "#fff", borderRadius: 8, fontSize: 14, fontWeight: 600 }}>Sign Up</Link>
            </>
          )}
        </div>
      </header>

      <main style={{ flex: 1, maxWidth: 1152, width: "100%", margin: "0 auto", padding: "64px 48px", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
        {/* Hero */}
        <div style={{ maxWidth: 768, display: "flex", flexDirection: "column", alignItems: "center", gap: 24, marginTop: 32 }}>
          <div style={{ background: "#f5f3ff", border: "1px solid #ddd6fe", color: "#7c3aed", padding: "6px 12px", borderRadius: 9999, fontSize: 12, fontWeight: 700, textTransform: "uppercase" }}>
            <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: "#7c3aed", marginRight: 6 }}></span>
            Meet RecruitX AI Interviewer
          </div>
          <h1 style={{ margin: 0, fontSize: 48, fontWeight: 800, lineHeight: 1.15 }}>
            Automate Candidate Interviews on{" "}
            <span style={{ background: "linear-gradient(135deg,#8b5cf6,#4f46e5)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              Google Meet
            </span>
          </h1>
          <p style={{ margin: 0, color: "#475569", fontSize: 18, lineHeight: 1.6, maxWidth: 600 }}>
            RecruitX orchestrates intelligent, conversational AI bots directly in your live calls. Conduct structured technical or behavioral interviews, generate real-time transcripts, and receive immediate dimensions-based evaluations.
          </p>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", justifyContent: "center", marginTop: 24 }}>
            <Link href={authed ? "/recruiter" : "/signup"} style={{ padding: "14px 28px", fontSize: 16, fontWeight: 600, textDecoration: "none", background: "linear-gradient(135deg,#8b5cf6,#7c3aed)", color: "#fff", borderRadius: 12, boxShadow: "0 4px 15px rgba(139,92,246,0.3)" }}>
              {authed ? "Go to Dashboard" : "Get Started Free"}
            </Link>
            <a href="#how-to-use" style={{ padding: "14px 28px", fontSize: 16, fontWeight: 600, textDecoration: "none", background: "#fff", border: "1px solid #e2e8f0", color: "#0f172a", borderRadius: 12 }}>
              How it Works
            </a>
          </div>
        </div>

        {/* Feature cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 32, width: "100%", marginTop: 96 }}>
          {features.map(f => (
            <div key={f.title} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 16, padding: 32, textAlign: "left" }}>
              <div style={{ width: 48, height: 48, borderRadius: 12, background: f.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, marginBottom: 16 }}>{f.icon}</div>
              <h3 style={{ margin: "0 0 8px", fontSize: 18, fontWeight: 700 }}>{f.title}</h3>
              <p style={{ margin: 0, fontSize: 14, color: "#64748b", lineHeight: 1.6 }}>{f.desc}</p>
            </div>
          ))}
        </div>

        {/* Steps */}
        <div id="how-to-use" style={{ width: "100%", marginTop: 120, textAlign: "left", maxWidth: 960 }}>
          <h2 style={{ textAlign: "center", fontSize: 32, fontWeight: 800, marginBottom: 12 }}>How to Use the System</h2>
          <p style={{ textAlign: "center", color: "#64748b", marginBottom: 64, fontSize: 16 }}>Get up and running with RecruitX AI Interviewer in four easy steps.</p>
          <div style={{ borderLeft: "2px solid #e2e8f0", paddingLeft: 24, display: "flex", flexDirection: "column", gap: 48, marginLeft: 16 }}>
            {[
              { n: 1, title: "Custom Prompt Generation", desc: "Navigate to the Prompt Generator view. Enter the role name and click Generate. OpenAI will design a custom structured system prompt, defining candidate experience parameters and interview flow rules." },
              { n: 2, title: "Start an Interview Room Session", desc: "Go to the Interview Room. Paste your active Google Meet call URL. Choose the target prompt from saved role prompts, type the candidate's name, and click Start Interview." },
              { n: 3, title: "Monitor Live Conversations", desc: "The RecruitX bot joins the Google Meet call, greets the candidate and starts interviewing. You'll see messages appear inside the Live Conversation Feed in real-time." },
              { n: 4, title: "End Session & Analyze Scorecards", desc: "When the interview wraps up, click End Interview. The system disconnects the bot, compiles the full transcript, and triggers an evaluation with a detailed scorecard." },
            ].map(s => (
              <div key={s.n}>
                <h3 style={{ margin: "0 0 8px", fontSize: 18, fontWeight: 700, display: "flex", alignItems: "center", gap: 12 }}>
                  <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 32, height: 32, borderRadius: "50%", background: "#8b5cf6", color: "#fff", fontSize: 14, fontWeight: 700, flexShrink: 0 }}>{s.n}</span>
                  Step {s.n}: {s.title}
                </h3>
                <p style={{ margin: 0, color: "#475569", fontSize: 15, lineHeight: 1.6, paddingLeft: 44 }}>{s.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* CTA */}
        <div style={{ marginTop: 120, width: "100%", maxWidth: 896, background: "linear-gradient(135deg,#8b5cf6,#4f46e5)", borderRadius: 24, padding: 48, color: "#fff", display: "flex", flexDirection: "column", alignItems: "center", gap: 16, boxShadow: "0 10px 25px -5px rgba(139,92,246,0.3)" }}>
          <h2 style={{ margin: 0, fontSize: 28, fontWeight: 800 }}>Ready to transform your hiring workflow?</h2>
          <p style={{ margin: 0, color: "#ddd6fe", maxWidth: 500, fontSize: 15 }}>
            {authed ? "Access your workspace to orchestrate bots and view candidate transcripts." : "Deploy your first RecruitX interviewer bot and automate screeners effortlessly."}
          </p>
          <Link href={authed ? "/recruiter" : "/signup"} style={{ background: "#fff", color: "#8b5cf6", padding: "12px 28px", fontSize: 16, fontWeight: 700, borderRadius: 12, textDecoration: "none", marginTop: 8 }}>
            {authed ? "Go to Dashboard" : "Create Free Account"}
          </Link>
        </div>
      </main>

      <footer style={{ textAlign: "center", padding: 24, borderTop: "1px solid #e2e8f0", fontSize: 12, color: "#94a3b8", marginTop: 80 }}>
        &copy; 2026 RecruitX AI. All rights reserved. Powered by Convex Cloud.
      </footer>
    </div>
  );
}
