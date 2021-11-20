-- basic settings
vim.o.encoding = "utf-8"
vim.o.backspace = "indent,eol,start" -- backspace works on every char in insert mode
vim.o.history = 1000
vim.o.mouse = 'a' -- fix for mouse in Alacritty
vim.cmd('autocmd BufNewFile,BufRead *.json setl ft=jsonc') -- Treat JSON as JSONC

-- Display
vim.o.showmatch  = true -- show matching brackets
vim.o.hlsearch = false
vim.o.cursorline = true

-- Sidebar
vim.o.number = true -- line number on the left
vim.o.numberwidth = 3 -- always reserve 3 spaces for line number
vim.o.signcolumn = 'yes' -- keep 1 column for coc.vim  check
vim.o.modelines = 0
vim.o.showcmd = true -- display command in bottom bar

-- Search
vim.o.incsearch = true -- starts searching as soon as typing, without enter needed
vim.o.ignorecase = true -- ignore letter case when searching
vim.o.smartcase = true -- case insentive unless capitals used in search

-- White space
vim.o.autoindent = true
vim.o.smartindent = true
vim.o.tabstop = 2 -- 1 tab = 2 spaces
vim.o.shiftwidth = 2 -- indentation rule
vim.o.expandtab = true -- expand tab to spaces
vim.o.formatoptions = 'qnj1' -- q  - comment formatting; n - numbered lists; j - remove comment when joining lines; 1 - don't break after one-letter word

-- set the theme (must be placed after plugins)
vim.cmd('colorscheme nord')

-- Switch between relative/absolute numbers
-- vim.cmd([[
--  auto toggle between relative/absolute numbers
--  augroup numbertoggle
--    autocmd!
--    autocmd BufEnter,FocusGained,InsertLeave * set relativenumber
--    autocmd BufLeave,FocusLost,InsertEnter   * set norelativenumber
--  augroup END
-- ]])
