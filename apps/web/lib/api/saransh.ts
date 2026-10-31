import type { SaranshClient } from "./clients";
import { HttpSaranshClient } from "./http/clients";
import { MockSaranshClient } from "./mock/saransh";
import { useHttp } from "./select";

let client: SaranshClient | undefined;

/** Upload → text/OCR → three-bullet summary: the API pipeline, or the offline demo when mocks are on. */
export function getSaranshClient(): SaranshClient {
  return (client ??= useHttp ? new HttpSaranshClient() : new MockSaranshClient());
}
