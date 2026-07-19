package agentic_gateway

# Unit tests for the Rego policy set, runnable with `opa test policies/`.
# Each test mirrors a test case in tests/unit/policy-rules.test.ts so the
# parity test can assert both evaluators agree.

import rego.v1

test_allows_safe_write_file if {
	count(deny) == 0 with input as action_input("write_file", {"path": "src/index.ts"}, 0, 0, 0, [], "safe prompt")
	count(require_review) == 0 with input as action_input("write_file", {"path": "src/index.ts"}, 0, 0, 0, [], "safe prompt")
}

test_denies_ssn_in_prompt if {
	some msg in deny with input as action_input("write_file", {}, 0, 0, 0, [], "My SSN is 123-45-6789")
	msg == "Prompt contains what looks like a US Social Security Number"
}

test_denies_aws_key_in_params if {
	count(deny) > 0 with input as action_input("write_file", {"key": "AKIAIOSFODNN7EXAMPLE"}, 0, 0, 0, [], "")
}

test_denies_hardcoded_secret if {
	count(deny) > 0 with input as action_input("write_file", {"content": "api_key='abcdef0123456789'"}, 0, 0, 0, [], "")
}

test_denies_drop_table if {
	count(deny) > 0 with input as action_input("execute_sql", {"sql": "DROP TABLE users"}, 0, 0, 0, [], "")
}

test_denies_rm_rf_root if {
	count(deny) > 0 with input as action_input("bash", {"command": "rm -rf /"}, 0, 0, 0, [], "")
}

test_denies_too_many_iterations if {
	count(deny) > 0 with input as action_input("write_file", {}, 6, 0, 0, [], "")
}

test_denies_daily_budget if {
	count(deny) > 0 with input as action_input("write_file", {}, 0, 50, 0, [], "")
}

test_requires_review_for_openapi if {
	count(deny) == 0 with input as action_input("git_push", {}, 0, 0, 0, ["src/openapi.yaml"], "")
	count(require_review) > 0 with input as action_input("git_push", {}, 0, 0, 0, ["src/openapi.yaml"], "")
}

test_requires_review_for_prod_path if {
	count(require_review) > 0 with input as action_input("git_push", {}, 0, 0, 0, ["infra/prod/config.yaml"], "")
}

test_allows_non_sensitive_git_push if {
	count(deny) == 0 with input as action_input("git_push", {}, 0, 0, 0, ["README.md"], "")
	count(require_review) == 0 with input as action_input("git_push", {}, 0, 0, 0, ["README.md"], "")
}

# --- helpers ------------------------------------------------------------

action_input(tool, params, iteration, daily_cost, monthly_cost, paths, prompt) := {
	"action": {
		"id": "test-id",
		"agentId": "test-agent",
		"sessionId": "test-session",
		"tool": tool,
		"params": params,
		"prompt": prompt,
		"model": "test-model",
		"timestamp": "2026-01-01T00:00:00Z",
		"iteration": iteration,
	},
	"context": {
		"iterationCount": iteration,
		"dailyCostUsd": daily_cost,
		"monthlyCostUsd": monthly_cost,
		"affectedPaths": paths,
	},
}
