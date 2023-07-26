local g = vim.g

g.mapleader = " "

-- so that Ctrl+C triggers InsertLeave autocmd
vim.keymap.set("i", "<C-c>", "<ESC>", { silent = true })
vim.keymap.set("i", "jk", "<ESC>", { silent = true })
-- so that forward delete works in insert mode
vim.keymap.set("i", "<C-d>", "<Del>", { silent = true })

-- Quickfix Menu
vim.keymap.set("n", "<leader>,", ":cp<CR>", { silent = true })
vim.keymap.set("n", "<leader>.", ":cn<CR>", { silent = true })

-- Toggle relative number
vim.keymap.set(
    "n",
    "<leader>r",
    ":exec &rnu == 1 ? 'set nornu!' : 'set rnu!'<CR>",
    { silent = true }
)

-- Reselect visual selection after indenting
vim.keymap.set("v", ">", ">gv", { silent = true })
vim.keymap.set("v", "<", "<gv", { silent = true })

-- Sort
vim.keymap.set("v", "<leader>s", ":sort<CR>", { silent = true })
