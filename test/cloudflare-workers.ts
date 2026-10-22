// Stand-in for the Workers runtime module, so Durable Objects can run in tests (see board.ts's
// tests): only the base class is needed.
export class DurableObject<Env = unknown> {
  constructor(
    protected ctx: any,
    protected env: Env,
  ) {}
}
