import type { PaymentCheckout, SamvaadClient, WalletClient } from "./clients";
import { HttpCheckout, HttpSamvaadClient, HttpWalletClient } from "./http/clients";
import { MockSamvaadClient } from "./mock/samvaad";
import { FakeCheckout, MockWalletClient } from "./mock/wallet";
import { useHttp } from "./select";

let client: SamvaadClient | undefined;
let wallet: WalletClient | undefined;
let checkout: PaymentCheckout | undefined;

/**
 * The consultation room: the WebSocket gateway and billing engine when the API is on, the in-tab simulation
 * otherwise. Its wallet and checkout always come from the same place, so a top-up inside a session moves the
 * session's own balance (for real: the payment webhook raises the live hold).
 */
export function getSamvaadClient(): SamvaadClient {
  return (client ??= useHttp ? new HttpSamvaadClient() : new MockSamvaadClient());
}

export function getSessionWalletClient(): WalletClient {
  return (wallet ??= useHttp ? new HttpWalletClient() : new MockWalletClient());
}

export function getSessionCheckout(): PaymentCheckout {
  return (checkout ??= useHttp ? new HttpCheckout() : new FakeCheckout());
}
