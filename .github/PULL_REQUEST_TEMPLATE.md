## What and why

<!-- One change per PR. Link the issue it fixes. -->

## Checklist

- [ ] `npm test` passes (it rebuilds `bin/`; commit the rebuilt bundles)
- [ ] New behavior has a test that fails without the change
- [ ] If an agent-facing rule changed: `src/instructions.ts` only, plus the behavior it fixes (transcript or eval)
- [ ] User-visible change noted in `CHANGELOG.md`
