package company.custom

# Example custom policy: forbid edits inside the `vendor/` directory unless
# the agent is explicitly allowlisted. Demonstrates how to extend the gateway
# with organisation-specific rules without modifying the core policy set.

import rego.v1

deny contains "Edits to vendor/ are not allowed" if {
	input.action.tool == "write_file"
	some path in input.context.affectedPaths
	startswith(path, "vendor/")
	input.action.agentId != "vendoring-bot"
}
