# Analysis: `bot-server` vs. `new-caller-x`

This document outlines why the `new-caller-x` system's interview accuracy, flow, and realism feel significantly better than the current `bot-server` implementation, and provides a comparative analysis of their architectures.

---

## 1. Core Architectural Differences

| Feature | `bot-server` (Current) | `new-caller-x` |
| :--- | :--- | :--- |
| **Platform Integration** | Recall.ai (Meeting/Video Bot joiner) | Bolna API (Telephony / SIP Trunk Outbound Caller) |
| **Orchestration Layer** | Manual Python async loops checking for silence, managing state, and sending audio blocks piecemeal. | Handled entirely by Bolna's highly-optimized backend engine. |
| **Input/Output** | Webhooks via Recall.ai, downloading chunks, matching transcriptions to audio bytes. | Direct, continuous SIP telephony streams. |
| **Use Case** | Video meeting participation (Zoom/Meet/Teams). | Fast, direct phone interviews. |

## 2. Why `new-caller-x` Feels "Perfect" and More Human

### A. Sub-Millisecond Optimizations
In `new-caller-x`, the task specifies a **parallel execution toolchain**: 
```json
"toolchain": {
    "execution": "parallel",
    "pipelines": [["transcriber", "llm", "synthesizer"]]
}
```
This means Bolna handles the routing of transcripts to the LLM, and LLM text to ElevenLabs natively on their C++/Rust backend servers. In `bot-server`, the Python app had to wait for the Deepgram webhook, process the text, hit the OpenAI API, stream the text into ElevenLabs manually over python async sockets, and then send the audio bytes to Recall.ai. **Eliminating the middleman network hops dramatically reduces Time-To-First-Audio (TTFA).**

### B. Aggressive Endpointing
`new-caller-x` configures Deepgram `nova-3` with an **endpointing of 250ms**. 
Our previous optimizations on `bot-server` reduced it from 1000ms to 500ms. Dropping to 250ms practically eliminates the awkward pause candidates feel before the bot answers. (Bolna's engine safely manages mid-sentence pauses without cutting the candidate off).

### C. Native Backchanneling
`new-caller-x` enables `"backchanneling": True`. This allows the AI to say "Hmm", "Yeah", "Right" natively while the user is speaking, making it feel exactly like a human recruiter listening. `bot-server` has no backchanneling capability.

### D. LLM & TTS Upgrades
- `new-caller-x` leverages `gpt-4.1-mini` (a faster optimized model parameter).
- `new-caller-x` utilizes a smaller buffer size (`buffer_size: 250`) on ElevenLabs, firing audio chunks to the SIP trunk much faster.

## 3. Evaluation & Scoring Approach

`bot-server` attempts an advanced but computationally heavy approach: sending the entire transcript (up to 15,000 tokens) back to the LLM to generate a scorecard at the end of the interview. 

`new-caller-x` uses a deterministic approach (`report_generator.py`):
1. **Keyword Extraction:** It uses Python Regex to scan the transcript for known technical terms (e.g., "Coroutines", "Room", "Hilt").
2. **Context Matching:** It grabs the specific sentences where those keywords are used as evidence.
3. **Algorithmic Scoring:** It assigns a 1-5 score based purely on the density and context of those keywords.

**Why this is better for a phone screening:** It is instant, never times out, prevents LLM hallucinations in scoring, and clearly outputs exactly what the candidate actually said about a specific technology.

## 4. Conclusion & Next Steps

The `new-caller-x` provides a vastly superior *conversational* experience because it removes the manual application-level orchestration of LLMs, STT, and TTS. It outsources the realtime audio streaming to a platform (Bolna) built explicitly for sub-500ms conversational AI over the phone.

**If you want to migrate these capabilities into `bot-server`:**
1. **Consider Bolna integration for Meetings:** Can bolna endpoints be pushed into Recall.ai meetings instead of phone calls?
2. **Implement Backchanneling:** If keeping manual orchestration, interject audio clips independently while the main streaming pipeline runs.
3. **Adopt Deterministic Scoring:** Migrate the scorecard system from pure LLM generation to Regex + Keyword density mapping (like `report_generator.py`).
