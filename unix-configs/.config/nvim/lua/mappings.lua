-- so that forward delete works in insert mode
vim.keymap.set("i", "<C-d>", "<Del>", { silent = true })

-- Reselect visual selection after indenting
vim.keymap.set("v", ">", ">gv", { silent = true })
vim.keymap.set("v", "<", "<gv", { silent = true })
