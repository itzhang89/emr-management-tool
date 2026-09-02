import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { tauriClient } from "@/services/tauriClient";
import {
  applyDelta,
  applyToolEvent,
  bindChatStreamEvents,
  emptyStreamingTurn,
  type StreamingTurn
} from "@/services/chatStream";
import type {
  ChatMessage,
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
        // An error ends the turn, so the streaming bubble is dropped rather than
        // left showing "Thinking" beside its own copy of the message: the
        // assistant row was already persisted carrying this error, and the
        // refreshed transcript renders it once.
        setStreaming(null);
        void queryClient.invalidateQueries({ queryKey: chatMessagesKey(event.sessionId) });
        void queryClient.invalidateQueries({ queryKey: CHAT_SESSIONS_KEY });
      },
      // Not filtered by session: a conversation can be named while the user has
      // already switched away, and the sidebar shows every session's title.
      onTitle: () => {
        void queryClient.invalidateQueries({ queryKey: CHAT_SESSIONS_KEY });
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
      } catch (error) {
        // A rejection can reach us without a chat:error/chat:done (a failure that
        // happens before the streaming loop), so clear the turn here — otherwise
        // the "Thinking" bubble would spin forever under a toast.
        setStreaming(null);
        throw error;
      } finally {
        setSending(false);
        void queryClient.invalidateQueries({ queryKey: chatMessagesKey(sessionId) });
        void queryClient.invalidateQueries({ queryKey: CHAT_SESSIONS_KEY });
      }
    },
    [queryClient, sessionId]
  );

  /**
   * Stops the in-flight turn.
   *
   * The streaming state is cleared here rather than waiting for `chat:done`: the
   * whole point of the button is that the turn looks finished immediately, and a
   * request the backend is still unwinding would otherwise leave "Thinking" on
   * screen with no way to press Stop again. The transcript is refreshed so the
   * partial reply the backend persisted takes over.
   */
  const cancel = useCallback(async () => {
    if (!sessionId) return;
    setStreaming(null);
    setSending(false);
    try {
      await tauriClient.chatCancel(sessionId);
    } finally {
      void queryClient.invalidateQueries({ queryKey: chatMessagesKey(sessionId) });
    }
  }, [queryClient, sessionId]);

  // Each mutation re-runs the send plumbing afterwards so the stream events
  // update the transcript the same way an ordinary send does. The persisted rows
  // are invalidated on completion.
  const deleteMessage = useCallback(
    async (messageId: string) => {
      if (!sessionId) return;
      await tauriClient.deleteChatMessage(sessionId, messageId);
      void queryClient.invalidateQueries({ queryKey: chatMessagesKey(sessionId) });
    },
    [queryClient, sessionId]
  );

  const deleteFrom = useCallback(
    async (messageId: string) => {
      if (!sessionId) return;
      await tauriClient.deleteChatMessagesFrom(sessionId, messageId);
      void queryClient.invalidateQueries({ queryKey: chatMessagesKey(sessionId) });
    },
    [queryClient, sessionId]
  );

  const regenerate = useCallback(
    async (messageId: string, modelId?: string) => {
      if (!sessionId) return;
      setSending(true);
      // Reuse the streaming turn so the reply shows a thinking indicator while
      // the model re-answers; regeneration re-emits the usual chat events.
      setStreaming(emptyStreamingTurn(sessionId));
      const key = chatMessagesKey(sessionId);
      const previous = queryClient.getQueryData<ChatMessage[]>(key);
      // The backend discards the old reply and everything after it before
      // re-answering; mirror that in the cache so the stale tail does not linger
      // under the new "Thinking" bubble until chat:done refetches.
      const targetSeq = previous?.find((message) => message.id === messageId)?.seq;
      if (previous && targetSeq != null) {
        queryClient.setQueryData(
          key,
          previous.filter((message) => message.seq < targetSeq)
        );
      }
      try {
        await tauriClient.regenerateChatMessage(sessionId, messageId, modelId);
      } catch (error) {
        if (previous) queryClient.setQueryData(key, previous); // roll back
        setStreaming(null);
        throw error;
      } finally {
        setSending(false);
        void queryClient.invalidateQueries({ queryKey: key });
        void queryClient.invalidateQueries({ queryKey: CHAT_SESSIONS_KEY });
      }
    },
    [queryClient, sessionId]
  );

  const edit = useCallback(
    async (messageId: string, newText: string) => {
      if (!sessionId) return;
      setSending(true);
      setStreaming(emptyStreamingTurn(sessionId));
      const key = chatMessagesKey(sessionId);
      const previous = queryClient.getQueryData<ChatMessage[]>(key);
      // Optimistically adopt the new wording and drop everything after the edited
      // question, so the transcript reads "re-answering" at once instead of
      // showing the old reply under the new text until the turn finishes.
      const targetSeq = previous?.find((message) => message.id === messageId)?.seq;
      if (previous && targetSeq != null) {
        queryClient.setQueryData(
          key,
          previous
            .map((message) =>
              message.id === messageId ? { ...message, content: newText.trim() } : message
            )
            .filter((message) => message.seq <= targetSeq)
        );
      }
      try {
        await tauriClient.updateChatMessage(sessionId, messageId, newText);
      } catch (error) {
        if (previous) queryClient.setQueryData(key, previous); // roll back
        setStreaming(null);
        throw error;
      } finally {
        setSending(false);
        void queryClient.invalidateQueries({ queryKey: key });
        void queryClient.invalidateQueries({ queryKey: CHAT_SESSIONS_KEY });
      }
    },
    [queryClient, sessionId]
  );

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
      deleteMessage,
      deleteFrom,
      regenerate,
      edit,
      clearContext
    }),
    [
      messages.data,
      messages.isLoading,
      streaming,
      sending,
      send,
      cancel,
      deleteMessage,
      deleteFrom,
      regenerate,
      edit,
      clearContext
    ]
  );
}
