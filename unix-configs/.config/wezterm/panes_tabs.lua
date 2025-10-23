local wezterm = require("wezterm")

local switch_previous = wezterm.action_callback(function(window, pane)
	local tab = window:mux_window():active_tab()
	if tab:get_pane_direction("Left") ~= nil then
		window:perform_action(wezterm.action.ActivatePaneDirection("Left"), pane)
	else
		window:perform_action(wezterm.action.ActivateTabRelative(-1), pane)
	end
end)

local switch_next = wezterm.action_callback(function(window, pane)
	local tab = window:mux_window():active_tab()
	if tab:get_pane_direction("Right") ~= nil then
		window:perform_action(wezterm.action.ActivatePaneDirection("Right"), pane)
	else
		window:perform_action(wezterm.action.ActivateTabRelative(1), pane)
	end
end)

return {
	apply_to_config = function(config)
		-- Tab management
		table.insert(
			config.keys,
			{ key = "x", mods = "ALT", action = wezterm.action.CloseCurrentPane({ confirm = false }) }
		)
		table.insert(config.keys, { key = "t", mods = "ALT", action = wezterm.action.SpawnTab("CurrentPaneDomain") })
		table.insert(config.keys, { key = "n", mods = "ALT", action = wezterm.action.SpawnTab("CurrentPaneDomain") })
		table.insert(config.keys, { key = "i", mods = "ALT", action = wezterm.action.MoveTabRelative(-1) })
		table.insert(config.keys, { key = "o", mods = "ALT", action = wezterm.action.MoveTabRelative(1) })
		table.insert(config.keys, {
			key = "s",
			mods = "ALT",
			action = wezterm.action.SplitVertical({ domain = "CurrentPaneDomain" }),
		})
		table.insert(config.keys, {
			key = "v",
			mods = "ALT",
			action = wezterm.action.SplitHorizontal({ domain = "CurrentPaneDomain" }),
		})

		-- Pane Management
		table.insert(config.keys, { key = "z", mods = "LEADER", action = wezterm.action.TogglePaneZoomState })
		table.insert(config.keys, {
			key = "LeftArrow",
			mods = "ALT",
			action = switch_previous,
		})
		table.insert(config.keys, {
			key = "h",
			mods = "ALT",
			action = switch_previous,
		})
		table.insert(config.keys, {
			key = "RightArrow",
			mods = "ALT",
			action = switch_next,
		})
		table.insert(config.keys, {
			key = "l",
			mods = "ALT",
			action = switch_next,
		})
		table.insert(config.keys, {
			key = "UpArrow",
			mods = "ALT",
			action = wezterm.action.ActivatePaneDirection("Up"),
		})
		table.insert(config.keys, {
			key = "k",
			mods = "ALT",
			action = wezterm.action.ActivatePaneDirection("Up"),
		})
		table.insert(config.keys, {
			key = "DownArrow",
			mods = "ALT",
			action = wezterm.action.ActivatePaneDirection("Down"),
		})
		table.insert(config.keys, {
			key = "j",
			mods = "ALT",
			action = wezterm.action.ActivatePaneDirection("Down"),
		})
	end,
}
