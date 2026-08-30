import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LlmSettingsPanel } from "./LlmSettingsPanel";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { LlmProvider } from "@/types/domain";

const listLlmProviders = vi.fn();
const createLlmProvider = vi.fn();
const updateLlmProvider = vi.fn();
const deleteLlmProvider = vi.fn();
const createLlmEndpoint = vi.fn();
const updateLlmEndpoint = vi.fn();
const deleteLlmEndpoint = vi.fn();
const testLlmEndpoint = vi.fn();
const syncLlmModels = vi.fn();
const addLlmModels = vi.fn();
const updateLlmModel = vi.fn();
const deleteLlmModel = vi.fn();
const deleteAllChatSessions = vi.fn();

vi.mock("@/services/tauriClient", () => ({
  tauriClient: {
    listLlmProviders: () => listLlmProviders(),
    createLlmProvider: (request: unknown) => createLlmProvider(request),
    updateLlmProvider: (request: unknown) => updateLlmProvider(request),
    deleteLlmProvider: (id: string) => deleteLlmProvider(id),
    createLlmEndpoint: (request: unknown) => createLlmEndpoint(request),
    updateLlmEndpoint: (request: unknown) => updateLlmEndpoint(request),
    deleteLlmEndpoint: (id: string) => deleteLlmEndpoint(id),
    testLlmEndpoint: (id: string) => testLlmEndpoint(id),
    syncLlmModels: (id: string) => syncLlmModels(id),
    addLlmModels: (request: unknown) => addLlmModels(request),
    updateLlmModel: (request: unknown) => updateLlmModel(request),
    deleteLlmModel: (id: string) => deleteLlmModel(id),
    deleteAllChatSessions: () => deleteAllChatSessions()
  }
}));

function provider(overrides: Partial<LlmProvider> = {}): LlmProvider {
  return {
    id: "prov-1",
    name: "agentrouter",
    kind: "openai",
    enabled: true,
    sortOrder: 0,
    createdAt: "2026-08-28T00:00:00Z",
    updatedAt: "2026-08-28T00:00:00Z",
    endpoints: [
      {
        id: "ep-1",
        providerId: "prov-1",
        name: "default",
        baseUrl: "https://gateway.example/v1",
        isDefault: true,
        hasApiKey: true,
        apiKeyMasked: "sk-••••abcd",
        createdAt: "2026-08-28T00:00:00Z",
        updatedAt: "2026-08-28T00:00:00Z",
        models: [
          {
            id: "m-1",
            endpointId: "ep-1",
            modelId: "claude-opus-4-8",
            series: "claude-opus",
            displayName: null,
            isDefault: true,
            contextWindow: null,
            maxOutputTokens: null,
            createdAt: "2026-08-28T00:00:00Z"
          },
          {
            id: "m-2",
            endpointId: "ep-1",
            modelId: "gpt-5.6-sol",
            series: "gpt-5.6-sol",
            displayName: null,
            isDefault: false,
            contextWindow: null,
            maxOutputTokens: null,
            createdAt: "2026-08-28T00:00:00Z"
          }
        ]
      }
    ],
    ...overrides
  };
}

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <LlmSettingsPanel />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

describe("LlmSettingsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listLlmProviders.mockResolvedValue([provider()]);
  });

  it("warns that chat content leaves the machine", async () => {
    renderPanel();
    expect(
      await screen.findByText(/sends your messages and tool results/i)
    ).toBeInTheDocument();
  });

  it("shows the provider, its endpoint, and models grouped by series", async () => {
    renderPanel();

    // The provider row in the left column; the delete action also mentions the
    // name, so match the row by its trailing model count.
    expect(await screen.findByRole("button", { name: "agentrouter 2" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "agentrouter" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("https://gateway.example/v1")).toBeInTheDocument();

    // Two series groups, each holding its models. "gpt-5.6-sol" is both a series
    // and a model id here — that is what the heuristic produces for it — so the
    // group is matched by its expand/collapse control.
    expect(screen.getByRole("button", { name: "claude-opus 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "gpt-5.6-sol 1" })).toBeInTheDocument();
    expect(screen.getByText("claude-opus-4-8")).toBeInTheDocument();
  });

  it("offers the stored key as a placeholder and never its value", async () => {
    renderPanel();

    const keyField = await screen.findByLabelText(/api key/i);
    // The masked value is a hint; the field itself starts empty so that leaving
    // it alone keeps the stored key.
    expect(keyField).toHaveValue("");
    expect(keyField).toHaveAttribute("placeholder", "sk-••••abcd");
  });

  it("omits the API key when saving an unrelated edit", async () => {
    const user = userEvent.setup();
    updateLlmEndpoint.mockResolvedValue(undefined);
    renderPanel();

    const urlField = await screen.findByLabelText(/api base url/i);
    await user.clear(urlField);
    await user.type(urlField, "https://other.example/v1");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(updateLlmEndpoint).toHaveBeenCalled());
    expect(updateLlmEndpoint).toHaveBeenCalledWith({
      id: "ep-1",
      name: undefined,
      baseUrl: "https://other.example/v1",
      apiKey: undefined
    });
  });

  it("fetches candidates when syncing models", async () => {
    const user = userEvent.setup();
    syncLlmModels.mockResolvedValue([
      { modelId: "claude-opus-4-8", series: "claude-opus", displayName: null, alreadyAdded: true },
      { modelId: "o3", series: "o3", displayName: null, alreadyAdded: false }
    ]);
    renderPanel();

    await user.click(await screen.findByRole("button", { name: "Sync" }));

    await waitFor(() => expect(syncLlmModels).toHaveBeenCalledWith("ep-1"));
    expect(await screen.findByText(/2 models reported/i)).toBeInTheDocument();
    // Already-stored models are visible but not importable again.
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes[0]).toBeDisabled();
    expect(checkboxes[1]).toBeEnabled();
  });

  it("cannot sync an endpoint without an API key", async () => {
    const keyless = provider();
    keyless.endpoints[0]!.hasApiKey = false;
    keyless.endpoints[0]!.apiKeyMasked = null;
    listLlmProviders.mockResolvedValue([keyless]);
    renderPanel();

    expect(await screen.findByRole("button", { name: "Sync" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /test connection/i })).toBeDisabled();
  });

  it("prompts for an endpoint right after a provider is created", async () => {
    const user = userEvent.setup();
    createLlmProvider.mockResolvedValue("prov-2");
    listLlmProviders.mockResolvedValue([]);
    renderPanel();

    await user.click(await screen.findByRole("button", { name: /add/i }));
    await user.type(screen.getByLabelText("Name"), "b.ai");
    await user.click(screen.getByRole("button", { name: "Add provider" }));

    await waitFor(() =>
      expect(createLlmProvider).toHaveBeenCalledWith({ name: "b.ai", kind: "openai" })
    );
  });

  it("warns before deleting a provider and its stored key", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(await screen.findByRole("button", { name: /delete agentrouter/i }));

    expect(screen.getByRole("heading", { name: /delete provider\?/i })).toBeInTheDocument();
    expect(screen.getByText(/stored API key/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(deleteLlmProvider).toHaveBeenCalledWith("prov-1"));
  });

  it("shows an empty state when nothing is configured", async () => {
    listLlmProviders.mockResolvedValue([]);
    renderPanel();

    expect(await screen.findByText(/no providers yet/i)).toBeInTheDocument();
    expect(screen.getByText(/add a provider to configure/i)).toBeInTheDocument();
  });

  it("clears stored conversations after confirming", async () => {
    const user = userEvent.setup();
    deleteAllChatSessions.mockResolvedValue(3);
    renderPanel();

    await user.click(await screen.findByRole("button", { name: /clear all conversations/i }));

    // Chat history including log excerpts lives on disk, so the confirmation says
    // what is actually being destroyed.
    expect(screen.getByRole("heading", { name: /clear all conversations\?/i })).toBeInTheDocument();
    expect(screen.getByText(/stored log\s+excerpts/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear all" }));
    await waitFor(() => expect(deleteAllChatSessions).toHaveBeenCalled());
  });
});
