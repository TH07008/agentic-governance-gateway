# Example policy bundle

This directory shows how to add your own OPA bundle to the gateway. With the
JS fallback evaluator in use, these files are not required to run the gateway,
but they are the canonical policy definitions when OPA is available.

## Files

- `agentic_gateway.rego`           – the production policies
- `agentic_gateway_test.rego`      – `opa test` unit tests
- `custom/company.rego`            – example of an additional policy module
- `custom/company_test.rego`       – example tests for the custom module

## Building a WASM bundle

```bash
opa build -t wasm -e agentic_gateway/decision policies/agentic_gateway.rego
mv bundle.wasm policies/bundle.wasm
```

Then point the gateway at it via `OPA_WASM_PATH=./policies/bundle.wasm` and
set `POLICY_FALLBACK_JS=false` if you want OPA-only evaluation.

## Running tests

```bash
opa test policies/ -v
```