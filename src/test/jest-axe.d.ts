/**
 * @types/jest-axe only augments Jest's own `Matchers` interface, not
 * Vitest's -- so `expect(results).toHaveNoViolations()` type-checks
 * fine under plain `vitest run` (which doesn't type-check at all) but
 * fails under `tsc -b`, which does. This augments Vitest's
 * `Assertion` interface the same way @testing-library/jest-dom/vitest
 * does for its own matchers.
 */
import "vitest";

declare module "vitest" {
  interface Assertion<T = unknown> {
    toHaveNoViolations(): T extends Promise<unknown> ? Promise<void> : void;
  }
}
