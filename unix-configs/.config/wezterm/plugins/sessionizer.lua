local wezterm = require("wezterm")
local sessionizer = wezterm.plugin.require("https://github.com/mikkasendke/sessionizer.wezterm")
local history = wezterm.plugin.require("https://github.com/mikkasendke/sessionizer-history")

-- Define the sessionizer schema
local schema = {
	options = {
		callback = history.Wrapper(sessionizer.DefaultCallback),
	},
	sessionizer.DefaultWorkspace({}),
	sessionizer.AllActiveWorkspaces({}),
	sessionizer.FdSearch({
		wezterm.home_dir .. "/Documents/engineering-knowledge/repos",
		max_depth = 2,
		include_submodules = true,
	}),
	sessionizer.FdSearch({
		wezterm.home_dir .. "/Documents",
		max_depth = 2,
		include_submodules = true,
	}),

	-- Process entries to make paths more readable
	processing = sessionizer.for_each_entry(function(entry)
		entry.label = entry.label:gsub(wezterm.home_dir, "~")
	end),
}

return {
	apply_to_config = function(config)
		-- Sessionizer keybinding - shows the sessionizer menu
		table.insert(config.keys, {
			key = "w",
			mods = "ALT",
			action = sessionizer.show(schema),
		})
		-- Switch to most recent workspace
		table.insert(config.keys, {
			key = "Tab",
			mods = "ALT",
			action = history.switch_to_most_recent_workspace,
		})
	end,
}
