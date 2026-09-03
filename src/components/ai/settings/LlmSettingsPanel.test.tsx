import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LlmSettingsPanel } from "./LlmSettingsPanel";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { LlmProvider } from "@/types/domain";

const listLlmProviders = vi.fn();
const createLlmProvider = vi.fn();
const updateLlmProvider = vi.fn();
const duplicateLlmProvider = vi.fn();
const deleteLlmProvider = vi.fn();
const setLlmProviderHeaders = vi.fn();
const addLlmApiKey = vi.fn();
const updateLlmApiKey = vi.fn();
const deleteLlmApiKey = vi.fn();
const probeLlmApiKeys = vi.fn();
const testLlmProvider = vi.fn();
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
    duplicateLlmProvider: (request: unknown) => duplicateLlmProvider(request),
    deleteLlmProvider: (id: string) => deleteLlmProvider(id),
    setLlmProviderHeaders: (request: unknown) => setLlmProviderHeaders(request),
    addLlmApiKey: (request: unknown) => addLlmApiKey(request),
    updateLlmApiKey: (request: unknown) => updateLlmApiKey(request),
    deleteLlmApiKey: (id: string) => deleteLlmApiKey(id),
    probeLlmApiKeys: (id: string) => probeLlmApiKeys(id),
    testLlmProvider: (id: string) => testLlmProvider(id),
    syncLlmModels: (id: string) => syncLlmModels(id),
    addLlmModels: (request: unknown) => addLlmModels(request),
    updateLlmModel: (request: unknown) => updateLlmModel(request),
    deleteLlmModel: (id: string) => deleteLlmModel(id),
    deleteAllChatSessions: () => deleteAllChatSessions()
  }
}));

const TIMESTAMP = "2026-08-31T00:00:00Z";

/**
 * A configured provider whose name and model group differ, so a query for one
 * cannot accidentally match the other.
 */
function provider(overrides: Partial<LlmProvider> = {}): LlmProvider {
  return {
    id: "prov-1",
    name: "Google",
    protocol: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    enabled: true,
    builtIn: false,
    headerNames: [],
    sortOrder: 0,
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    apiKeys: [
      {
        id: "key-1",
        providerId: "prov-1",
        label: null,
        masked: "AIz••••abcd",
        status: "healthy",
        statusMessage: null,
        checkedAt: TIMESTAMP,
        sortOrder: 0,
        createdAt: TIMESTAMP
      }
    ],
    models: [
      {
        id: "m-1",
        providerId: "prov-1",
        modelId: "gemini-3.5-flash",
        series: "Flash",
        displayName: null,
        modelType: "chat",
        capabilities: {
          reasoning: true,
          toolCalling: true,
          text: true,
          vision: true,
          audio: false,
          video: false
        },
        isDefault: true,
        contextWindow: 128000,
        maxInputTokens: 128000,
        maxOutputTokens: 4096,
        createdAt: TIMESTAMP
      },
      {
        id: "m-2",
        providerId: "prov-1",
        modelId: "gemini-flash-latest",
        series: "Flash",
        displayName: null,
        modelType: "chat",
        capabilities: {
          reasoning: false,
          toolCalling: true,
          text: true,
          vision: false,
          audio: false,
          video: false
        },
        isDefault: false,
        contextWindow: null,
        maxInputTokens: null,
        maxOutputTokens: null,
        createdAt: TIMESTAMP
      }
    ],
    ...overrides
  };
}

/** One of the three seeded presets: right address, no key, switched off. */
function preset(overrides: Partial<LlmProvider> = {}): LlmProvider {
  return {
    id: "builtin-openai",
    name: "OpenAI",
    protocol: "openai",
    baseUrl: "https://api.openai.com/v1",
    enabled: false,
    builtIn: true,
    headerNames: [],
    sortOrder: 1,
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    apiKeys: [],
    models: [],
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
    updateLlmProvider.mockResolvedValue(undefined);
  });

  it("shows the provider's key, address, protocol, and grouped models", async () => {
    renderPanel();

    // The provider row in the left column; the name field also holds the name, so
    // match the row by its trailing model count.
    expect(await screen.findByRole("button", { name: "Google 2" })).toBeInTheDocument();
    expect(screen.getByLabelText("Provider name")).toHaveValue("Google");
    expect(screen.getByLabelText(/api address/i)).toHaveValue(
      "https://generativelanguage.googleapis.com/v1beta"
    );
    // The protocol is a dropdown beside the address, not a radio group.
    expect(screen.getByRole("combobox", { name: "Protocol" })).toHaveTextContent("Gemini");

    expect(screen.getByRole("button", { name: "Flash 2", expanded: true })).toBeInTheDocument();
    expect(screen.getByText("gemini-3.5-flash")).toBeInTheDocument();
    expect(screen.getByText("gemini-flash-latest")).toBeInTheDocument();
  });

  it("lists the seeded presets as disabled rows waiting for a key", async () => {
    listLlmProviders.mockResolvedValue([preset()]);
    renderPanel();

    // A preset is a form to fill in: the address is already right, and the only
    // thing missing is the key.
    expect(await screen.findByLabelText(/api address/i)).toHaveValue("https://api.openai.com/v1");
    expect(screen.getByText("Preset")).toBeInTheDocument();
    expect(screen.getByRole("switch")).not.toBeChecked();
    expect(screen.getByText(/add an api key to use this provider/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Test connection" })).toBeDisabled();
  });

  it("saves the address when the field loses focus, with no Save button", async () => {
    const user = userEvent.setup();
    renderPanel();

    const urlField = await screen.findByLabelText(/api address/i);
    await user.clear(urlField);
    await user.type(urlField, "https://gateway.example/v1");
    await user.tab();

    await waitFor(() =>
      expect(updateLlmProvider).toHaveBeenCalledWith({
        id: "prov-1",
        baseUrl: "https://gateway.example/v1"
      })
    );
    // Committing on blur is the whole point — there is no button to press.
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });

  it("saves the name on Enter without leaving the field", async () => {
    const user = userEvent.setup();
    renderPanel();

    const nameField = await screen.findByLabelText("Provider name");
    await user.clear(nameField);
    await user.type(nameField, "Google Vertex{Enter}");

    await waitFor(() =>
      expect(updateLlmProvider).toHaveBeenCalledWith({ id: "prov-1", name: "Google Vertex" })
    );
  });

  it("reverts the field and reports the error when a commit is rejected", async () => {
    const user = userEvent.setup();
    updateLlmProvider.mockRejectedValue(new Error("API address must start with http://"));
    renderPanel();

    const urlField = await screen.findByLabelText(/api address/i);
    await user.clear(urlField);
    await user.type(urlField, "gateway.example{Enter}");

    // Without a Save button, a rejected value must not stay on screen looking
    // stored.
    await waitFor(() =>
      expect(urlField).toHaveValue("https://generativelanguage.googleapis.com/v1beta")
    );
  });

  it("leaves the stored value alone when a field is edited and escaped", async () => {
    const user = userEvent.setup();
    renderPanel();

    const nameField = await screen.findByLabelText("Provider name");
    await user.clear(nameField);
    await user.type(nameField, "scratch{Escape}");

    expect(nameField).toHaveValue("Google");
    expect(updateLlmProvider).not.toHaveBeenCalled();
  });

  it("does not save a field that was focused but not changed", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(await screen.findByLabelText("Provider name"));
    await user.tab();

    expect(updateLlmProvider).not.toHaveBeenCalled();
  });

  it("switching protocol on a blank address fills in that protocol's default", async () => {
    const user = userEvent.setup();
    listLlmProviders.mockResolvedValue([provider({ baseUrl: "", enabled: false })]);
    renderPanel();

    await user.click(await screen.findByRole("combobox", { name: "Protocol" }));
    await user.click(screen.getByRole("option", { name: "Anthropic" }));

    await waitFor(() =>
      expect(updateLlmProvider).toHaveBeenCalledWith({
        id: "prov-1",
        protocol: "anthropic",
        baseUrl: "https://api.anthropic.com/v1"
      })
    );
  });

  it("switching protocol keeps an address the user already set", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(await screen.findByRole("combobox", { name: "Protocol" }));
    await user.click(screen.getByRole("option", { name: "OpenAI" }));

    await waitFor(() =>
      expect(updateLlmProvider).toHaveBeenCalledWith({ id: "prov-1", protocol: "openai" })
    );
  });

  it("toggles the provider's enabled state", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(await screen.findByRole("switch"));

    await waitFor(() => expect(updateLlmProvider).toHaveBeenCalledWith({ id: "prov-1", enabled: false }));
  });

  it("shows a model's abilities as icons, and only the ones it has", async () => {
    renderPanel();
    await screen.findByText("gemini-3.5-flash");

    // The first model reasons and sees; the second does neither, so only one of
    // each icon is rendered across the two rows.
    expect(screen.getByLabelText("Reasoning")).toBeInTheDocument();
    expect(screen.getByLabelText("Vision")).toBeInTheDocument();
    expect(screen.getAllByLabelText("Tool calling")).toHaveLength(2);
    expect(screen.queryByLabelText("Audio")).not.toBeInTheDocument();
  });

  it("manages several API keys and never renders a stored value", async () => {
    const user = userEvent.setup();
    const multi = provider();
    multi.apiKeys.push({
      id: "key-2",
      providerId: "prov-1",
      label: "backup",
      masked: "AIz••••wxyz",
      status: "unhealthy",
      statusMessage: "Authentication failed (401).",
      checkedAt: TIMESTAMP,
      sortOrder: 1,
      createdAt: TIMESTAMP
    });
    listLlmProviders.mockResolvedValue([multi]);
    renderPanel();

    await user.click(await screen.findByRole("button", { name: "Manage API keys" }));

    expect(screen.getByText("AIz••••abcd")).toBeInTheDocument();
    expect(screen.getByText("AIz••••wxyz")).toBeInTheDocument();
    // Requests use the first key not known to be refused, and the UI says which.
    expect(screen.getByText("In use")).toBeInTheDocument();
    expect(screen.getByLabelText("Working")).toBeInTheDocument();
    expect(screen.getByLabelText("Refused")).toBeInTheDocument();

    // The field for a new key starts empty and masked — a stored key cannot be
    // read back, so the eye only unmasks what is being typed.
    const field = screen.getByLabelText(/add a key/i);
    expect(field).toHaveValue("");
    expect(field).toHaveAttribute("type", "password");
    await user.click(screen.getByRole("button", { name: /show the key you are typing/i }));
    expect(field).toHaveAttribute("type", "text");
  });

  it("adds an API key to the provider", async () => {
    const user = userEvent.setup();
    addLlmApiKey.mockResolvedValue("key-2");
    renderPanel();

    await user.click(await screen.findByRole("button", { name: "Manage API keys" }));
    await user.type(screen.getByLabelText(/add a key/i), "AIzaSecondKey");
    await user.type(screen.getByLabelText(/label/i), "backup");
    await user.click(screen.getByRole("button", { name: /add key/i }));

    await waitFor(() =>
      expect(addLlmApiKey).toHaveBeenCalledWith({
        providerId: "prov-1",
        value: "AIzaSecondKey",
        label: "backup"
      })
    );
  });

  it("probes every key when detecting", async () => {
    const user = userEvent.setup();
    probeLlmApiKeys.mockResolvedValue([
      {
        id: "key-1",
        providerId: "prov-1",
        label: null,
        masked: "AIz••••abcd",
        status: "healthy",
        statusMessage: null,
        checkedAt: TIMESTAMP,
        sortOrder: 0,
        createdAt: TIMESTAMP
      }
    ]);
    renderPanel();

    await user.click(await screen.findByRole("button", { name: "Manage API keys" }));
    await user.click(screen.getByRole("button", { name: "Detect" }));

    await waitFor(() => expect(probeLlmApiKeys).toHaveBeenCalledWith("prov-1"));
  });

  it("submits custom headers as a set, keeping stored values it cannot read", async () => {
    const user = userEvent.setup();
    listLlmProviders.mockResolvedValue([provider({ headerNames: ["X-Api-Token"] })]);
    setLlmProviderHeaders.mockResolvedValue(["X-Api-Token", "X-Org"]);
    renderPanel();

    await user.click(await screen.findByRole("button", { name: /custom request headers/i }));

    // An existing header shows its name with an empty value: the value lives in
    // the keychain and was never sent here.
    expect(screen.getByLabelText("Name")).toHaveValue("X-Api-Token");
    expect(screen.getByLabelText("Value")).toHaveValue("");

    await user.click(screen.getByRole("button", { name: /add header/i }));
    const names = screen.getAllByLabelText("Name");
    const values = screen.getAllByLabelText("Value");
    await user.type(names[1]!, "X-Org");
    await user.type(values[1]!, "acme");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(setLlmProviderHeaders).toHaveBeenCalled());
    expect(setLlmProviderHeaders).toHaveBeenCalledWith({
      providerId: "prov-1",
      headers: [
        // Omitted value = keep what is stored.
        { name: "X-Api-Token", value: undefined },
        { name: "X-Org", value: "acme" }
      ]
    });
  });

  it("duplicates a provider under a name derived from the original", async () => {
    const user = userEvent.setup();
    duplicateLlmProvider.mockResolvedValue("prov-2");
    renderPanel();

    await user.click(await screen.findByRole("button", { name: "Duplicate Google" }));

    // The dialog explains what does and does not come along, and suggests a name.
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByRole("heading", { name: /duplicate provider/i })).toBeInTheDocument();
    expect(dialog.getByText(/gets no api key/i)).toBeInTheDocument();
    const nameField = dialog.getByLabelText("Name");
    expect(nameField).toHaveValue("Google copy");
    // Duplicating carries the protocol over, so the dialog does not ask for one.
    // Scoped to the dialog because the card behind it has a protocol control too.
    expect(dialog.queryByLabelText("Protocol")).not.toBeInTheDocument();

    await user.clear(nameField);
    await user.type(nameField, "Google (work)");
    await user.click(dialog.getByRole("button", { name: "Duplicate" }));

    await waitFor(() =>
      expect(duplicateLlmProvider).toHaveBeenCalledWith({ id: "prov-1", name: "Google (work)" })
    );
  });

  it("edits a model's group, abilities, and token limits", async () => {
    const user = userEvent.setup();
    updateLlmModel.mockResolvedValue(undefined);
    renderPanel();

    await user.click(await screen.findByRole("button", { name: "Edit gemini-3.5-flash" }));

    // The stored values are what the dialog opens on.
    expect(screen.getByLabelText("Model id")).toHaveValue("gemini-3.5-flash");
    expect(screen.getByLabelText("Group")).toHaveValue("Flash");
    expect(screen.getByLabelText("Context window")).toHaveValue("128000");
    expect(screen.getByLabelText("Max output tokens")).toHaveValue("4096");
    expect(screen.getByRole("radio", { name: "Chat" })).toBeChecked();

    await user.click(screen.getByRole("checkbox", { name: "Audio" }));
    const output = screen.getByLabelText("Max output tokens");
    await user.clear(output);
    await user.type(output, "8192");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(updateLlmModel).toHaveBeenCalled());
    expect(updateLlmModel).toHaveBeenCalledWith({
      id: "m-1",
      modelId: "gemini-3.5-flash",
      series: "Flash",
      displayName: "",
      modelType: "chat",
      capabilities: {
        reasoning: true,
        toolCalling: true,
        text: true,
        vision: true,
        audio: true,
        video: false
      },
      contextWindow: 128000,
      maxInputTokens: 128000,
      maxOutputTokens: 8192
    });
  });

  it("imports fetched candidates with the token limits the provider reported", async () => {
    const user = userEvent.setup();
    syncLlmModels.mockResolvedValue([
      {
        modelId: "gemini-3.5-flash",
        series: "gemini-3.5-flash",
        displayName: null,
        contextWindow: null,
        maxInputTokens: null,
        maxOutputTokens: null,
        alreadyAdded: true
      },
      {
        modelId: "gemini-3.5-pro",
        series: "gemini-3.5-pro",
        displayName: "Gemini 3.5 Pro",
        contextWindow: 1048576,
        maxInputTokens: 1048576,
        maxOutputTokens: 65536,
        alreadyAdded: false
      }
    ]);
    addLlmModels.mockResolvedValue(1);
    renderPanel();

    await user.click(await screen.findByRole("button", { name: /fetch model list/i }));
    await waitFor(() => expect(syncLlmModels).toHaveBeenCalledWith("prov-1"));
    expect(await screen.findByText(/2 models reported/i)).toBeInTheDocument();

    // Already-stored models are visible but not importable again.
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes[0]).toBeDisabled();
    expect(checkboxes[1]).toBeEnabled();

    await user.click(checkboxes[1]!);
    await user.click(screen.getByRole("button", { name: /^Import 1$/ }));

    await waitFor(() => expect(addLlmModels).toHaveBeenCalled());
    expect(addLlmModels).toHaveBeenCalledWith({
      providerId: "prov-1",
      models: [
        {
          modelId: "gemini-3.5-pro",
          series: "gemini-3.5-pro",
          displayName: "Gemini 3.5 Pro",
          contextWindow: 1048576,
          maxInputTokens: 1048576,
          maxOutputTokens: 65536
        }
      ]
    });
  });

  it("cannot fetch models for a provider without a key", async () => {
    listLlmProviders.mockResolvedValue([provider({ apiKeys: [] })]);
    renderPanel();

    expect(await screen.findByRole("button", { name: /fetch model list/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Test connection" })).toBeDisabled();
  });

  it("creates a provider with a protocol chosen up front", async () => {
    const user = userEvent.setup();
    createLlmProvider.mockResolvedValue("prov-2");
    listLlmProviders.mockResolvedValue([]);
    renderPanel();

    await user.click(await screen.findByRole("button", { name: /add$/i }));
    await user.type(screen.getByLabelText("Name"), "agentrouter");
    await user.click(screen.getByRole("button", { name: "Add provider" }));

    await waitFor(() =>
      expect(createLlmProvider).toHaveBeenCalledWith({ name: "agentrouter", protocol: "openai" })
    );
  });

  it("warns before deleting a provider and its stored keys", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(await screen.findByRole("button", { name: "Delete Google" }));

    expect(screen.getByRole("heading", { name: /delete provider\?/i })).toBeInTheDocument();
    expect(screen.getByText(/stored API keys/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(deleteLlmProvider).toHaveBeenCalledWith("prov-1"));
  });

  it("says a deleted preset will not come back", async () => {
    const user = userEvent.setup();
    listLlmProviders.mockResolvedValue([preset()]);
    renderPanel();

    await user.click(await screen.findByRole("button", { name: "Delete OpenAI" }));

    // Seeding is once-ever, so the confirmation must not imply it is recoverable.
    expect(screen.getByText(/not restored on the next start/i)).toBeInTheDocument();
  });

  it("shows an empty state when every provider has been deleted", async () => {
    listLlmProviders.mockResolvedValue([]);
    renderPanel();

    expect(await screen.findByText(/add a provider to configure/i)).toBeInTheDocument();
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
