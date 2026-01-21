-- so that forward delete works in insert mode
vim.keymap.set("i", "<C-d>", "<Del>", { silent = true })

-- Reselect visual selection after indenting
vim.keymap.set("v", ">", ">gv", { silent = true })
vim.keymap.set("v", "<", "<gv", { silent = true })

-- Tmux-aware navigation (Alt+h/j/k/l and arrows)
-- Navigates neovim splits, then tmux panes, then tmux windows at edges
local function tmux_navigate(direction)
  local win = vim.api.nvim_get_current_win()
  vim.cmd("wincmd " .. direction)

  if win == vim.api.nvim_get_current_win() then
    local tmux_dir = ({ h = "L", j = "D", k = "U", l = "R" })[direction]
    local at_edge = ({ h = "pane_at_left", l = "pane_at_right", j = "pane_at_bottom", k = "pane_at_top" })[direction]
    local win_cmd = ({ h = "select-window -p", l = "select-window -n" })[direction]

    if win_cmd then
      vim.fn.system(("tmux if-shell '[ #{%s} -eq 1 ]' '%s' 'select-pane -%s'"):format(at_edge, win_cmd, tmux_dir))
    else
      vim.fn.system("tmux select-pane -" .. tmux_dir)
    end
  end
end

for _, key in ipairs({ "h", "j", "k", "l" }) do
  vim.keymap.set({ "n", "t" }, "<M-" .. key .. ">", function() tmux_navigate(key) end, { silent = true })
end
vim.keymap.set({ "n", "t" }, "<M-Left>", function() tmux_navigate("h") end, { silent = true })
vim.keymap.set({ "n", "t" }, "<M-Down>", function() tmux_navigate("j") end, { silent = true })
vim.keymap.set({ "n", "t" }, "<M-Up>", function() tmux_navigate("k") end, { silent = true })
vim.keymap.set({ "n", "t" }, "<M-Right>", function() tmux_navigate("l") end, { silent = true })
