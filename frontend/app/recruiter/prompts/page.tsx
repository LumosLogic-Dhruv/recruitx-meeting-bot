"use client";
import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { useRouter } from "next/navigation";

const BASE = process.env.NEXT_PUBLIC_API_URL || "";

interface Prompt { _id: string; roleName: string; promptText: string; }

function EditPromptModal({ prompt, onClose, onSaved }: { prompt: Prompt; onClose: () => void; onSaved: () => void }) {
  const [roleName, setRoleName] = useState(prompt.roleName);
  const [promptText, setPromptText] = useState(prompt.promptText);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const BASE2 = process.env.NEXT_PUBLIC_API_URL || "";

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setErr("");
    try {
      const res = await fetch(`${BASE2}/api/prompts/${prompt._id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("token")}` },
        body: JSON.stringify({ role_name: roleName, prompt_text: promptText }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.detail || "Failed");
      onSaved();
    } catch (err: unknown) { setErr(err instanceof Error ? err.message : "Error"); }
    finally { setLoading(false); }
  }

  const inp: React.CSSProperties = { width: "100%", padding: "10px 13px", fontSize: 14, border: "1px solid #e2e8f0", borderRadius: 8, outline: "none", background: "#fff", fontFamily: "inherit" };

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose(); }} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: 600, padding: 32, maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Edit Prompt</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#64748b" }}>✕</button>
        </div>
        <form onSubmit={save}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 5 }}>Role Name</label>
            <input style={inp} value={roleName} onChange={e => setRoleName(e.target.value)} required />
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 5 }}>Prompt Text</label>
            <textarea rows={12} style={{ ...inp, resize: "vertical", fontSize: 13, lineHeight: 1.6 }} value={promptText} onChange={e => setPromptText(e.target.value)} required />
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

export default function PromptsPage() {
  const router = useRouter();
  const [tab, setTab] = useState<"role" | "docs">("role");
  const [roleInput, setRoleInput] = useState("");
  const [docRoleInput, setDocRoleInput] = useState("");
  const [cvFile, setCvFile] = useState<File | null>(null);
  const [jdFile, setJdFile] = useState<File | null>(null);
  const [alert, setAlert] = useState<{ msg: string; type: string } | null>(null);
  const [resultText, setResultText] = useState("");
  const [loading, setLoading] = useState(false);
  const [library, setLibrary] = useState<Prompt[]>([]);
  const [libError, setLibError] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState<Prompt | null>(null);

  useEffect(() => { loadLibrary(); }, []);

  async function loadLibrary() {
    try {
      const res = await api("/api/prompts");
      const d = await res.json();
      setLibrary(d.prompts || []);
    } catch { setLibError(true); }
  }

  async function genByRole() {
    if (!roleInput.trim()) { setAlert({ msg: "Please enter a role name.", type: "error" }); return; }
    setLoading(true); setAlert({ msg: "Generating with OpenAI...", type: "info" }); setResultText("");
    try {
      const res = await fetch(`${BASE}/api/prompts/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("token")}` },
        body: JSON.stringify({ role_name: roleInput.trim() }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.detail || "Failed");
      setAlert({ msg: `Prompt for "${d.role_name}" generated and saved.`, type: "success" });
      setResultText(d.prompt_text);
      loadLibrary();
    } catch (err: unknown) { setAlert({ msg: err instanceof Error ? err.message : "Error", type: "error" }); }
    finally { setLoading(false); }
  }

  async function genFromDocs() {
    if (!cvFile && !jdFile) { setAlert({ msg: "Upload at least one document.", type: "error" }); return; }
    setLoading(true); setAlert({ msg: "Reading documents and generating prompt...", type: "info" }); setResultText("");
    try {
      const fd = new FormData();
      if (cvFile) fd.append("cv_file", cvFile);
      if (jdFile) fd.append("jd_file", jdFile);
      fd.append("role_name", docRoleInput.trim());
      const res = await fetch(`${BASE}/api/prompts/generate-from-docs`, {
        method: "POST", headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }, body: fd,
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.detail || "Failed");
      setAlert({ msg: "Prompt generated from documents and saved.", type: "success" });
      setResultText(d.prompt_text);
      loadLibrary();
    } catch (err: unknown) { setAlert({ msg: err instanceof Error ? err.message : "Error", type: "error" }); }
    finally { setLoading(false); }
  }

  function useInSchedule(text: string) {
    sessionStorage.setItem("pendingPrompt", text);
    router.push("/recruiter/schedule");
  }

  const inp: React.CSSProperties = { width: "100%", padding: "10px 13px", fontSize: 14, border: "1px solid #e2e8f0", borderRadius: 8, outline: "none", background: "#fff", fontFamily: "inherit" };
  const lbl: React.CSSProperties = { display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 5 };
  const alertStyle = (type: string): React.CSSProperties => ({
    padding: "11px 14px", borderRadius: 8, fontSize: 14, marginBottom: 14,
    background: type === "success" ? "#f0fdf4" : type === "error" ? "#fef2f2" : "#eff6ff",
    color: type === "success" ? "#16a34a" : type === "error" ? "#dc2626" : "#1d4ed8",
  });

  return (
    <>
      <h1 style={{ fontSize: 22, fontWeight: 800, color: "#0f172a", margin: "0 0 24px" }}>Generate Prompt</h1>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, alignItems: "start" }}>

        {/* Generator */}
        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 28 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: "#374151", margin: "0 0 6px" }}>AI Prompt Engineer</h2>
          <p style={{ fontSize: 13, color: "#64748b", margin: "0 0 20px" }}>Generate a tailored interviewer prompt from a role name or uploaded documents.</p>

          {/* Tab toggle */}
          <div style={{ display: "flex", gap: 4, background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 10, padding: 4, marginBottom: 20 }}>
            {(["role", "docs"] as const).map(t => (
              <button key={t} onClick={() => setTab(t)} style={{ flex: 1, padding: "9px 12px", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: "pointer", background: tab === t ? "#7c3aed" : "transparent", color: tab === t ? "#fff" : "#64748b", transition: "all .2s" }}>
                {t === "role" ? "By Role Name" : "From CV + JD"}
              </button>
            ))}
          </div>

          {tab === "role" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label style={lbl}>Role Name</label>
                <input style={inp} placeholder="e.g. Senior Frontend Engineer" value={roleInput} onChange={e => setRoleInput(e.target.value)} />
              </div>
              <button onClick={genByRole} disabled={loading} style={{ padding: "10px 22px", background: "#7c3aed", color: "#fff", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.65 : 1 }}>
                Generate Prompt
              </button>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label style={lbl}>Role Name <span style={{ fontWeight: 400 }}>(optional)</span></label>
                <input style={inp} placeholder="e.g. Backend Engineer" value={docRoleInput} onChange={e => setDocRoleInput(e.target.value)} />
              </div>
              <div>
                <label style={lbl}>Candidate CV <span style={{ fontWeight: 400 }}>(PDF or TXT)</span></label>
                <input type="file" accept=".pdf,.txt,.doc,.docx" style={{ ...inp, cursor: "pointer" }} onChange={e => setCvFile(e.target.files?.[0] || null)} />
              </div>
              <div>
                <label style={lbl}>Job Description <span style={{ fontWeight: 400 }}>(PDF or TXT)</span></label>
                <input type="file" accept=".pdf,.txt,.doc,.docx" style={{ ...inp, cursor: "pointer" }} onChange={e => setJdFile(e.target.files?.[0] || null)} />
              </div>
              <p style={{ fontSize: 12, color: "#64748b", margin: 0 }}>Upload at least one document.</p>
              <button onClick={genFromDocs} disabled={loading} style={{ padding: "10px 22px", background: "#7c3aed", color: "#fff", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.65 : 1 }}>
                Generate from Documents
              </button>
            </div>
          )}

          {alert && <div style={{ ...alertStyle(alert.type), marginTop: 16 }}>{alert.msg}</div>}

          {resultText && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 16 }}>
              <label style={lbl}>Generated Prompt</label>
              <textarea rows={10} readOnly value={resultText} style={{ ...inp, fontSize: 13, lineHeight: 1.6, resize: "vertical" }} />
              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={() => navigator.clipboard.writeText(resultText).then(() => window.alert("Copied!"))} style={{ flex: 1, padding: "10px", background: "#f1f5f9", color: "#374151", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>📋 Copy</button>
                <button onClick={() => useInSchedule(resultText)} style={{ flex: 1, padding: "10px", background: "#7c3aed", color: "#fff", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Use in Schedule →</button>
              </div>
            </div>
          )}
        </div>

        {/* Library */}
        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 28 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: "#374151", margin: "0 0 6px" }}>Saved Prompt Library</h2>
          <p style={{ fontSize: 13, color: "#64748b", margin: "0 0 16px" }}>Quickly reuse prompts for standard roles.</p>
          <div style={{ maxHeight: 600, overflowY: "auto" }}>
            {libError ? (
              <p style={{ color: "#dc2626", textAlign: "center", padding: 24 }}>Failed to load prompts.</p>
            ) : library.length === 0 ? (
              <p style={{ color: "#64748b", textAlign: "center", padding: 24 }}>No saved prompts yet.</p>
            ) : library.map(p => (
              <div key={p._id} style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: "14px 16px", marginBottom: 10 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a", marginBottom: 4 }}>{p.roleName}</div>
                <div style={{ fontSize: 12, color: "#64748b", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginBottom: 10 }}>{(p.promptText || "").slice(0, 140)}…</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button onClick={() => navigator.clipboard.writeText(p.promptText).then(() => window.alert("Copied!"))} style={{ padding: "6px 12px", background: "#f1f5f9", color: "#374151", border: "none", borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>📋 Copy</button>
                  <button onClick={() => useInSchedule(p.promptText)} style={{ padding: "6px 12px", background: "#7c3aed", color: "#fff", border: "none", borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Use in Schedule →</button>
                  <button onClick={() => setEditingPrompt(p)} style={{ padding: "6px 12px", background: "#eff6ff", color: "#1d4ed8", border: "1px solid #bfdbfe", borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Edit</button>
                  <button onClick={async () => { if (!confirm(`Delete "${p.roleName}"?`)) return; await fetch(`${BASE}/api/prompts/${p._id}`, { method: "DELETE", headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } }); loadLibrary(); }} style={{ padding: "6px 12px", background: "#fef2f2", color: "#dc2626", border: "1px solid #fecaca", borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {editingPrompt && (
        <EditPromptModal
          prompt={editingPrompt}
          onClose={() => setEditingPrompt(null)}
          onSaved={() => { setEditingPrompt(null); loadLibrary(); }}
        />
      )}
    </>
  );
}
