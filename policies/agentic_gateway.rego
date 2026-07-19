package agentic_gateway

# Agentic Governance Gateway – canonical Rego policy set.
#
# These rules mirror the TypeScript rules in src/core/policy-engine/rules.ts.
# Both evaluators MUST produce equivalent decisions for the same input. The
# cross-implementation test in tests/integration/policy-parity.test.ts
# verifies that property.
#
# Input shape:
#   input.action.{id,agentId,sessionId,tool,params,prompt,model,timestamp,iteration,parentActionId}
#   input.context.{iterationCount,dailyCostUsd,monthlyCostUsd,affectedPaths}

import rego.v1

# --- Deny rules ---------------------------------------------------------

deny contains "Prompt contains what looks like a US Social Security Number" if {
	contains_ssn(input.action.prompt)
}

deny contains "Prompt contains what looks like a US Social Security Number" if {
	contains_ssn(json.marshal(input.action.params))
}

deny contains "Prompt or params contain an AWS access key id" if {
	contains_aws_key(input.action.prompt)
}

deny contains "Prompt or params contain an AWS access key id" if {
	contains_aws_key(json.marshal(input.action.params))
}

deny contains "Action params contain a hardcoded secret assignment" if {
	contains_secret_assignment(input.action.prompt)
}

deny contains "Action params contain a hardcoded secret assignment" if {
	contains_secret_assignment(json.marshal(input.action.params))
}

deny contains "Task exceeded the maximum number of agent iterations (5)" if {
	input.context.iterationCount > 5
}

deny contains "Daily token budget exceeded for this agent" if {
	input.context.dailyCostUsd >= 50
}

deny contains "Monthly token budget exceeded for this agent" if {
	input.context.monthlyCostUsd >= 1000
}

deny contains "Direct DROP TABLE statements are not allowed" if {
	input.action.tool == "execute_sql"
	contains(lower(input.action.params.sql), "drop table")
}

deny contains "Recursive force-delete commands are not allowed" if {
	input.action.tool == "bash"
	contains(lower(input.action.params.command), "rm -rf /")
}

# --- Review rules -------------------------------------------------------

require_review contains "Changes to API contract files require human review" if {
	input.action.tool == "git_push"
	some path in input.context.affectedPaths
	endswith(path, "openapi.yaml")
}

require_review contains "Changes to API contract files require human review" if {
	input.action.tool == "git_push"
	some path in input.context.affectedPaths
	endswith(path, "openapi.json")
}

require_review contains "Changes to API contract files require human review" if {
	input.action.tool == "git_push"
	some path in input.context.affectedPaths
	endswith(path, "swagger.json")
}

require_review contains "Changes touching production paths require human review" if {
	input.action.tool == "git_push"
	some path in input.context.affectedPaths
	contains(lower(path), "/prod/")
}

require_review contains "Changes touching production paths require human review" if {
	input.action.tool == "git_push"
	some path in input.context.affectedPaths
	contains(lower(path), "/production/")
}

require_review contains "Changes touching production paths require human review" if {
	input.action.tool == "git_push"
	some path in input.context.affectedPaths
	contains(lower(path), "infra/terraform/")
}

# --- Helpers ------------------------------------------------------------

contains_ssn(s) if {
	regex.match("\\b[0-9]{3}-[0-9]{2}-[0-9]{4}\\b", s)
}

contains_aws_key(s) if {
	regex.match("AKIA[0-9A-Z]{16}", s)
}

contains_secret_assignment(s) if {
	regex.match("(?i)(api[_-]?key|secret|token|password)\\s*[:=]\\s*\\\\?['\"][A-Za-z0-9_\\-]{16,}\\\\?['\"]", s)
}
