-- Basic settings
vim.g.mapleader = " "
vim.opt.backspace = "indent,eol,start" -- backspace works on every char in insert mode
vim.opt.history = 1000

-- Display
vim.opt.showmatch = true -- show matching brackets
vim.opt.hlsearch = false
vim.opt.cursorline = true
vim.opt.completeopt = "menu,menuone,noselect"
vim.opt.termguicolors = true
-- Keep cursor in view
vim.opt.scrolloff = 8
vim.opt.sidescrolloff = 8
-- Git diff
vim.opt.diffopt = "vertical"

-- Status column
vim.opt.relativenumber = true
vim.opt.number = true
vim.opt.numberwidth = 3 -- always reserve 3 spaces for line number
vim.opt.modelines = 0
vim.opt.showcmd = true  -- display command in bottom bar

-- Search
vim.opt.incsearch = true  -- starts searching as soon as typing, without enter needed
vim.opt.ignorecase = true -- ignore letter case when searching
vim.opt.smartcase = true  -- case insentive unless capitals used in search

-- White space
vim.opt.wrap = true
vim.opt.autoindent = true
vim.opt.smartindent = true
vim.opt.softtabstop = 2
vim.opt.shiftwidth = 2   -- indentation rule
vim.opt.tabstop = 2      -- 1 tab = 2 spaces
vim.opt.expandtab = true -- expand tab to spaces
-- q  - comment formatting; n - numbered lists; j - remove comment when joining lines; 1 - don't break after one-letter word
vim.opt.formatoptions = "qnj1"
