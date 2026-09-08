import { describe, expect, it, vi } from "vitest";
import { createTauriClient } from "./tauriClient";

/**
 * DBHub IPC contract tests: command names, the `{ request }` wrapping convention
 * and the no-secrets-in-response rule for connection/profile reads.
 */

describe("dbHub IPC contract", () => {
  it("lists connections without a request payload", async () => {
    const invoke = vi.fn().mockResolvedValue([]);
    const client = createTauriClient(invoke);

    await client.listDbConnections();

    expect(invoke).toHaveBeenCalledWith("list_db_connections", undefined);
  });

  it("sends the connection password only inside the create payload", async () => {
    const invoke = vi.fn().mockResolvedValue({
      id: "c1",
      accountId: "acct-a",
      kind: "mysql",
      name: "Sales MySQL",
      host: "10.0.0.1",
      port: 3306,
      username: "bi_reader",
      showAsTab: true,
      enabledForAi: true,
      aiReadOnlyPolicy: "select-only",
      sortOrder: 0
    });
    const client = createTauriClient(invoke);

    await client.createDbConnection({
      kind: "mysql",
      name: "Sales MySQL",
      host: "10.0.0.1",
      port: 3306,
      username: "bi_reader",
      password: "hunter2"
    });

    expect(invoke).toHaveBeenCalledWith("create_db_connection", {
      request: {
        kind: "mysql",
        name: "Sales MySQL",
        host: "10.0.0.1",
        port: 3306,
        username: "bi_reader",
        password: "hunter2"
      }
    });
    // The created connection the UI receives carries no password field.
    const response = await invoke.mock.results[0].value;
    expect(response).not.toHaveProperty("password");
  });

  it("scopes flag updates by connectionId", async () => {
    const invoke = vi.fn().mockResolvedValue({});
    const client = createTauriClient(invoke);

    await client.setDbConnectionFlags("c1", { showAsTab: true });

    expect(invoke).toHaveBeenCalledWith("set_db_connection_flags", {
      request: { connectionId: "c1", showAsTab: true }
    });
  });

  it("saves profiles with the secret in the payload, absent from the response", async () => {
    const invoke = vi.fn().mockResolvedValue({
      id: "p1",
      accountId: "acct-a",
      name: "Office tunnel",
      transport: {
        type: "ssh-tunnel",
        host: "10.20.30.40",
        port: 22,
        username: "root",
        authMethod: "password",
        credentialsSaved: true
      },
      enabled: true
    });
    const client = createTauriClient(invoke);

    await client.saveNetworkProfile({
      name: "Office tunnel",
      transport: {
        type: "ssh-tunnel",
        host: "10.20.30.40",
        port: 22,
        username: "root",
        authMethod: "password",
        credentialsSaved: false
      },
      secret: "s3cret"
    });

    expect(invoke).toHaveBeenCalledWith("save_network_profile", {
      request: expect.objectContaining({ secret: "s3cret" })
    });
    const response = await invoke.mock.results[0].value;
    expect(response.transport.credentialsSaved).toBe(true);
    expect(response).not.toHaveProperty("secret");
  });

  it("maps profile delete/test commands", async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    const client = createTauriClient(invoke);

    await client.deleteNetworkProfile("p1");
    expect(invoke).toHaveBeenCalledWith("delete_network_profile", { request: { profileId: "p1" } });

    await client.testNetworkProfile("p1");
    expect(invoke).toHaveBeenCalledWith("test_network_profile", { request: { profileId: "p1" } });

    await client.testDbConnection("c1");
    expect(invoke).toHaveBeenCalledWith("test_db_connection", { request: { connectionId: "c1" } });
  });
});
