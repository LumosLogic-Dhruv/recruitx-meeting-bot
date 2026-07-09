Issue 1 — Tone inconsistency

  - temperature 0.85 → 0.5 — high temperature was causing unpredictable energy in LLM responses (sometimes
  enthusiastic, sometimes flat)
  - ElevenLabs stability 0.52 → 0.65 — the voice was drifting in pitch/energy turn-to-turn; higher stability locks it
  to a consistent delivery
  - New rule 3b in prompt — explicitly instructs the LLM to hold a steady neutral tone regardless of what the candidate
  says

  ---
  Issue 2 — Understanding through noise

  - Rule 8 rewritten — now explicitly says "never pretend you understood" and instructs the bot to ask "could you say  
  that again?" when the transcript is garbled/short
  - Rule 9 strengthened — gives concrete examples of STT substitutions ("one stick" → "MERN") so the LLM can infer     
  meaning rather than echoing garbage back

  ---
  Issue 3 — Stopping silently

  - Empty LLM response fallback — if the LLM produces nothing (network hiccup, token issue), bot now says "Sorry, could
  you say that again?" instead of going silent
  - _reprompt_if_silent — after a short interruption text gets discarded, a 5-second watchdog task runs; if no speech  
  from either side, it says "Please go ahead." to break the dead silence

  ---
  Issue 4 — Latency 4-5s → target 2-3s

  - Removed _clean_transcript from the critical path — this was a full serial LLM call (~300-500ms) running before the 
  main LLM even started. Removed it. The main LLM already handles STT artifacts via rules 8 and 9.
  - Eval task wait 1.5s → 0.2s — in rare cases where the background eval is slow, the previous code would block the    
  next turn for up to 1.5s. Now it gives up after 0.2s.

  New latency budget: silence timer (0.8-1.2s) + eval wait (max 0.2s) + LLM first token (~0.3s) + TTS (~0.1s) =        
  ~1.4-1.9s typical.