# openapi-bridge-typescript

OpenAPI 3.1 descriptions of CRUD APIs for [model-algebra](https://github.com/model-algebra/model-algebra) models,
and the models back from such descriptions.

- **`OpenApiBridge`**: one model ↔ the OpenAPI document of its API
- **`OpenApiSetBridge`**: a `ModelSet` ↔ one OpenAPI document for all of the models

## Installation

```sh
pnpm add github:model-algebra/openapi-bridge-typescript
```

The built package is in the repository, so nothing is built when it is installed.

## Models to OpenAPI

```ts
import { OpenApiSetBridge } from 'openapi-bridge-typescript'

const document = new OpenApiSetBridge({ title: 'Shop API' }).toTarget(models)   // a ModelSet
fs.writeFileSync('openapi.json', JSON.stringify(document, null, 2))
```

The document is a plain object. Write it as JSON as above, or as YAML with any YAML library.

For each model, e.g. `User`:

| Path | Operations |
|---|---|
| `/users` | `GET` lists records page by page (`limit`, `offset`); `POST` creates one and answers `201` with its URL in `Location` |
| `/users/{id}` | `GET` reads one, `PUT` replaces it, `PATCH` changes some fields, `DELETE` deletes it |

| Schema | |
|---|---|
| `User` | A record as the API returns it, with the whole model |
| `UserInput` | What clients send to create or replace a record: no values the database generates; required are the fields that must not be null and have no default |
| `UserPatch` | What clients send to change some fields, as a JSON Merge Patch (RFC 7396, `application/merge-patch+json`): the fields given replace the record's, `null` clears a field, the others keep their values |
| `UserList` | A page of records: `items` and the `total` number of records |
| `Problem` | Errors: RFC 9457 problem details, as `application/problem+json` |

Errors are problem details:

| Status | When |
|---|---|
| `400` | The request is malformed: the body is not valid JSON, or a query parameter is not valid |
| `404` | There is no such record |
| `409` | The record conflicts with another one, e.g. a duplicate unique value |
| `412` | With `etags`: the record has changed since the version given in `If-Match` |
| `415` | The body is not in a media type the operation accepts |
| `422` | The record is not valid: a value breaks a constraint of the model |
| `default` | An unexpected error |

Item paths use the primary key: the `primaryKey` field, or the fields of a `primaryKey` table constraint.
A composite key gives paths like `/tickets/{eventId}/{seat}`. Models without a primary key get only the collection
operations.

Names come from model names: `UserProfile` has the schema `UserProfile`, the path `/user-profiles` and the operations
`listUserProfiles`, `createUserProfile`, `getUserProfile`, and so on.

### Example

```json
{ "metadata": { "name": "User", "version": "1.0.0" },
  "fields": [
    { "name": "id", "type": "INT64", "constraints": { "primaryKey": true, "identity": "always", "nullable": false } },
    { "name": "email", "type": "STRING", "parameters": { "length": 100 }, "constraints": { "nullable": false, "unique": true } },
    { "name": "age", "type": "INT16", "constraints": { "min": 0 } }
  ] }
```

gives the paths `/users` (`listUsers`, `createUser`) and `/users/{id}` (`getUser`, `replaceUser`, `updateUser`,
`deleteUser`), and these schemas, among others:

```json
"User": {
  "type": "object",
  "properties": {
    "id": { "type": "integer", "format": "int64", "readOnly": true, "x-identity": "always", "x-primary-key": true },
    "email": { "type": "string", "maxLength": 100, "x-unique": true },
    "age": { "type": ["integer", "null"], "format": "int16", "minimum": 0 }
  },
  "required": ["id", "email"],
  "x-model": { "name": "User", "version": "1.0.0" }
},
"UserInput": {
  "type": "object",
  "description": "User to create, or to replace an existing one with",
  "properties": {
    "email": { "type": "string", "maxLength": 100 },
    "age": { "type": ["integer", "null"], "format": "int16", "minimum": 0 }
  },
  "required": ["email"]
}
```

### Sorting and filtering

When fields are `sortable` or `filterable`, or the model has `sortings` or `filters` (see
[model-schema](https://github.com/model-algebra/model-schema#sorting-and-filtering)), list operations get query
parameters. A field's unnamed definition takes the field's name; named ones are `<field>.<name>`:

| Parameter | From |
|---|---|
| `sort=lastName,-age,byName` | Sort keys, applied in order; `-` sorts in descending order. The allowed keys come from sortable fields and from the model's sort orders |
| `lastName=Smith` | A filter comparing the field with the value the client gives: `{ "op": "=" }` |
| `age.gte=18`, `age.lte=65` | The same with operators the client chooses: `{ "ops": [">=", "<="] }`; the suffixes are `eq`, `ne`, `lt`, `lte`, `gt`, `gte` |
| `lastName.prefix=Sm` | A predicate with an argument: `startsWith(lastName, row, "Sm")` |
| `status.active=true` | A filter the client only switches on: a fixed value, another field, or a predicate without an argument |
| `adults=true`, `nearby=5` | Named filters of the model; switches, or a predicate with an argument: `isWithinKm(row, 5)` |

Values are validated with the schema of the field, or of the declared argument type. A filter can't be named like
another one or like `limit`, `offset` or `sort`, and sort and filter definitions must name existing fields.

### Options

| Option | Default | |
|---|---|---|
| `title`, `version`, `description` | `API` or `<model> API`; the model version or `1.0.0` | `info` of the document |
| `servers` | | `servers` of the document |
| `operations` | all | Which of `list`, `create`, `read`, `replace`, `update`, `delete` to describe |
| `paths` | from model names | Collection paths by model name, e.g. `{ Person: '/people' }` |
| `defaultPageSize`, `maxPageSize` | 20, 100 | Default and largest `limit` |
| `etags` | `false` | Optimistic locking: responses with a record have an `ETag`; `PUT`, `PATCH` and `DELETE` take `If-Match` and fail with `412` when the record has changed since, so no client overwrites changes it hasn't seen |
| `pageLinks` | `false` | List pages have `links` to the `self`, `first`, `prev`, `next` and `last` pages |

### Types

| Model type | JSON Schema |
|---|---|
| `INT16`, `INT32`, `INT64` | `integer`, format `int16`, `int32`, `int64` |
| `FLOAT32`, `FLOAT64` | `number`, format `float`, `double` |
| `DECIMAL` | `number`, format `decimal`; precision and scale in `x-precision`, `x-scale` |
| `STRING`, `TEXT` | `string`; `maxLength` for `STRING` with a length |
| `BOOLEAN` | `boolean` |
| `UUID`, `BYTES`, `DATE`, `TIME`, `DURATION` | `string`, format `uuid`, `byte`, `date`, `time`, `duration` |
| `TIMESTAMP`, `TIMESTAMP_TZ` | `string`, format `local-date-time`, `date-time` |
| `ENUM` | `string` with `enum` |
| `JSON` | any value: `{}` |
| `OBJECT` | `$ref` to the schema of the model; `object` with `x-ref` when the document has none |
| `UNION` | `oneOf` |
| `ARRAY` | `array` with `items` |

A field may be null unless it is `nullable: false`: then `null` is among its types. Fields that must not be null are
`required`. Constraints map to `minimum`, `maximum`, `pattern`, `enum`, `default` and `readOnly` (identity). What JSON
Schema can't say goes into extensions, so that the model can be read back:

| Extension | |
|---|---|
| `x-model` | On the schema of a model: its name, version, database schema, table constraints, indexes, sort orders and filters |
| `x-sortable`, `x-filterable` | How records can be sorted and filtered by the field |
| `x-primary-key`, `x-unique`, `x-foreign-key`, `x-required`, `x-identity` | Field constraints |
| `x-default-function` | `default: { function }`: `now`, `currentDate`, `uuid` |
| `x-precision`, `x-scale`, `x-ref` | Type parameters |
| `x-targets` | Target options of the field, e.g. the PostgreSQL type |

Request bodies (`UserInput`, `UserPatch`) and path parameters have no extensions.

## OpenAPI to models

```ts
const models = new OpenApiSetBridge().toModel(document)   // a ModelSet
const model = new OpenApiBridge().toModel(document)       // when the document has one model
```

Schemas with `x-model` are read as models. Documents written by others have none; then every `object` schema with
`properties` is a model. Their types are read from types and formats, e.g. `string` with format `date-time` as
`TIMESTAMP_TZ`, `number` without a format as `FLOAT64`, and `$ref` as `OBJECT`.

Models in canonical form come back unchanged, and documents written from read models are the same documents. Other
models come back in canonical form:

- **Legacy types:** `integer`, `number`, `string`, `boolean`, `date`, `object` become `INT32`, `DECIMAL`, `TEXT`,
  `BOOLEAN`, `DATE`, `JSON`.
- **Other types:** `STRING` without a length becomes `TEXT`, and `DATETIME` becomes `TIMESTAMP`.
- **Allowed values:** `TEXT` with allowed values becomes `ENUM`, and so do the items of arrays.
- **Constraints:** `nullable: true` is left out, as fields are nullable unless they say otherwise; `foreign_key`
  becomes `foreignKey`.

## Development

```sh
git submodule update --init   # src/examples
pnpm install
pnpm test            # vitest
pnpm test:coverage   # with a coverage report
pnpm type-check
pnpm build
```

The tests check every document against the OpenAPI 3.1 schema, with
[@seriousme/openapi-schema-validator](https://github.com/seriousme/openapi-schema-validator).

`dist/` is committed, because other projects install the package from GitHub without building it. Enable the
pre-commit hook once per clone; it rebuilds `dist/` and adds it to every commit that changes the sources:

```sh
git config core.hooksPath .githooks
```

CI fails when the committed `dist/` differs from a build of the sources.

## License

MIT
