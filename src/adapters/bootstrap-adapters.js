import { TicketMemoryAdapter } from "./ticket-memory-adapter.js";
import { buildEnterpriseAdapters } from "./build-enterprise-adapters.js";
import { buildGenericAdapters } from "./build-generic-adapters.js";
import { createMcpClient } from "../mcp/create-mcp-client.js";
import { FileMemoryStore } from "../memory/file-memory-store.js";

function assertAdapterKind(name, adapterConfig) {
  if (!["mock", "mcp"].includes(adapterConfig.kind)) {
    throw new Error(`Unsupported adapter kind for ${name}: ${adapterConfig.kind}`);
  }
}

function resolveMemoryStore(config) {
  return new FileMemoryStore(config.memory.filePath);
}

export function buildAdapters({ config, logger }) {
  const memoryStore = resolveMemoryStore(config);
  const ticketMemoryAdapter = new TicketMemoryAdapter(memoryStore);
  const needsMcpClient =
    Object.values(config.adapters).some((adapterConfig) => adapterConfig.kind === "mcp") ||
    Boolean(config.interaction?.enabled && config.interaction?.transports?.slack?.enabled);
  const mcpClient = needsMcpClient ? createMcpClient(config.mcpBridge) : null;
  const definitions = {
    ...buildGenericAdapters({ config, mcpClient }),
    ...buildEnterpriseAdapters({ config, mcpClient })
  };

  const adapters = {};
  const kinds = {};

  for (const [name, registry] of Object.entries(definitions)) {
    const adapterConfig = config.adapters[name];
    assertAdapterKind(name, adapterConfig);
    adapters[name] = registry[adapterConfig.kind]();
    kinds[name] = adapterConfig.kind;
  }

  logger?.debug("Adapters bootstrapped", kinds);

  return {
    adapters,
    ticketMemoryAdapter,
    memoryStore,
    kinds,
    mcpClient
  };
}
