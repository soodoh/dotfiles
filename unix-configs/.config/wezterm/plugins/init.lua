-- Combine plugin config modules here
return {
	apply_to_config = function(config)
		local tabline = require("plugins.tabline")
		tabline.apply_to_config(config)
		local sessionizer = require("plugins.sessionizer")
		sessionizer.apply_to_config(config)
	end,
}
