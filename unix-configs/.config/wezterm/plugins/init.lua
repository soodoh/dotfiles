-- Combine plugin config modules here
return {
	apply_to_config = function(config)
		local tabline = require("plugins.tabline")
		tabline.apply_to_config(config)
		local workspace_switcher = require("plugins.workspace_switcher")
		workspace_switcher.apply_to_config(config)
		-- local quick_domains = require("plugins.quick_domains")
		-- quick_domains.apply_to_config(config)
	end,
}
