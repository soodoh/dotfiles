local g = vim.g
local keymap = require('utils').keymap

g.mapleader = " "

-- Directional Hotkeys
keymap('', 'h', '<Nop>')
keymap('', 'j', 'h')
keymap('', 'k', 'j')
keymap('', 'l', 'k')
keymap('', "'", 'l')
keymap('', 'h', '<Nop>')
keymap('', 'h', '<Nop>')
keymap('', 'h', '<Nop>')
keymap('', '<C-w>j', '<C-w>h')
keymap('', '<C-w>k', '<C-w>j')
keymap('', '<C-w>l', '<C-w>k')
keymap('', "<C-w>'", '<C-w>l')
keymap('', '<C-w>J', '<C-w>H')
keymap('', '<C-w>K', '<C-w>J')
keymap('', '<C-w>L', '<C-w>K')
keymap('', '<C-w>"', '<C-w>L')

-- so that Ctrl+C triggers InsertLeave autocmd
keymap('i', '<C-c>', '<ESC>')
keymap('i', 'jk', '<ESC>')
-- so that forward delete works in insert mode
keymap('i', '<C-d>', '<Del>')

-- Buffers
keymap('n', '<leader>,', ':bp<CR>')
keymap('n', '<leader>.', ':bn<CR>')
