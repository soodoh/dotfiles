local cmd = vim.cmd
local opt = vim.opt

-- basic settings
opt.backspace = "indent,eol,start" -- backspace works on every char in insert mode
opt.history = 1000
opt.mouse = 'a' -- fix for mouse in Alacritty
cmd('autocmd BufNewFile,BufRead *.json setl ft=jsonc') -- Treat JSON as JSONC

-- Display
opt.showmatch  = true -- show matching brackets
opt.hlsearch = false
opt.cursorline = true
opt.completeopt = "menuone,noselect"

-- Sidebar
opt.number = true -- line number on the left
opt.numberwidth = 3 -- always reserve 3 spaces for line number
opt.signcolumn = 'yes' -- keep 1 column for coc.vim  check
opt.modelines = 0
opt.showcmd = true -- display command in bottom bar

-- Search
opt.incsearch = true -- starts searching as soon as typing, without enter needed
opt.ignorecase = true -- ignore letter case when searching
opt.smartcase = true -- case insentive unless capitals used in search

-- White space
opt.autoindent = true
opt.smartindent = true
opt.tabstop = 2 -- 1 tab = 2 spaces
opt.softtabstop = 2
opt.shiftwidth = 2 -- indentation rule
opt.expandtab = true -- expand tab to spaces
opt.formatoptions = 'qnj1' -- q  - comment formatting; n - numbered lists; j - remove comment when joining lines; 1 - don't break after one-letter word

-- Switch between relative/absolute numbers
-- cmd([[
--  auto toggle between relative/absolute numbers
--  augroup numbertoggle
--    autocmd!
--    autocmd BufEnter,FocusGained,InsertLeave * set relativenumber
--    autocmd BufLeave,FocusLost,InsertEnter   * set norelativenumber
--  augroup END
-- ]])
