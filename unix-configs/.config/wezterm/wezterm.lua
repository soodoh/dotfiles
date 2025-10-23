local wezterm = require("wezterm")
local config = wezterm.config_builder()
-- Setup table so modules can insert to it
config.keys = {}

-- Split up settings into relevant modules
local keybindings = require("keybindings")
keybindings.apply_to_config(config)

local ui = require("ui")
ui.apply_to_config(config)

local plugins = require("plugins")
plugins.apply_to_config(config)

return config
