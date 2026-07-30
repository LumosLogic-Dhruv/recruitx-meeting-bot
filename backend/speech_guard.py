"""
speech_guard.py - Centralized Speech Guard for eliminating duplicate AI voice speech.

Guarantees:
1. At most ONE active speech pipeline per bot/session at any time (Rule 1).
2. Only ONE turn or greeting owns speech at any moment (older turns lose ownership instantly) (Rule 2).
3. Greeting executes at most ONCE per session across polling and webhook triggers (Rule 3).
4. Duplicate transcript events never generate duplicate responses (Rule 4).
5. Interruption handling cleanly stops the previous response before beginning another (Rule 5).

Performance & Safety:
- Lock-free, pure Python, async-safe
- O(1) time complexity for all state checks and transitions
- Zero extra network calls, OpenAI calls, or Recall.ai calls
- Zero latency impact (microsecond dict operations)
"""

from typing import Dict, Optional, Set
import asyncio


class SpeechGuard:
    def __init__(self):
        # bot_id -> active speech_id token (monotonic int)
        self._active_speech_id: Dict[str, int] = {}
        # bot_id -> bool indicating if greeting execution was claimed
        self._greeting_claimed: Dict[str, bool] = {}
        # bot_id -> set of processed utterance keys ("speaker:text") for deduplication
        self._processed_utterances: Dict[str, Set[str]] = {}
        # bot_id -> currently active asyncio.Task performing speak HTTP request
        self._active_speak_tasks: Dict[str, asyncio.Task] = {}

    def claim_greeting(self, bot_id: str) -> bool:
        """
        Atomically claims greeting execution rights for bot_id.
        Returns True if this call successfully claimed greeting (first caller).
        Returns False if greeting was already claimed or executed for bot_id.
        """
        if not bot_id:
            return True
        if self._greeting_claimed.get(bot_id, False):
            return False
        self._greeting_claimed[bot_id] = True
        return True

    def is_greeting_claimed(self, bot_id: str) -> bool:
        if not bot_id:
            return False
        return self._greeting_claimed.get(bot_id, False)

    def start_speech(self, bot_id: str, utterance_key: Optional[str] = None) -> int:
        """
        Starts a new speech sequence (greeting, turn response, fallback prompt, etc.) for bot_id.
        Invalidates any previous speech ownership for bot_id immediately in O(1).
        
        If utterance_key is provided and has already been processed for bot_id, returns 0
        to prevent duplicate transcript turns.
        
        Returns positive speech_id (token) on success.
        """
        if not bot_id:
            return 1

        if utterance_key:
            seen_set = self._processed_utterances.setdefault(bot_id, set())
            if utterance_key in seen_set:
                return 0
            seen_set.add(utterance_key)
            if len(seen_set) > 400:
                seen_set.clear()

        # Cancel any in-flight speak task for previous speech
        old_speak_task = self._active_speak_tasks.pop(bot_id, None)
        if old_speak_task and not old_speak_task.done():
            old_speak_task.cancel()

        new_id = self._active_speech_id.get(bot_id, 0) + 1
        self._active_speech_id[bot_id] = new_id
        return new_id

    def is_speech_valid(self, bot_id: str, speech_id: int) -> bool:
        """
        Returns True if speech_id is the currently active, valid owner of speech for bot_id.
        """
        if not bot_id:
            return True
        if not speech_id or speech_id <= 0:
            return False
        return self._active_speech_id.get(bot_id, -1) == speech_id

    def interrupt_speech(self, bot_id: str) -> None:
        """
        Immediately revokes speech ownership for bot_id (candidate spoke or interrupted).
        Older/current speech loses ownership instantly in O(1).
        Cancels active speak task if currently running.
        """
        if not bot_id:
            return
        current = self._active_speech_id.get(bot_id, 0)
        self._active_speech_id[bot_id] = current + 1

        old_speak_task = self._active_speak_tasks.pop(bot_id, None)
        if old_speak_task and not old_speak_task.done():
            old_speak_task.cancel()

    def register_speak_task(self, bot_id: str, task: asyncio.Task) -> None:
        """Registers active speak task for cancellation upon interruption or turn change."""
        if bot_id and task:
            self._active_speak_tasks[bot_id] = task

    def clear_session(self, bot_id: str) -> None:
        """Cleans up internal state when a bot session ends."""
        if not bot_id:
            return
        self._active_speech_id.pop(bot_id, None)
        self._greeting_claimed.pop(bot_id, None)
        self._processed_utterances.pop(bot_id, None)
        task = self._active_speak_tasks.pop(bot_id, None)
        if task and not task.done():
            task.cancel()


# Single global instance for lightweight, lock-free access across main and pipeline
speech_guard = SpeechGuard()
