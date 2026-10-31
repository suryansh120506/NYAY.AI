import type { AdvocateClient } from "./clients";
import { HttpAdvocateClient } from "./http/clients";

let client: AdvocateClient | undefined;

/** The advocate dashboard exists only against the real API (there is no offline advocate). */
export function getAdvocateClient(): AdvocateClient {
  return (client ??= new HttpAdvocateClient());
}
