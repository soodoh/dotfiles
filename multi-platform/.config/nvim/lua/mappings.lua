local g = vim.g
local keymap = require("utils").keymap

g.mapleader = " "

-- so that Ctrl+C triggers InsertLeave autocmd
keymap("i", "<C-c>", "<ESC>")
keymap("i", "jk", "<ESC>")
-- so that forward delete works in insert mode
keymap("i", "<C-d>", "<Del>")

-- Quickfix Menu
keymap("n", "<leader>,", ":cp<CR>")
keymap("n", "<leader>.", ":cn<CR>")

-- Toggle relative number
keymap("n", "<leader>r", ":exec &rnu == 1 ? 'set nornu!' : 'set rnu!'<CR>")

-- Reselect visual selection after indenting
keymap("v", ">", ">gv")
keymap("v", "<", "<gv")
