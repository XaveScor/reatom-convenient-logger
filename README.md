# @xavescor/reatom-convenient-logger

A flat, mappable alternative to `@reatom/core`'s `connectLogger`.
Every Reatom event is mapped to exactly one console call, making the output
easier to inspect with browser automation and LLM tooling.

## Usage

Call `connectLogger` before importing application models, just like the Reatom
logger. Changing an existing setup only requires changing the import source.

```ts
import { connectLogger } from '@xavescor/reatom-convenient-logger'

connectLogger()
```

Customize every record by returning the arguments for a single log call:

```ts
connectLogger({
  match: (name) => !name.includes('internal'),
  map: (record) => [
    'REATOM_EVENT',
    {
      type: record.type,
      name: record.name,
      data: record,
    },
  ],
  log: (...args) => console.log(...args),
})
```

`match` has the same contract as Reatom's logger: return `false` to skip a
record, `true` to include it, or a color string. The color is available as
`record.color` and is used by the default mapper.

## Records

Atom records include `state`, `prevState`, and `connected`. Action records
include `params` and `payload`. All records include `name`, `timestamp`,
`serial`, `stack`, `error`, and `aborted` metadata.

Private Reatom entities and unchanged atom states are skipped in the same way
as the built-in logger.
