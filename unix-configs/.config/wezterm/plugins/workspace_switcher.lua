local wezterm = require("wezterm")
local workspace_switcher = wezterm.plugin.require("https://github.com/MLFlexer/smart_workspace_switcher.wezterm")

local is_darwin = function()
	return wezterm.target_triple:find("darwin") ~= nil
end

-- Accomodate sharing config with MacOS + Linux
if is_darwin() then
	workspace_switcher.zoxide_path = "/opt/homebrew/bin/zoxide"
else
	workspace_switcher.zoxide_path = "/usr/bin/zoxide"
end

return {
	apply_to_config = function(config)
		table.insert(config.keys, {
			key = "w",
			mods = "ALT",
			action = workspace_switcher.switch_workspace(),
		})
		table.insert(config.keys, { key = "Tab", mods = "ALT", action = workspace_switcher.switch_to_prev_workspace() })
	end,
}
