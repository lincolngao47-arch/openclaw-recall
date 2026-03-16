import type { ResolvedPluginConfig } from "../config/schema.js";
import { CloudBackend } from "./CloudBackend.js";

export class ReconnectBackend extends CloudBackend {
  readonly mode = "reconnect" as const;

  constructor(config: ResolvedPluginConfig) {
    super(config);
  }
}
