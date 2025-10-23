local wezterm = require("wezterm")
local domains = wezterm.plugin.require("https://github.com/DavidRR-F/quick_domains.wezterm")

return {
	apply_to_config = function(config)
		domains.apply_to_config(config, {
			keys = {
				-- open domain in new tab
				attach = {
					key = "w",
					mods = "LEADER",
					tbl = "",
				},
				vsplit = nil,
				hsplit = nil,
			},
			-- auto-configuration
			auto = {
				-- disable ssh multiplex auto config
				ssh_ignore = true,
				-- disable exec domain auto configs
				exec_ignore = {
					ssh = true,
					docker = true,
					kubernetes = true,
				},
			},
		})
	end,
}
