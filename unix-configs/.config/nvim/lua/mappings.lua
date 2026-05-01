-- so that forward delete works in insert mode
vim.keymap.set("i", "<C-d>", "<Del>", { silent = true })

-- Reselect visual selection after indenting
vim.keymap.set("v", ">", ">gv", { silent = true })
vim.keymap.set("v", "<", "<gv", { silent = true })

-- Tmux-aware navigation (Alt+h/j/k/l)
local tmux_navigate = require("tmux-navigation").navigate

for _, key in ipairs({ "h", "j", "k", "l" }) do
  vim.keymap.set({ "n", "t" }, "<M-" .. key .. ">", function()
    tmux_navigate(key)
  end, { silent = true })
end
