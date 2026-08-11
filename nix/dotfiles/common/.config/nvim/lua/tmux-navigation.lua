local M = {}

local direction_to_tmux_pane = {
  h = "L",
  j = "D",
  k = "U",
  l = "R",
}

local direction_to_tmux_edge = {
  h = "pane_at_left",
  j = "pane_at_bottom",
  k = "pane_at_top",
  l = "pane_at_right",
}

local direction_to_tmux_window_command = {
  h = "select-window -p",
  l = "select-window -n",
}

local function current_window_is_floating()
  return vim.api.nvim_win_get_config(0).relative ~= ""
end

local function navigate_tmux(direction)
  local tmux_direction = direction_to_tmux_pane[direction]
  local tmux_edge = direction_to_tmux_edge[direction]
  local tmux_window_command = direction_to_tmux_window_command[direction]

  if tmux_window_command then
    vim.fn.system(
      ("tmux if-shell '[ #{%s} -eq 1 ]' '%s' 'select-pane -%s'"):format(
        tmux_edge,
        tmux_window_command,
        tmux_direction
      )
    )
    return
  end

  vim.fn.system("tmux select-pane -" .. tmux_direction)
end

function M.navigate(direction)
  local current_window = vim.api.nvim_get_current_win()

  if current_window_is_floating() then
    navigate_tmux(direction)
    return
  end

  vim.cmd("wincmd " .. direction)

  if current_window == vim.api.nvim_get_current_win() then
    navigate_tmux(direction)
  end
end

return M
