/**
 * Limits on an agent's fields, used by the form and checked again in the server action.
 *
 * They live here, not in the "use client" form component, because a server module that
 * imports from a client module gets client references instead of the values — the
 * server-side length checks would silently compare against something that isn't a number.
 */
export const MAX_AGENT_NAME = 60;
export const MAX_AGENT_INSTRUCTIONS = 1000;
