import { useMemo, useState } from "react";
import { Bot, Filter, MessageSquarePlus, Plus, Settings2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { accentClasses } from "@/components/ai/chat/accents";
import { cn } from "@/lib/utils";
import type { ChatAssistant, ChatSession } from "@/types/domain";

/**
 * Two levels: assistants (presets) with their conversations indented beneath.
 *
 * Filtering matches on both levels and keeps an assistant visible when one of
 * its sessions matches, so searching for a job id finds the conversation about
 * it without the user having to know which assistant it belongs to.
 */
export function AssistantSidebar({
  assistants,
  sessions,
  activeSessionId,
  onSelectSession,
  onAddAssistant,
  onEditAssistant,
  onDeleteAssistant,
  onNewSession,
  onDeleteSession
}: {
  assistants: ChatAssistant[];
  sessions: ChatSession[];
  activeSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  onAddAssistant: () => void;
  onEditAssistant: (assistant: ChatAssistant) => void;
  onDeleteAssistant: (assistant: ChatAssistant) => void;
  onNewSession: (assistantId: string) => void;
  onDeleteSession: (session: ChatSession) => void;
}) {
  const [filterVisible, setFilterVisible] = useState(false);
  const [filter, setFilter] = useState("");

  const groups = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return assistants
      .map((assistant) => {
        const own = sessions.filter((session) => session.assistantId === assistant.id);
        if (!needle) return { assistant, sessions: own, matched: true };

        const assistantMatches = assistant.name.toLowerCase().includes(needle);
        const matching = own.filter((session) => session.title.toLowerCase().includes(needle));
        return {
          assistant,
          // An assistant whose own name matches keeps all of its sessions.
          sessions: assistantMatches ? own : matching,
          matched: assistantMatches || matching.length > 0
        };
      })
      .filter((group) => group.matched);
  }, [assistants, sessions, filter]);

  return (
    <div className="flex min-h-0 flex-col gap-2 border-r pr-3">
      <div className="flex items-center justify-between gap-1">
        <Button type="button" variant="ghost" size="sm" onClick={onAddAssistant}>
          <Plus className="mr-1 size-3.5" />
          Assistant
        </Button>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label="Filter conversations"
              aria-pressed={filterVisible}
              onClick={() => {
                setFilterVisible((visible) => !visible);
                setFilter("");
              }}
            >
              <Filter className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Filter assistants and conversations</TooltipContent>
        </Tooltip>
      </div>

      {filterVisible && (
        <Input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter..."
          className="h-8 text-xs"
          autoFocus
        />
      )}

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
        {groups.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {filter ? "Nothing matches that filter." : "No assistants yet."}
          </p>
        ) : (
          groups.map(({ assistant, sessions: own }) => (
            <div key={assistant.id} className="space-y-1">
              <div className="group flex items-center gap-1.5">
                <span
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-full",
                    accentClasses(assistant.accent)
                  )}
                >
                  <Bot className="size-3" />
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{assistant.name}</span>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-6 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                      aria-label={`New conversation with ${assistant.name}`}
                      onClick={() => onNewSession(assistant.id)}
                    >
                      <MessageSquarePlus className="size-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>New conversation</TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-6 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                      aria-label={`Configure ${assistant.name}`}
                      onClick={() => onEditAssistant(assistant)}
                    >
                      <Settings2 className="size-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Configure</TooltipContent>
                </Tooltip>

                {/* The built-in assistant has no delete action — the backend
                    refuses, so offering the button would only produce an error. */}
                {!assistant.builtIn && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-6 shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100"
                        aria-label={`Delete ${assistant.name}`}
                        onClick={() => onDeleteAssistant(assistant)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Delete assistant</TooltipContent>
                  </Tooltip>
                )}
              </div>

              {own.length === 0 ? (
                <p className="pl-6 text-xs text-muted-foreground">No conversations yet.</p>
              ) : (
                <div className="space-y-0.5 pl-3">
                  {own.map((session) => (
                    <div key={session.id} className="group/session flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => onSelectSession(session.id)}
                        aria-current={session.id === activeSessionId}
                        className={cn(
                          "min-w-0 flex-1 truncate rounded px-2 py-1 text-left text-xs transition-colors",
                          session.id === activeSessionId
                            ? "bg-accent text-accent-foreground"
                            : "hover:bg-muted/60"
                        )}
                      >
                        {session.title}
                      </button>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-6 shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover/session:opacity-100 focus-visible:opacity-100"
                            aria-label={`Delete conversation ${session.title}`}
                            onClick={() => onDeleteSession(session)}
                          >
                            <Trash2 className="size-3" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Delete conversation</TooltipContent>
                      </Tooltip>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
