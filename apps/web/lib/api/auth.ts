import type { AuthClient } from "./clients";
import { HttpAuthClient } from "./http/clients";
import { MockAuthClient } from "./mock/auth";
import { useHttp } from "./select";

let client: AuthClient | undefined;

export function getAuthClient(): AuthClient {
  return (client ??= useHttp ? new HttpAuthClient() : new MockAuthClient());
}
