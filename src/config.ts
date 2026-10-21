/** Fixed windows last one minute from the first request for each key. */
export const windowMs = 60_000;

/** Demonstration clients and their request limits per window; not authentication. */
export const policies: ReadonlyMap<string, number> = new Map([
  ['demo-client', 10],
  ['demo-client-custom', 10],
]);
