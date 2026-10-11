# @binarycastle/apidoc-cli

Compare two versions of an OpenAPI/Swagger document and fail CI on breaking
changes, and run Arazzo workflows as smoke tests.

**[Live demo](https://binary-castle.github.io/apidoc/)** · [Documentation](https://github.com/binary-castle/apidoc#readme)

```bash
npx @binarycastle/apidoc-cli diff origin/main:openapi.yaml openapi.yaml --fail-on breaking
```

```
Orbit Payments API  v2.3.0 → v2.4.0

  3 breaking · 3 warnings · 1 added · 1 removed · 1 deprecated · 7 changed

REMOVED    GET /v2/customers/{id}/sources  List payment sources

CHANGED    POST /v2/customers  Create a customer
  ✖ request body address.country: pattern /^[A-Z]{2}$/ added
  · request body address.country: maximum length 64 removed
```

## Usage

```
apidoc diff <old> <new> [--format text|markdown|json] [--fail-on breaking|warning]
```

`<old>` and `<new>` can each be a file, an `http(s)` URL, or a git revision
`<ref>:<path>` (e.g. `origin/main:openapi.yaml`).

- `--format markdown` writes upgrade notes you can paste into a PR or release.
- `--format json` prints the full diff for your own tooling.
- `--fail-on breaking` exits 1 when there are breaking changes; `--fail-on warning` also fails on changes worth checking.

Exit codes: `0` ok, `1` threshold reached, `2` usage or load error.

## What counts as breaking

Direction matters. Narrowing what the API **accepts** breaks callers: new
required fields or parameters, removed enum values, tighter length/range
limits, new patterns, `null` no longer allowed. Widening what it **returns**
breaks clients: removed fields, fields that may now be missing or `null`,
removed success responses or media types. New response enum values are
reported as worth checking.

Operations match on method and full path, so renaming `{id}` to `{customerId}`
or moving `/api` between `servers` and `paths` isn't reported as remove + add.

## Workflows as smoke tests

```bash
npx @binarycastle/apidoc-cli run workflows.arazzo.yaml --server https://staging.example.com \
  --input email=ci@example.com --header "Authorization: Bearer $TOKEN"
```

```
✓ onboardAndCharge  passed
  ✓ createCustomer     POST /api/v1/customers/  201  29 ms
  ✓ chargeCustomer     POST /api/v1/payments/  201  4 ms
  ✓ refundPart         POST /api/v1/payments/{id}/refund/  200  4 ms
  outputs {"customerId":4,"paymentId":1,"refundStatus":"refunded"}
```

```
apidoc run <arazzo> [--workflow <id>] [--spec <openapi>] [--server <url>]
                    [--input name=value]... [--header "Name: value"]... [--format text|json]
```

Runs every workflow in the [Arazzo 1.0](https://spec.openapis.org/arazzo/latest.html)
document (or just `--workflow`), passing outputs between steps, and exits 1 if
any step fails. `--spec` defaults to the document's first `sourceDescription`;
`--server` to the spec's first absolute server URL. Input values are parsed as
JSON when they can be (`--input amount=4900` is a number).

## GitHub Actions

```yaml
- uses: actions/checkout@v7
  with: { fetch-depth: 0 }
- run: npx @binarycastle/apidoc-cli diff origin/${{ github.base_ref }}:openapi.yaml openapi.yaml --fail-on breaking
```

For generated specs, export both sides first, e.g. Django:
`python manage.py spectacular --file openapi.yaml`.

Node 20+. MIT licensed. Source: https://github.com/binary-castle/apidoc
