/**
 * Command Terminal — GPT-style natural language command interface
 *
 * A right-side slide-in panel that lets users type natural language commands
 * like "pause bad campaigns" and see structured AI responses + execution results.
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { useClient } from "@/lib/client-context";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Terminal,
  X,
  Send,
  Bot,
  User,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronRight,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────

interface ExecutionOutcome {
  campaignId: string;
  campaignName: string;
  action: string;
  success: boolean;
  message: string;
  previousValue?: any;
  newValue?: any;
}

interface ActionPlan {
  intent: string;
  platform: string;
  filters: any[];
  action: { type: string; parameters: Record<string, any> };
  execution_plan: string[];
  strategic_rationale: string;
  risk_checks: string[];
}

interface AICommandResponse {
  humanResponse: string;
  actionJson: ActionPlan | null;
  executionResults: ExecutionOutcome[];
  safetyWarnings: string[];
  requiresConfirmation: boolean;
  terminalResponse?: {
    diagnosis: string[];
    layerAnalysis: string[];
    solutions: string[];
    expectedOutcome: string[];
    text: string;
  };
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  response?: AICommandResponse;
  loading?: boolean;
}

// ─── Sub-components ───────────────────────────────────────────────

function ExecutionResultCard({ results, warnings }: { results: ExecutionOutcome[]; warnings: string[] }) {
  const [expanded, setExpanded] = useState(false);
  const succeeded = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  if (results.length === 0 && warnings.length === 0) return null;

  return (
    <div className="mt-2 rounded-lg border border-border/40 bg-background/50 text-xs overflow-hidden">
      {/* Summary row */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-muted/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          {succeeded > 0 && (
            <span className="flex items-center gap-1 text-emerald-500">
              <CheckCircle2 className="w-3 h-3" /> {succeeded} succeeded
            </span>
          )}
          {failed > 0 && (
            <span className="flex items-center gap-1 text-red-400">
              <XCircle className="w-3 h-3" /> {failed} failed
            </span>
          )}
          {warnings.length > 0 && (
            <span className="flex items-center gap-1 text-amber-400">
              <AlertTriangle className="w-3 h-3" /> {warnings.length} warnings
            </span>
          )}
        </div>
        {expanded ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="border-t border-border/30 px-3 py-2 space-y-1.5">
          {results.map((r, i) => (
            <div key={i} className="flex items-start gap-2">
              {r.success
                ? <CheckCircle2 className="w-3 h-3 text-emerald-500 mt-0.5 shrink-0" />
                : <XCircle className="w-3 h-3 text-red-400 mt-0.5 shrink-0" />}
              <div>
                <span className="font-medium text-foreground/80">{r.campaignName}</span>
                <span className="text-muted-foreground ml-1">— {r.message}</span>
                {r.previousValue !== undefined && r.newValue !== undefined && (
                  <div className="text-muted-foreground mt-0.5">
                    {JSON.stringify(r.previousValue)} → {JSON.stringify(r.newValue)}
                  </div>
                )}
              </div>
            </div>
          ))}
          {warnings.map((w, i) => (
            <div key={`w-${i}`} className="flex items-start gap-2 text-amber-400/80">
              <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
              <span>{w}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ActionPlanChip({ actionJson }: { actionJson: ActionPlan }) {
  const typeColor: Record<string, string> = {
    pause: "bg-red-500/15 text-red-400 border-red-500/25",
    scale: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
    adjust_budget: "bg-blue-500/15 text-blue-400 border-blue-500/25",
    unpause: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
    clarify: "bg-amber-500/15 text-amber-400 border-amber-500/25",
  };
  const color = typeColor[actionJson.action.type] || "bg-muted text-muted-foreground border-border";

  return (
    <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
      <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0 border font-mono uppercase tracking-wide", color)}>
        {actionJson.action.type}
      </Badge>
    </div>
  );
}

function TerminalSection({ title, lines }: { title: string; lines: string[] }) {
  if (!lines.length) return null;

  return (
    <div className="rounded-xl border border-border/30 bg-background/40 px-3 py-2">
      <p className="text-[10px] font-black uppercase tracking-[0.16em] text-violet-400">{title}</p>
      <div className="mt-2 space-y-1.5">
        {lines.map((line, index) => (
          <p key={`${title}-${index}`} className="text-[12px] leading-relaxed text-foreground/90 whitespace-pre-wrap">
            {line}
          </p>
        ))}
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  const terminalResponse = message.response?.terminalResponse;

  return (
    <div className={cn("flex gap-2.5", isUser ? "flex-row-reverse" : "flex-row")}>
      {/* Avatar */}
      <div className={cn(
        "flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center mt-0.5",
        isUser ? "bg-primary/20 text-primary" : "bg-violet-500/20 text-violet-400"
      )}>
        {isUser ? <User className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5" />}
      </div>

      {/* Content */}
      <div className={cn("flex-1 min-w-0", isUser ? "items-end" : "items-start", "flex flex-col")}>
        {message.loading ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm px-3 py-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span className="text-xs">Mojo is thinking…</span>
          </div>
        ) : (
          <div className={cn(
            "rounded-2xl px-3.5 py-2.5 max-w-[85%] text-sm leading-relaxed",
            isUser
              ? "bg-primary text-primary-foreground rounded-tr-sm"
              : "bg-muted/60 text-foreground rounded-tl-sm border border-border/30"
          )}>
            {!isUser && terminalResponse ? (
              <div className="space-y-3">
                <TerminalSection title="1. Diagnosis" lines={terminalResponse.diagnosis} />
                <TerminalSection title="2. Layer Analysis" lines={terminalResponse.layerAnalysis} />
                <TerminalSection title="3. Solutions" lines={terminalResponse.solutions} />
                <TerminalSection title="4. Expected Outcome" lines={terminalResponse.expectedOutcome} />
              </div>
            ) : (
              <p className="whitespace-pre-wrap text-[13px]">{message.content}</p>
            )}

            {/* Action plan chip (for assistant messages) */}
            {!isUser && message.response?.actionJson && message.response.actionJson.action.type !== "clarify" && (
              <ActionPlanChip actionJson={message.response.actionJson} />
            )}
          </div>
        )}

        {/* Execution results below the bubble */}
        {!isUser && message.response && (
          <div className="w-full max-w-[85%]">
            <ExecutionResultCard
              results={message.response.executionResults}
              warnings={message.response.safetyWarnings}
            />
          </div>
        )}

        {/* Timestamp */}
        {!message.loading && (
          <span className="text-[10px] text-muted-foreground mt-1 px-1">
            {message.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Suggested Commands ───────────────────────────────────────────

const SUGGESTED_COMMANDS = [
  "pause all losers",
  "scale winners by 20%",
  "pause campaigns spending but no leads",
  "fix learning limited campaigns",
  "pause high CPL campaigns",
  "add top negative keywords",
];

// ─── Main Terminal Component ──────────────────────────────────────

interface CommandTerminalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function CommandTerminal({ isOpen, onClose }: CommandTerminalProps) {
  const { activeClientId, activePlatform } = useClient();
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      content: "Hi! I'm Mojo, your AI performance agent. Tell me what to do with your campaigns in plain English.\n\nTry: \"pause bad campaigns\" or \"scale winners\"",
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Focus input when terminal opens
  useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 100);
  }, [isOpen]);

  const sendCommand = useCallback(async (cmd: string) => {
    const trimmed = cmd.trim();
    if (!trimmed || isLoading) return;

    const userMsgId = `user-${Date.now()}`;
    const assistantMsgId = `ai-${Date.now()}`;

    // Add user message
    setMessages((prev) => [
      ...prev,
      {
        id: userMsgId,
        role: "user",
        content: trimmed,
        timestamp: new Date(),
      },
      // Placeholder loading bubble
      {
        id: assistantMsgId,
        role: "assistant",
        content: "",
        timestamp: new Date(),
        loading: true,
      },
    ]);
    setInput("");
    setIsLoading(true);

    try {
      const res = await apiRequest("POST", "/api/ai/command", {
        command: trimmed,
        clientId: activeClientId || "amara",
        platform: (activePlatform || "meta") as "meta" | "google",
        provider: "auto",
      });

      const data: AICommandResponse = await res.json();

      // Replace loading bubble with real response
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId
            ? {
                ...m,
                content: data.humanResponse || "Done.",
                loading: false,
                response: data,
              }
            : m
        )
      );
    } catch (err: any) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId
            ? {
                ...m,
                content: `Error: ${err.message || "Something went wrong. Please try again."}`,
                loading: false,
              }
            : m
        )
      );
    } finally {
      setIsLoading(false);
    }
  }, [activeClientId, activePlatform, isLoading]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendCommand(input);
    }
  };

  return (
    <>
      {/* Backdrop (mobile) */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-40 md:hidden"
          onClick={onClose}
        />
      )}

      {/* Terminal Panel */}
      <div
        className={cn(
          "fixed top-0 right-0 h-screen z-50 flex flex-col",
          "w-full sm:w-[420px] max-w-full",
          "bg-background border-l border-border/50 shadow-2xl",
          "transition-transform duration-300 ease-in-out",
          isOpen ? "translate-x-0" : "translate-x-full"
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/50 bg-background/95 backdrop-blur-sm shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-violet-500/20 flex items-center justify-center">
              <Zap className="w-3.5 h-3.5 text-violet-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold leading-none">Mojo Terminal</h2>
              <p className="text-[10px] text-muted-foreground mt-0.5 leading-none">
                Instant command execution
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-violet-500/30 text-violet-400 bg-violet-500/10">
              AI
            </Badge>
            <Button size="icon" variant="ghost" onClick={onClose} aria-label="Close terminal" className="h-7 w-7">
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Messages */}
        <ScrollArea className="flex-1 px-4">
          <div className="py-4 space-y-4">
            {messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))}
            <div ref={bottomRef} />
          </div>
        </ScrollArea>

        {/* Suggested commands — shown only when empty-ish history */}
        {messages.length <= 1 && (
          <div className="px-4 pb-2 shrink-0">
            <p className="text-[10px] text-muted-foreground mb-2 uppercase tracking-wide font-medium">Quick commands</p>
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTED_COMMANDS.map((cmd) => (
                <button
                  key={cmd}
                  onClick={() => sendCommand(cmd)}
                  disabled={isLoading}
                  className="text-[11px] px-2.5 py-1 rounded-full border border-border/60 bg-muted/30 hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                >
                  {cmd}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Input */}
        <div className="px-4 pb-4 pt-2 shrink-0 border-t border-border/30">
          <div className="flex items-center gap-2 bg-muted/40 rounded-xl border border-border/50 px-3 py-2 focus-within:border-violet-500/50 focus-within:bg-muted/60 transition-colors">
            <Terminal className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a command… (e.g. pause bad campaigns)"
              disabled={isLoading}
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60 text-foreground min-w-0"
            />
            <Button
              size="icon"
              onClick={() => sendCommand(input)}
              disabled={!input.trim() || isLoading}
              aria-label={isLoading ? "Sending command" : "Send command"}
              className="h-6 w-6 rounded-lg bg-violet-500 hover:bg-violet-600 text-white shrink-0 disabled:opacity-40"
            >
              {isLoading ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Send className="w-3 h-3" />
              )}
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1.5 text-center">
            Powered by Mojo AdCortex · 4-Layer Intelligence
          </p>
        </div>
      </div>
    </>
  );
}

// ─── Toggle Button (for use in App header) ───────────────────────

interface CommandTerminalToggleProps {
  onClick: () => void;
  isOpen: boolean;
}

export function CommandTerminalToggle({ onClick, isOpen }: CommandTerminalToggleProps) {
  return (
    <Button
      size="sm"
      variant={isOpen ? "default" : "outline"}
      onClick={onClick}
      aria-label={isOpen ? "Close Mojo Terminal" : "Open Mojo Terminal"}
      className={cn(
        "gap-1.5 h-8 px-3 text-xs font-bold",
        isOpen
          ? "bg-primary hover:bg-[#f5c723] border-primary text-primary-foreground shadow-lg shadow-primary/20"
          : "border-border/60 hover:border-primary/50 hover:text-primary transition-all duration-200"
      )}
    >
      <Terminal className="w-3.5 h-3.5" />
      <span className="hidden sm:inline uppercase tracking-wider">Mojo Terminal</span>
    </Button>
  );
}
