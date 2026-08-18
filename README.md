# verify-arch

A whole-graph architecture gate for Medusa 2.x codebases. One command, exit 0 or 1.

A per-file linter sees one file. Every bug this tool catches lives *between* files: two files that
are each fine on their own, but broken together — and Medusa's loaders resolve most of these
conflicts by silently letting the last one win. Nothing throws. Nothing warns. Your handler, module
or subscriber just quietly stops existing.

```
npx verify-arch            # scan the current directory
npx verify-arch path/to/repo
```

It scans `packages/`, `apps/`, and a root-level `src/` (so both monorepos and single Medusa apps
work), skipping `node_modules`, `.medusa`, `dist`, and test files. On failure it prints every
violation with the file, the rule id, and what to do about it.

## What it checks, and why a per-file linter can't

**`service-name-unique`** — every `Module(serviceName, ...)` declaration must be globally unique.
At config merge (`transformModules` in `@medusajs/medusa`) two modules with the same `serviceName`
silently last-win: the second registration overwrites the first in the module registry, with no
error and no warning. A whole module's service just disappears. No per-file rule can see what
`serviceName` some *other* file declared.

**`route-namespace`** — plugin API routes must live under `/store/<namespace>/*` or
`/admin/<namespace>/*`, and no two route files anywhere may derive the same route path. Medusa's
routes-loader keys routes in a plain map and assigns last-write-wins — a cross-plugin path
collision is undetected, and the losing handler silently never serves a request. A bare
`/store/<leaf>` route with no namespace segment is a collision waiting for the next plugin.
App-root routes (your project's own `src/api`) are exempt from the namespacing requirement but
still checked for collisions.

**`loader-index`** — no file named `index.ts` inside a `workflows/`, `subscribers/`, or `jobs/`
directory may carry a loader side-effect. Medusa's `ResourceLoader.discoverResources` filters
discovered files with `parsedName.name !== "index"` — an `index.ts` that defines a workflow,
subscriber, or scheduled job is silently skipped by auto-discovery, and the thing it defines only
registers if some *other* discovered file happens to import it. That is
[medusajs/medusa#15442](https://github.com/medusajs/medusa/issues/15442). Pure re-export barrels
are fine and are not flagged.

**`duplicate-query-step`** — two `useQueryGraphStep` (or `useRemoteQueryStep`) calls inside one
`createWorkflow` body must each carry a unique `.config({ name })`. Without it the step-handler map
last-wins and the orchestrator appends a duplicate action with no dedupe — the workflow runs, with
the wrong data, and never tells you. The collision is between two lines *inside one function body*,
which is exactly the granularity a line-oriented lint rule handles worst.

**`route-mutation`** — a route handler must not call a service mutation
(`createX`/`updateX`/`deleteX`/`upsertX`/`softDeleteX`/`restoreX`) directly; writes go through a
workflow, because compensation and retry live there. A deliberate bare write is annotated
`// arch:inline-mutation-ok(<reason>)` on the call's line or the line above.

**`step-retry`** — a workflow step whose body mutates a service must declare a retry class in its
object-form config (`maxRetries: n` or a spread `...RETRY_*` preset). Steps default to
`maxRetries: 0`, so a transient deadlock reverts real state a single retry would have absorbed.
Read-only steps are exempt.

**`step-compensation`** — a mutating step must either define a compensation function (the third
`createStep` argument) or declare `noCompensation: true` in its config — the flag Medusa's own
core-flows use. Honest non-compensation is allowed; it just has to be machine-readable rather than
implicit.

**`route-shadow`** — the same route path *and method* defined by two different packages. Medusa
loads routes core → plugins → app, last wins, no warning: one of your two handlers is dead code.
A deliberate override is annotated `// arch:route-override-ok(<reason>)` in the overriding file.

**`subscriber-id`** — every subscriber declares an explicit `config.context.subscriberId`. When it
is missing, Medusa infers an id from the function or file name — and two plugins with an
`order-placed.ts` dedupe each other's handlers silently.

**`named-when`** — every `when()` in a workflow uses the named overload
(`when('stable-name', values, cond)`). The unnamed form derives a `when-then-{ulid}` step name,
which is nondeterministic — checkpoint identity can drift across processes and releases.

## CI

```yaml
- run: npx verify-arch
```

Non-zero exit on any violation; that is the whole contract. Put it next to your linter, not
instead of it.

## Configuration

There is no config file. Two things are configurable at the call site:

- `--workflow-factory <name>` (repeatable) — if your project wraps `createWorkflow` in helpers
  (e.g. `createScheduledWorkflow`), name them so the workflow-scoped rules see through the wrapper:

  ```
  npx verify-arch . --workflow-factory createScheduledWorkflow
  ```

- The escape-hatch comments shown above: `arch:inline-mutation-ok(<reason>)` and
  `arch:route-override-ok(<reason>)`. Both require a reason in the parentheses, so exceptions stay
  documented at the site of the exception.

The rules are also exported as pure functions (`checkServiceNameUnique`, `checkRouteShadowing`, …)
that take collected inputs and return violations, so you can run a subset or feed them your own
file collection.

## Limits

Detection is regex and brace-matching over source text, not a TypeScript parse. That is a
deliberate trade: it is fast, dependency-free, and works on both source and build output — but it
is heuristic. The rules are written conservatively (only flag what confidently matches), so
expect the occasional miss rather than the occasional false alarm. Specifically:

- A `serviceName` computed at runtime, or a route path assembled dynamically, is invisible.
- The mutation heuristic keys on the `service.createX(...)` naming convention; a mutation behind a
  differently-named method won't be seen.
- Layout assumptions: modules under a `modules/` dir with a `Module(...)` call in `index.ts`,
  routes under `api/**/route.ts`, loader dirs named `workflows|subscribers|jobs`. That is standard
  Medusa 2.x project structure; exotic layouts won't be scanned.
- Everything under `packages/` is treated as a plugin for the namespacing rule; `apps/` and a
  root-level `src/` are treated as the app root.

## License

MIT
