import { describe, it, expect, vi } from "vitest";
import hermesPlugin from "./index.js";

type RegisteredItem = { name: string; type: string };

function createMockApi() {
  const registered: RegisteredItem[] = [];
  let serviceRegistered = false;
  let cliRegistered = false;

  const api = {
    id: "hermes",
    name: "Hermes Orchestrator",
    source: "test",
    config: {},
    pluginConfig: {
      baseUrl: "http://localhost:3345",
      timeoutMs: 5000,
    },
    runtime: {},
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    registerTool: vi.fn((tool: { name: string }) => {
      registered.push({ name: tool.name, type: "tool" });
    }),
    registerService: vi.fn(() => {
      serviceRegistered = true;
    }),
    registerCli: vi.fn(() => {
      cliRegistered = true;
    }),
    registerHook: vi.fn(),
    registerHttpHandler: vi.fn(),
    registerHttpRoute: vi.fn(),
    registerChannel: vi.fn(),
    registerGatewayMethod: vi.fn(),
    registerProvider: vi.fn(),
    registerCommand: vi.fn(),
    resolvePath: vi.fn((p: string) => p),
    on: vi.fn(),
  };

  return {
    api,
    registered,
    isServiceRegistered: () => serviceRegistered,
    isCliRegistered: () => cliRegistered,
  };
}

describe("hermes plugin", () => {
  it("has correct metadata", () => {
    expect(hermesPlugin.id).toBe("hermes");
    expect(hermesPlugin.name).toBe("Hermes Orchestrator");
    expect(hermesPlugin.description).toBeTruthy();
  });

  it("registers all 21 tools", () => {
    const { api, registered } = createMockApi();
    hermesPlugin.register(api as never);

    expect(registered.length).toBe(21);

    const toolNames = registered.map((r) => r.name);
    // Workflow tools (6)
    expect(toolNames).toContain("hermes_start_workflow");
    expect(toolNames).toContain("hermes_list_workflows");
    expect(toolNames).toContain("hermes_get_workflow");
    expect(toolNames).toContain("hermes_control_workflow");
    expect(toolNames).toContain("hermes_delete_workflow");
    expect(toolNames).toContain("hermes_phase_control");
    // Server tools (3)
    expect(toolNames).toContain("hermes_list_servers");
    expect(toolNames).toContain("hermes_create_server");
    expect(toolNames).toContain("hermes_server_control");
    // Monitoring tools (3)
    expect(toolNames).toContain("hermes_system_status");
    expect(toolNames).toContain("hermes_query_logs");
    expect(toolNames).toContain("hermes_workflow_logs");
    // Council tools (2)
    expect(toolNames).toContain("hermes_council_deliberate");
    expect(toolNames).toContain("hermes_council_status");
    // Quality tools (2)
    expect(toolNames).toContain("hermes_quality_report");
    expect(toolNames).toContain("hermes_workflow_rating");
    // Connection tools (5)
    expect(toolNames).toContain("hermes_connection_status");
    expect(toolNames).toContain("hermes_connect_provider");
    expect(toolNames).toContain("hermes_complete_oauth");
    expect(toolNames).toContain("hermes_disconnect_provider");
    expect(toolNames).toContain("hermes_set_api_key");
  });

  it("registers a service", () => {
    const { api, isServiceRegistered } = createMockApi();
    hermesPlugin.register(api as never);
    expect(isServiceRegistered()).toBe(true);
    expect(api.registerService).toHaveBeenCalledOnce();
  });

  it("registers CLI commands", () => {
    const { api, isCliRegistered } = createMockApi();
    hermesPlugin.register(api as never);
    expect(isCliRegistered()).toBe(true);
    expect(api.registerCli).toHaveBeenCalledWith(expect.any(Function), {
      commands: ["hermes"],
    });
  });

  it("logs registration with config info", () => {
    const { api } = createMockApi();
    hermesPlugin.register(api as never);
    expect(api.logger.info).toHaveBeenCalledWith(expect.stringContaining("hermes: registered"));
  });

  it("uses default baseUrl when not configured", () => {
    const { api } = createMockApi();
    api.pluginConfig = {};
    hermesPlugin.register(api as never);
    // Should not throw — uses default http://localhost:3345
    expect(api.registerTool).toHaveBeenCalled();
  });

  it("resolves env vars in config", () => {
    const { api } = createMockApi();
    process.env.TEST_HERMES_URL = "http://test:9999";
    api.pluginConfig = { baseUrl: "${TEST_HERMES_URL}" };
    hermesPlugin.register(api as never);
    expect(api.logger.info).toHaveBeenCalledWith(expect.stringContaining("http://test:9999"));
    delete process.env.TEST_HERMES_URL;
  });
});
