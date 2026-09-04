import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
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
 * Drives the conversation the user is looking at: sends messages, tracks that
 * session's in-flight assistant turn from stream events, and refreshes the
 * persisted transcript when the exchange ends.
 *
 * Turns live outside the react-query cache — writing every token into the cache
 * would re-render the whole message list per delta. They are also kept per
 * session rather than as a single value, so a conversation that is still
 * answering keeps generating when the user switches to another one; its turn
 * accumulates in the background and is simply shown again when it becomes the
 * active session again. On `chat:done` the stored rows become the truth and the
 * turn clears.
 */
export function useChatConversation(sessionId: string | null) {
  const queryClient = useQueryClient();
  const messages = useChatMessages(sessionId);
  // One in-flight turn per session, so switching away from a conversation that is
  // answering does not stop the request or lose its progress — generation runs in
  // the background and its turn keeps accumulating here until `chat:done`. The
  // map lives in a ref so tokens from a background conversation do not re-render
  // the transcript the user is actually reading; the render bump fires only when
  // the *active* session's own turn changes.
  const turnsRef = useRef<Record<string, StreamingTurn>>({});
  const [, bump] = useReducer((value: number) => value + 1, 0);
  // Which session is currently sending, so an unrelated conversation's composer
  // does not show the spinner or lock itself while another answers.
  const [sendingSessionId, setSendingSessionId] = useState<string | null>(null);

  const streaming = sessionId ? (turnsRef.current[sessionId] ?? null) : null;
  const sending = sessionId != null && sendingSessionId === sessionId;

  /** Records a fresh empty turn for a send we are about to start. */
  const startTurn = (sid: string) => {
    turnsRef.current[sid] = emptyStreamingTurn(sid);
    bump();
  };
  /** Drops a session's turn, forcing a render when it is the one on screen. */
  const clearTurn = (sid: string) => {
    if (sid in turnsRef.current) {
      delete turnsRef.current[sid];
      bump();
    }
  };

  // Handlers read the current session from a ref so the subscription is bound
  // once rather than torn down and rebuilt on every session switch. Every event
  // is applied to its own session's turn regardless of which conversation is on
  // screen; only the active one triggers a re-render.
  const sessionRef = useRef(sessionId);
  sessionRef.current = sessionId;

  useEffect(() => {
    let dispose = () => {};
    let cancelled = false;

    const updateTurn = (
      eventSessionId: string,
      apply: (turn?: StreamingTurn) => StreamingTurn
    ) => {
      const current = turnsRef.current[eventSessionId];
      turnsRef.current[eventSessionId] = apply(current);
      if (sessionRef.current === eventSessionId) bump();
    };

    void bindChatStreamEvents({
      onDelta: (event) =>
        updateTurn(event.sessionId, (turn) =>
          applyDelta(turn ?? emptyStreamingTurn(event.sessionId), event)
        ),
      onTool: (event) =>
        updateTurn(event.sessionId, (turn) =>
          applyToolEvent(turn ?? emptyStreamingTurn(event.sessionId), event)
        ),
      onDone: (event) => {
        delete turnsRef.current[event.sessionId];
        if (sessionRef.current === event.sessionId) bump();
        // The persisted rows now hold everything the streaming turn showed; the
        // message list is refreshed even for a background conversation so it is
        // current when the user switches back.
        void queryClient.invalidateQueries({ queryKey: chatMessagesKey(event.sessionId) });
        void queryClient.invalidateQueries({ queryKey: CHAT_SESSIONS_KEY });
      },
      onError: (event) => {
        // An error ends the turn, so the streaming bubble is dropped rather than
        // left showing "Thinking" beside its own copy of the message: the
        // assistant row was already persisted carrying this error, and the
        // refreshed transcript renders it once.
        delete turnsRef.current[event.sessionId];
        if (sessionRef.current === event.sessionId) bump();
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

  const send = useCallback(
    async (text: string) => {
      if (!sessionId) return;
      setSendingSessionId(sessionId);
      // Shown immediately so the user's message and a thinking indicator appear
      // before the first token arrives.
      startTurn(sessionId);
      try {
        await tauriClient.chatSend(sessionId, text);
      } catch (error) {
        // A rejection can reach us without a chat:error/chat:done (a failure that
        // happens before the streaming loop), so clear the turn here — otherwise
        // the "Thinking" bubble would spin forever under a toast.
        clearTurn(sessionId);
        throw error;
      } finally {
        setSendingSessionId((current) => (current === sessionId ? null : current));
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
    clearTurn(sessionId);
    setSendingSessionId((current) => (current === sessionId ? null : current));
    try {
      await tauriClient.chatCancel(sessionId);
    } finally {
      void queryClient.invalidateQueries({ queryKey: chatMessagesKey(sessionId) });
    }
  }, [queryClient, sessionId]);

  // Each mutation re-runs the send plumbing afterwards so the stream events
  // update the transcript the same way an ordinary send does. The persisted rows
  // are invalidated on completion.
  /**
   * Switches which recorded answer of a message is displayed. No model call —
   * the backend copies that version's columns onto the row, so the transcript
   * and the next request's context both change at once.
   */
  const switchVersion = useCallback(
    async (messageId: string, versionId: string) => {
      if (!sessionId) return;
      await tauriClient.setChatMessageVersion(sessionId, messageId, versionId);
      void queryClient.invalidateQueries({ queryKey: chatMessagesKey(sessionId) });
    },
    [queryClient, sessionId]
  );

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
      setSendingSessionId(sessionId);
      // Reuse the streaming turn so the reply shows a thinking indicator while
      // the model re-answers; regeneration re-emits the usual chat events.
      startTurn(sessionId);
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
        clearTurn(sessionId);
        throw error;
      } finally {
        setSendingSessionId((current) => (current === sessionId ? null : current));
        void queryClient.invalidateQueries({ queryKey: key });
        void queryClient.invalidateQueries({ queryKey: CHAT_SESSIONS_KEY });
      }
    },
    [queryClient, sessionId]
  );

  const edit = useCallback(
    async (messageId: string, newText: string) => {
      if (!sessionId) return;
      setSendingSessionId(sessionId);
      startTurn(sessionId);
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
        clearTurn(sessionId);
        throw error;
      } finally {
        setSendingSessionId((current) => (current === sessionId ? null : current));
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
      switchVersion,
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
      switchVersion,
      edit,
      clearContext
    ]
  );
}
