import type { NewsClient } from "./clients";
import { HttpNewsClient } from "./http/clients";
import { FixtureNewsClient } from "./mock/news";
import { useHttp } from "./select";

/** Server-safe: the home page renders news on the server. */
export function getNewsClient(): NewsClient {
  return useHttp ? new HttpNewsClient() : new FixtureNewsClient();
}
