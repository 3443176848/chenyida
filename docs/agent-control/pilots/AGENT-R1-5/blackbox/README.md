# Source-blind synthetic black-box fixture

This directory contains only a public synthetic interface, risk-derived Personas,
their expected observations, and the deterministic harness needed to execute them.
It contains no ERP product source, `.git`, real business data, owner input, secret,
UAT observation, production observation, network target, or database target.

The accepted run profile is one ephemeral container with `--network none`, a
read-only root filesystem, and exactly one read-only mount of this directory at
`/fixture`. The black-box reviewer receives only `interface.json`, `personas.json`,
the emitted report, and their digests; it does not receive `runner.mjs` or repository
context. This is artifact/context isolation for a synthetic pilot, not R2 identity
or capability enforcement.
