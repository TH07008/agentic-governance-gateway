package company.custom

import rego.v1

test_allows_vendor_bot if {
	count(deny) == 0 with input as {
		"action": {
			"tool": "write_file",
			"agentId": "vendoring-bot",
			"params": {},
			"prompt": "",
		},
		"context": {
			"affectedPaths": ["vendor/foo.go"],
			"iterationCount": 0,
			"dailyCostUsd": 0,
			"monthlyCostUsd": 0,
		},
	}
}

test_denies_non_bot_vendor_edit if {
	count(deny) == 1 with input as {
		"action": {
			"tool": "write_file",
			"agentId": "claude-code",
			"params": {},
			"prompt": "",
		},
		"context": {
			"affectedPaths": ["vendor/foo.go"],
			"iterationCount": 0,
			"dailyCostUsd": 0,
			"monthlyCostUsd": 0,
		},
	}
}
