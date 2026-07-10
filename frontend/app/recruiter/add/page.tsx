"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { api } from "@/lib/api";

const BASE = process.env.NEXT_PUBLIC_API_URL || "";

interface Candidate {
  _id: string; name: string; email: string; roleName?: string;
  interviewStatus?: string; attemptCount?: number; cooldownUntil?: number;
  phone?: string; notes?: string;
}

function Badge({ c }: { c: Candidate }) {
  const s = (c.interviewStatus || "never_invited").replace(/\.\d+/g, "");
  const map: Record<string, [string, string]> = {
    never_invited: ["#f1f5f9|#64748b", "Not Invited"],
    attempt_1_scheduled: ["#eff6ff|#1d4ed8", "Interview 1 Sched."],
    cooldown: ["#fff7ed|#c2410c", coolDays(c)],
    attempt_2_scheduled: ["#eff6ff|#1d4ed8", "Interview 2 Sched."],
    locked: ["#fef2f2|#dc2626", "Final/Locked"],
    completed: ["#f0fdf4|#16a34a", "Completed"],
    partial: ["#fefce8|#854d0e", "Partial"],
    no_show: ["#fff7ed|#c2410c", "No Show"],
  };
  const [colors, label] = map[s] || ["#f1f5f9|#64748b", s.replace(/_/g, " ")];
  const [bg, color] = colors.split("|");
  return <span style={{ display: "inline-block", padding: "3px 11px", borderRadius: 20, fontSize: 12, fontWeight: 700, background: bg, color }}>{label}</span>;
}

function coolDays(c: Candidate) {
  if (!c.cooldownUntil) return "Cooldown";
  const d = Math.max(0, Math.ceil((c.cooldownUntil - Date.now()) / 86400000));
  return `Cooldown (${d}d)`;
}

function EditModal({ candidate, onClose, onSaved }: { candidate: Candidate; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ name: candidate.name, email: candidate.email, phone: candidate.phone || "", role_name: candidate.roleName || "", notes: candidate.notes || "" });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setErr("");
    try {
      const res = await fetch(`${BASE}/api/candidates/${candidate._id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("token")}` },
        body: JSON.stringify(form),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.detail || "Failed");
      onSaved();
    } catch (err: unknown) { setErr(err instanceof Error ? err.message : "Error"); }
    finally { setLoading(false); }
  }

  const inp: React.CSSProperties = { width: "100%", padding: "10px 13px", fontSize: 14, border: "1px solid #e2e8f0", borderRadius: 8, outline: "none", background: "#fff", fontFamily: "inherit" };
  const lbl: React.CSSProperties = { display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 5 };

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose(); }} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "#fff", borderRadius: 16, width: "90%", maxWidth: 480, padding: 32 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Edit Candidate</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#64748b" }}>✕</button>
        </div>
        <form onSubmit={save}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            {[["Full Name", "name", "text", "Jane Doe"], ["Email Address", "email", "email", "jane@example.com"], ["Phone", "phone", "text", "+91 98765 43210"], ["Role Applied For", "role_name", "text", "Full Stack Developer"]].map(([label, key, type, ph]) => (
              <div key={key} style={{ marginBottom: 14 }}>
                <label style={lbl}>{label}</label>
                <input type={type} placeholder={ph} style={inp} value={(form as Record<string, string>)[key]} onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))} />
              </div>
            ))}
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={lbl}>Notes</label>
            <textarea rows={2} style={{ ...inp, resize: "vertical" }} placeholder="Any relevant context..." value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />
          </div>
          {err && <div style={{ padding: "10px 14px", background: "#fef2f2", color: "#dc2626", borderRadius: 8, fontSize: 13, marginBottom: 12 }}>{err}</div>}
          <div style={{ display: "flex", gap: 10 }}>
            <button type="button" onClick={onClose} style={{ flex: 1, padding: "10px", background: "#f1f5f9", color: "#374151", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
            <button type="submit" disabled={loading} style={{ flex: 1, padding: "10px", background: "#7c3aed", color: "#fff", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: "pointer", opacity: loading ? 0.65 : 1 }}>{loading ? "Saving..." : "Save Changes"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function AddCandidatePage() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [form, setForm] = useState({ name: "", email: "", phone: "", role_name: "", notes: "" });
  const [alert, setAlert] = useState<{ msg: string; type: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<Candidate | null>(null);

  useEffect(() => { loadCandidates(); }, []);

  async function loadCandidates() {
    try {
      const res = await api("/api/candidates");
      const d = await res.json();
      setCandidates(d.candidates || []);
    } catch { /* ignore */ }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setAlert({ msg: "Adding candidate...", type: "info" });
    try {
      const res = await fetch(`${BASE}/api/candidates`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("token")}` },
        body: JSON.stringify(form),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.detail || "Failed");
      setAlert({ msg: `${d.name} added successfully.`, type: "success" });
      setForm({ name: "", email: "", phone: "", role_name: "", notes: "" });
      loadCandidates();
    } catch (err: unknown) {
      setAlert({ msg: err instanceof Error ? err.message : "Error", type: "error" });
    } finally { setLoading(false); }
  }

  async function deleteCand(id: string, name: string) {
    if (!confirm(`Delete ${name}?`)) return;
    await api(`/api/candidates/${id}`, { method: "DELETE" });
    loadCandidates();
  }

  const inp: React.CSSProperties = { width: "100%", padding: "10px 13px", fontSize: 14, border: "1px solid #e2e8f0", borderRadius: 8, outline: "none", background: "#fff", fontFamily: "inherit" };
  const lbl: React.CSSProperties = { display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 5 };
  const alertColor = alert?.type === "success" ? "#f0fdf4|#16a34a" : alert?.type === "error" ? "#fef2f2|#dc2626" : "#eff6ff|#1d4ed8";
  const [alertBg, alertText] = (alertColor || "").split("|");

  return (
    <>
      <h1 style={{ fontSize: 22, fontWeight: 800, color: "#0f172a", margin: "0 0 24px" }}>Add Candidate</h1>
      <div style={{ display: "grid", gridTemplateColumns: "400px 1fr", gap: 24, alignItems: "start" }}>

        {/* Add form */}
        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 28 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: "#374151", margin: "0 0 20px" }}>New Candidate</h2>
          <form onSubmit={handleSubmit}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div style={{ marginBottom: 16 }}>
                <label style={lbl}>Full Name *</label>
                <input style={inp} required placeholder="Jane Doe" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={lbl}>Email Address *</label>
                <input style={inp} type="email" required placeholder="jane@example.com" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} />
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={lbl}>Phone</label>
                <input style={inp} placeholder="+91 98765 43210" value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} />
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={lbl}>Role Applied For</label>
                <input style={inp} placeholder="e.g. Full Stack Developer" value={form.role_name} onChange={e => setForm(p => ({ ...p, role_name: e.target.value }))} />
              </div>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={lbl}>Notes</label>
              <textarea style={{ ...inp, resize: "vertical", minHeight: 60 }} placeholder="Any relevant context..." value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />
            </div>
            {alert && <div style={{ padding: "11px 14px", borderRadius: 8, fontSize: 14, marginBottom: 14, background: alertBg, color: alertText }}>{alert.msg}</div>}
            <button type="submit" disabled={loading} style={{ width: "100%", padding: "10px 22px", background: "#7c3aed", color: "#fff", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.65 : 1 }}>
              Add Candidate
            </button>
          </form>
        </div>

        {/* Candidates list */}
        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 28 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: "#374151", margin: 0 }}>My Candidates</h2>
            <span style={{ fontSize: 13, color: "#64748b" }}>{candidates.length} total</span>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Name","Email","Role","Status","Attempts","Actions"].map(h => (
                  <th key={h} style={{ textAlign: "left", padding: "10px 13px", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em", color: "#64748b", background: "#f8fafc", borderBottom: "2px solid #e2e8f0" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {candidates.length === 0 ? (
                <tr><td colSpan={6} style={{ textAlign: "center", color: "#64748b", padding: 32 }}>No candidates yet.</td></tr>
              ) : candidates.map(c => (
                <tr key={c._id}>
                  <td style={{ padding: 13, fontSize: 14, borderBottom: "1px solid #f1f5f9" }}><strong>{c.name}</strong></td>
                  <td style={{ padding: 13, fontSize: 13, color: "#64748b", borderBottom: "1px solid #f1f5f9" }}>{c.email}</td>
                  <td style={{ padding: 13, fontSize: 14, borderBottom: "1px solid #f1f5f9" }}>{c.roleName || "—"}</td>
                  <td style={{ padding: 13, borderBottom: "1px solid #f1f5f9" }}><Badge c={c} /></td>
                  <td style={{ padding: 13, fontSize: 14, textAlign: "center", borderBottom: "1px solid #f1f5f9" }}>{c.attemptCount || 0}/2</td>
                  <td style={{ padding: 13, borderBottom: "1px solid #f1f5f9" }}>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <Link href={`/recruiter/candidates/${c._id}`} style={{ background: "#f5f3ff", color: "#7c3aed", border: "1px solid #ddd6fe", padding: "5px 10px", fontSize: 12, borderRadius: 6, textDecoration: "none", fontWeight: 600 }}>Timeline</Link>
                      <button onClick={() => setEditing(c)} style={{ background: "#eff6ff", color: "#1d4ed8", border: "1px solid #bfdbfe", padding: "5px 10px", fontSize: 12, borderRadius: 6, cursor: "pointer", fontWeight: 600 }}>Edit</button>
                      <button onClick={() => deleteCand(c._id, c.name)} style={{ background: "#fef2f2", color: "#dc2626", border: "1px solid #fecaca", padding: "5px 10px", fontSize: 12, borderRadius: 6, cursor: "pointer" }}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {editing && <EditModal candidate={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); loadCandidates(); }} />}
    </>
  );
}
