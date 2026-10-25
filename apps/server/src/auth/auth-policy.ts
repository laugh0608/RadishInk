export const AUTH_POLICY = Object.freeze({
  idleMs: 30 * 60_000,
  absoluteMs: 12 * 60 * 60_000,
  windowMs: 15 * 60_000,
  accountFailures: 5,
  sourceFailures: 30,
  argonConcurrency: 2,
  reauthenticationMs: 5 * 60_000,
});
