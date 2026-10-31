import type { PaymentCheckout, WalletClient } from "@/lib/api/clients";
import {
  ApiError,
  type CheckoutResult,
  type TopupOrder,
  type Wallet,
  type WalletTxn,
} from "@/lib/api/types";
import { limits } from "@/lib/config";
import { requireMockUserId } from "./auth";
import { db, mutate } from "./db";
import { onTopupCredited } from "./samvaad-server";
import { latency, sleep, uid } from "./util";

const pendingOrders = new Map<string, { userId: string; amount: number }>();

export class MockWalletClient implements WalletClient {
  async get(): Promise<Wallet> {
    await latency(200, 500);
    const user = db().users[requireMockUserId()];
    if (!user) throw new ApiError("unauthorized", 401);
    return { ...user.wallet };
  }

  async history(): Promise<WalletTxn[]> {
    await latency(250, 600);
    const user = db().users[requireMockUserId()];
    if (!user) throw new ApiError("unauthorized", 401);
    return user.history.map((txn) => ({ ...txn }));
  }

  async createTopup(amountPaise: number): Promise<TopupOrder> {
    await latency(200, 400);
    const userId = requireMockUserId();
    if (!Number.isSafeInteger(amountPaise) || amountPaise < limits.minTopupPaise) {
      throw new ApiError("invalid_amount", 422, { min_paise: limits.minTopupPaise });
    }
    const order: TopupOrder = {
      order_id: uid("order"),
      amount_paise: amountPaise,
      provider: "fake",
    };
    pendingOrders.set(order.order_id, { userId, amount: amountPaise });
    return order;
  }
}

/**
 * Stands in for Razorpay Checkout plus the signature-verified webhook (brief §1.4 Payments): the "payment" succeeds
 * after a short pause, then the credit is posted exactly once per order id and, if a consultation is live, moved
 * into its hold without touching the socket.
 */
export class FakeCheckout implements PaymentCheckout {
  async open(order: TopupOrder): Promise<CheckoutResult> {
    await sleep(1_300);
    const pending = pendingOrders.get(order.order_id);
    if (!pending) return "failed";
    pendingOrders.delete(order.order_id);
    mutate((s) => {
      const user = s.users[pending.userId];
      if (!user) return;
      user.wallet.available_paise += pending.amount;
      user.history.unshift({
        id: uid("txn"),
        kind: "topup",
        amount_paise: pending.amount,
        created_at: new Date().toISOString(),
        advocate_name: null,
        minutes: null,
      });
    });
    onTopupCredited(pending.userId, pending.amount);
    return "paid";
  }
}
