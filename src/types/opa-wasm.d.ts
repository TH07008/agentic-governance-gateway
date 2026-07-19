/**
 * Ambient module declaration for `@open-policy-agent/opa-wasm`, which does not
 * ship its own TypeScript types. We only declare the surface area we use.
 */
declare module "@open-policy-agent/opa-wasm" {
  export interface OpaWasmOptions {
    policy: Buffer;
    data?: unknown;
  }
  export default class OPAModule {
    constructor(options: OpaWasmOptions);
    evaluate(input: unknown, options?: unknown): { result?: Record<string, unknown[]> } | Record<string, unknown[]>;
    eval(data?: unknown): unknown;
  }
}