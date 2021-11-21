local g = vim.g
local map = vim.api.nvim_set_keymap
local default_opts = { noremap = true, silent = true }

g.mapleader = " "

-- LSP bindings
map('n', 'gD', '<cmd>lua vim.lsp.buf.declaration()<CR>', default_opts)
map('n', 'gd', '<cmd>lua vim.lsp.buf.definition()<CR>', default_opts)
map('n', 'K', '<cmd>lua vim.lsp.buf.hover()<CR>', default_opts)
map('n', 'gi', '<cmd>lua vim.lsp.buf.implementation()<CR>', default_opts)
map('n', '<C-k>', '<cmd>lua vim.lsp.buf.signature_help()<CR>', default_opts)
map('n', '<space>wa', '<cmd>lua vim.lsp.buf.add_workspace_folder()<CR>', default_opts)
map('n', '<space>wr', '<cmd>lua vim.lsp.buf.remove_workspace_folder()<CR>', default_opts)
map('n', '<space>wl', '<cmd>lua print(vim.inspect(vim.lsp.buf.list_workspace_folders()))<CR>', default_opts)
map('n', '<space>D', '<cmd>lua vim.lsp.buf.type_definition()<CR>', default_opts)
map('n', '<space>rn', '<cmd>lua vim.lsp.buf.rename()<CR>', default_opts)
map('n', '<space>ca', '<cmd>lua vim.lsp.buf.code_action()<CR>', default_opts)
map('n', 'gr', '<cmd>lua vim.lsp.buf.references()<CR>', default_opts)
map('n', '<space>e', '<cmd>lua vim.lsp.diagnostic.show_line_diagnostics()<CR>', default_opts)
map('n', '[d', '<cmd>lua vim.lsp.diagnostic.goto_prev()<CR>', default_opts)
map('n', ']d', '<cmd>lua vim.lsp.diagnostic.goto_next()<CR>', default_opts)
map('n', '<space>q', '<cmd>lua vim.lsp.diagnostic.set_loclist()<CR>', default_opts)
map('n', '<space>f', '<cmd>lua vim.lsp.buf.formatting()<CR>', default_opts)

-- Directional Hotkeys
map('', 'h', '<Nop>', default_opts)
map('', 'j', 'h', default_opts)
map('', 'k', 'j', default_opts)
map('', 'l', 'k', default_opts)
map('', "'", 'l', default_opts)
map('', 'h', '<Nop>', default_opts)
map('', 'h', '<Nop>', default_opts)
map('', 'h', '<Nop>', default_opts)
map('', '<C-w>j', '<C-w>h', default_opts)
map('', '<C-w>k', '<C-w>j', default_opts)
map('', '<C-w>l', '<C-w>k', default_opts)
map('', "<C-w>'", '<C-w>l', default_opts)
map('', '<C-w>J', '<C-w>H', default_opts)
map('', '<C-w>K', '<C-w>J', default_opts)
map('', '<C-w>L', '<C-w>K', default_opts)
map('', '<C-w>"', '<C-w>L', default_opts)

-- Vim-tmux-navigation Directions
g.tmux_navigator_no_mappings = 1
map('n', '<C-Left>', ':TmuxNavigateLeft<CR>', default_opts)
map('n', '<C-Down>', ':TmuxNavigateDown<CR>', default_opts)
map('n', '<C-Up>', ':TmuxNavigateUp<CR>', default_opts)
map('n', '<C-Right>', ':TmuxNavigateRight<CR>', default_opts)

-- so that Ctrl+C triggers InsertLeave autocmd
map('i', '<C-c>', '<ESC>', default_opts)
map('i', 'jk', '<ESC>', default_opts)
-- so that forward delete works in insert mode
map('i', '<C-d>', '<Del>', default_opts)

-- Buffers
map('n', '<leader>d', ':Bdelete<CR>', default_opts)
map('n', '<leader>,', ':bp<CR>', default_opts)
map('n', '<leader>.', ':bn<CR>', default_opts)
map('n', '<leader><', ':BufferMovePrevious<CR>', default_opts)
map('n', '<leader>>', ':BufferMoveNext<CR>', default_opts)
-- Telescope bindings
map('n', '<leader>ff', "<cmd>lua require('telescope.builtin').git_files()<CR>", default_opts)
map('n', '<leader>fg', "<cmd>lua require('telescope.builtin').live_grep()<CR>", default_opts)
map('n', '<leader>b', "<cmd>lua require('telescope.builtin').buffers()<CR>", default_opts)
-- LF file manager
map('n', '<leader>e', ':FloatermNew lf<CR>', default_opts)
-- NvimTree file manager
map('n', '<leader>nn', ':NvimTreeToggle<CR>', default_opts)
map('n', '<leader>nf', ':NvimTreeFindFile<CR>', default_opts)
-- Git vim-fugitive hotkeys
map('n', '<leader>gb', ':Git blame<CR>', default_opts)
map('n', '<leader>gd', ':Gdiff<space>', default_opts)
