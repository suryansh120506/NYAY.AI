import type { ParakhClient } from "./clients";
import { HttpParakhClient } from "./http/clients";
import { FixtureParakhClient } from "./mock/parakh";
import { useHttp } from "./select";

let client: ParakhClient | undefined;

export function getParakhClient(): ParakhClient {
  return (client ??= useHttp ? new HttpParakhClient() : new FixtureParakhClient());
}
