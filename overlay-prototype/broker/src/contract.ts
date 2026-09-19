// Single import surface for the frozen contract, so there is exactly one place
// to change if packages/grant moves.
export * from "../../packages/grant/types.ts";
export * from "../../packages/grant/canonical.ts";
