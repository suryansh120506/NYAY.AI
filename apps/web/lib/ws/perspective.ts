import type { TransportFactory } from "./transport";
import type { Party, ServerEvent } from "./types";

const other = (party: Party): Party => (party === "user" ? "advocate" : "user");

/** The same event seen from the other side of the conversation. */
export function flipParty(event: ServerEvent): ServerEvent {
  switch (event.type) {
    case "msg.new":
      return { ...event, from: other(event.from) };
    case "presence":
    case "typing":
      return { ...event, party: other(event.party) };
    default:
      return event;
  }
}

/**
 * The room store and message list are written from the client's point of view ("user" = me). For the advocate's
 * room the parties are swapped on the way in, so the same store and components render "me" and "the other person"
 * correctly. Outgoing events carry no party, so nothing changes on the way out.
 */
export function counterpartView(factory: TransportFactory): TransportFactory {
  return (args) =>
    factory({
      ...args,
      handlers: { ...args.handlers, onEvent: (event) => args.handlers.onEvent(flipParty(event)) },
    });
}
