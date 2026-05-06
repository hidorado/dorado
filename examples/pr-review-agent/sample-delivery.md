# Review · https://github.com/example/repo/pull/42

## Summary
1 TypeScript correctness issue and 2 maintainability concerns. Diff is otherwise structurally clean — no critical security findings on the patched files.

## Bugs
- `getUser(id)` is typed `Promise<User>` but can return `undefined` when the row is missing. Tighten to `Promise<User | null>` and force callers to handle the null branch.

## Security
- `renderMarkdown(input)` does not pass through DOMPurify on the changed handler. Confirm the rest of the chain still escapes raw HTML before render.

## Recommendations
1. Add a unit test for the null row case in `getUser`.
2. Document the markdown sanitization invariant in `docs/security.md`.
3. Consider `as const` on the role enum to prevent silent widening.
4. Export the new helper from `lib/utils.ts` for consistency.
5. Add a `@deprecated` tag on the old shape so callers migrate cleanly.
