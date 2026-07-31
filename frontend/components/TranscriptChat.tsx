"use client";

interface Props {
  transcript: string;
  contactName?: string;
}

export default function TranscriptChat({ transcript, contactName }: Props) {
  const lines = transcript.split("\n").filter((l) => l.trim());
  const initial = contactName?.charAt(0)?.toUpperCase() || "U";

  return (
    <div className="space-y-3 py-2">
      {lines.map((line, i) => {
        const isAgent =
          line.toLowerCase().startsWith("assistant:") ||
          line.toLowerCase().startsWith("agent:");
        const isUser =
          line.toLowerCase().startsWith("user:") ||
          line.toLowerCase().startsWith("candidate:") ||
          line.toLowerCase().startsWith("human:");

        const text = line.replace(/^(assistant|agent|user|candidate|human):\s*/i, "");
        if (!text.trim()) return null;

        if (isAgent) {
          return (
            <div key={i} className="flex gap-2.5 items-end max-w-[85%]">
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-accent to-accent-2 flex items-center justify-center flex-shrink-0 text-[10px] font-bold text-on-accent">
                AI
              </div>
              <div className="bg-surface-1 border border-outline/10 rounded-2xl rounded-bl-md px-4 py-2.5">
                <p className="text-sm text-fg leading-relaxed">{text}</p>
              </div>
            </div>
          );
        }

        if (isUser) {
          return (
            <div key={i} className="flex gap-2.5 items-end justify-end max-w-[85%] ml-auto">
              <div className="bg-gradient-to-br from-accent to-accent-2 rounded-2xl rounded-br-md px-4 py-2.5">
                <p className="text-sm text-on-accent leading-relaxed">{text}</p>
              </div>
              <div className="w-7 h-7 rounded-full bg-surface-3 flex items-center justify-center flex-shrink-0 text-[10px] font-bold text-fg-muted">
                {initial}
              </div>
            </div>
          );
        }

        // Continuation or unknown format
        return (
          <div key={i} className="px-10">
            <p className="text-xs text-fg-muted/60 italic">{line}</p>
          </div>
        );
      })}
    </div>
  );
}
