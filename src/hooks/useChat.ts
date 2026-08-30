import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { tauriClient } from "@/services/tauriClient";
import {
  applyDelta,
  applyError,
  applyToolEvent,
  bindChatStreamEvents,
  emptyStreamingTurn,
  type StreamingTurn
} from "@/services/chatStream";
import type {
  CreateChatAssistantRequest,
  CreateChatSessionRequest,
  UpdateChatAssistantRequest,
  UpdateChatSessionRequest
} from "@/types/domain";

export const CHAT_ASSISTANTS_KEY = ["chat-assistants"] as const;
export const CHAT_SESSIONS_KEY = ["chat-sessions"] as const;
export const chatMessagesKey = (sessionId: string) => ["chat-messages", sessionId] as const;

export function useChatAssistants() {
  return useQuery({
    queryKey: CHAT_ASSISTANTS_KEY,
    queryFn: () => tauriClient.listChatAssistants()
  });
}

export function useChatSessions() {
  return useQuery({
    queryKey: CHAT_SESSIONS_KEY,
    queryFn: () => tauriClient.listChatSessions()
  });
}

export function useChatMessages(sessionId: string | null) {
  return useQuery({
    queryKey: chatMessagesKey(sessionId ?? ""),
    queryFn: () => tauriClient.listChatMessages(sessionId!),
    enabled: Boolean(sessionId)
  });
}

function useAssistantMutation<TArgs, TResult>(mutationFn: (args: TArgs) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CHAT_ASSISTANTS_KEY });
      // Deleting an assistant takes its sessions with it, so both lists refresh.
      void queryClient.invalidateQueries({ queryKey: CHAT_SESSIONS_KEY });
    }
  });
}

export function useCreateChatAssistant() {
  return useAssistantMutation((request: CreateChatAssistantRequest) =>
    tauriClient.createChatAssistant(request)
  );
}

export function useUpdateChatAssistant() {
  return useAssistantMutation((request: UpdateChatAssistantRequest) =>
    tauriClient.updateChatAssistant(request)
  );
}

export function useDeleteChatAssistant() {
  return useAssistantMutation((id: string) => tauriClient.deleteChatAssistant(id));
}

function useSessionMutation<TArgs, TResult>(mutationFn: (args: TArgs) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CHAT_SESSIONS_KEY });
    }
  });
}

export function useCreateChatSession() {
  return useSessionMutation((request: CreateChatSessionRequest) =>
    tauriClient.createChatSession(request)
  );
}

export function useUpdateChatSession() {
  return useSessionMutation((request: UpdateChatSessionRequest) =>
    tauriClient.updateChatSession(request)
  );
}

export function useDeleteChatSession() {
  return useSessionMutation((id: string) => tauriClient.deleteChatSession(id));
}

export function useDeleteAllChatSessions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => tauriClient.deleteAllChatSessions(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CHAT_SESSIONS_KEY });
      void queryClient.invalidateQueries({ queryKey: ["chat-messages"] });
    }
  });
}

/**
 * Drives one session's conversation: sends messages, tracks the in-flight
 * assistant turn from stream events, and refreshes the persisted transcript when
 * the exchange ends.
 *
 * The streaming turn lives in React state rather than the query cache — writing
 * every token into the cache would re-render the whole message list per delta.
 * On `chat:done` the stored rows become the truth and the streaming turn clears.
 */
export function useChatConversation(sessionId: string | null) {
  const queryClient = useQueryClient();
  const messages = useChatMessages(sessionId);
  const [streaming, setStreaming] = useState<StreamingTurn | null>(null);
  const [sending, setSending] = useState(false);

  // Handlers read the current session from a ref so the subscription is bound
  // once rather than torn down and rebuilt on every session switch.
  const sessionRef = useRef(sessionId);
  sessionRef.current = sessionId;

  useEffect(() => {
    let dispose = () => {};
    let cancelled = false;

    const forCurrentSession = (eventSessionId: string) =>
      sessionRef.current !== null && eventSessionId === sessionRef.current;

    void bindChatStreamEvents({
      onDelta: (event) => {
        if (!forCurrentSession(event.sessionId)) return;
        setStreaming((turn) => applyDelta(turn ?? emptyStreamingTurn(event.sessionId), event));
      },
      onTool: (event) => {
        if (!forCurrentSession(event.sessionId)) return;
        setStreaming((turn) => applyToolEvent(turn ?? emptyStreamingTurn(event.sessionId), event));
      },
      onDone: (event) => {
        if (!forCurrentSession(event.sessionId)) return;
        setStreaming(null);
        // The persisted rows now hold everything the streaming turn showed.
        void queryClient.invalidateQueries({ queryKey: chatMessagesKey(event.sessionId) });
        void queryClient.invalidateQueries({ queryKey: CHAT_SESSIONS_KEY });
      },
      onError: (event) => {
        if (!forCurrentSession(event.sessionId)) return;
        setStreaming((turn) => applyError(turn ?? emptyStreamingTurn(event.sessionId), event));
      }
    }).then((unbind) => {
      if (cancelled) {
        unbind();
      } else {
        dispose = unbind;
      }
    });

    return () => {
      cancelled = true;
      dispose();
    };
  }, [queryClient]);

  // A session switch must not leave the previous conversation's partial turn on
  // screen under the new transcript.
  useEffect(() => {
    setStreaming(null);
  }, [sessionId]);

  const send = useCallback(
    async (text: string) => {
      if (!sessionId) return;
      setSending(true);
      // Shown immediately so the user's message and a thinking indicator appear
      // before the first token arrives.
      setStreaming(emptyStreamingTurn(sessionId));
      try {
        await tauriClient.chatSend(sessionId, text);
      } finally {
        setSending(false);
        void queryClient.invalidateQueries({ queryKey: chatMessagesKey(sessionId) });
        void queryClient.invalidateQueries({ queryKey: CHAT_SESSIONS_KEY });
      }
    },
    [queryClient, sessionId]
  );

  const cancel = useCallback(async () => {
    if (!sessionId) return;
    await tauriClient.chatCancel(sessionId);
  }, [sessionId]);

  const clearContext = useCallback(async () => {
    if (!sessionId) return false;
    const cleared = await tauriClient.clearChatContext(sessionId);
    if (cleared) {
      void queryClient.invalidateQueries({ queryKey: chatMessagesKey(sessionId) });
    }
    return cleared;
  }, [queryClient, sessionId]);

  return useMemo(
    () => ({
      messages: messages.data ?? [],
      isLoading: messages.isLoading,
      streaming,
      sending,
      send,
      cancel,
      clearContext
    }),
    [messages.data, messages.isLoading, streaming, sending, send, cancel, clearContext]
  );
}
