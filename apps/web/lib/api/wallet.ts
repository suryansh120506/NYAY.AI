import type { PaymentCheckout, WalletClient } from "./clients";
import { HttpCheckout, HttpWalletClient } from "./http/clients";
import { FakeCheckout, MockWalletClient } from "./mock/wallet";
import { useHttp } from "./select";

let wallet: WalletClient | undefined;
let checkout: PaymentCheckout | undefined;

export function getWalletClient(): WalletClient {
  return (wallet ??= useHttp ? new HttpWalletClient() : new MockWalletClient());
}

/** Razorpay Checkout (or the API's dev capture) with the backend; a fake that "pays" after a pause offline. */
export function getCheckout(): PaymentCheckout {
  return (checkout ??= useHttp ? new HttpCheckout() : new FakeCheckout());
}
