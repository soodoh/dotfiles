-- Combine keybinding modules here
return {
	apply_to_config = function(config)
		local panes_tabs = require("keybindings.panes_tabs")
		panes_tabs.apply_to_config(config)
		local common = require("keybindings.common")
		common.apply_to_config(config)
	end,
}
