vim.g.mapleader = " "

-- LSP bindings
vim.api.nvim_set_keymap('n', 'gy', '<Plug>(coc-type-definition)', { noremap = false, silent = true })
vim.api.nvim_set_keymap('n', 'gi', '<Plug>(coc-definition)', { noremap = false, silent = true })

-- Directional Hotkeys
vim.api.nvim_set_keymap('', 'h', '<Nop>', { noremap = true, silent = true })
vim.api.nvim_set_keymap('', 'j', 'h', { noremap = true, silent = true })
vim.api.nvim_set_keymap('', 'k', 'j', { noremap = true, silent = true })
vim.api.nvim_set_keymap('', 'l', 'k', { noremap = true, silent = true })
vim.api.nvim_set_keymap('', "'", 'l', { noremap = true, silent = true })
vim.api.nvim_set_keymap('', 'h', '<Nop>', { noremap = true, silent = true })
vim.api.nvim_set_keymap('', 'h', '<Nop>', { noremap = true, silent = true })
vim.api.nvim_set_keymap('', 'h', '<Nop>', { noremap = true, silent = true })
vim.api.nvim_set_keymap('', '<C-w>j', '<C-w>h', { noremap = true, silent = true })
vim.api.nvim_set_keymap('', '<C-w>k', '<C-w>j', { noremap = true, silent = true })
vim.api.nvim_set_keymap('', '<C-w>l', '<C-w>k', { noremap = true, silent = true })
vim.api.nvim_set_keymap('', "<C-w>'", '<C-w>l', { noremap = true, silent = true })
vim.api.nvim_set_keymap('', '<C-w>J', '<C-w>H', { noremap = true, silent = true })
vim.api.nvim_set_keymap('', '<C-w>K', '<C-w>J', { noremap = true, silent = true })
vim.api.nvim_set_keymap('', '<C-w>L', '<C-w>K', { noremap = true, silent = true })
vim.api.nvim_set_keymap('', '<C-w>"', '<C-w>L', { noremap = true, silent = true })
-- Vim-tmux-navigation Directions
vim.g.tmux_navigator_no_mappings = 1
vim.api.nvim_set_keymap('n', '<C-Left>', ':TmuxNavigateLeft<CR>', { noremap = true, silent = true })
vim.api.nvim_set_keymap('n', '<C-Down>', ':TmuxNavigateDown<CR>', { noremap = true, silent = true })
vim.api.nvim_set_keymap('n', '<C-Up>', ':TmuxNavigateUp<CR>', { noremap = true, silent = true })
vim.api.nvim_set_keymap('n', '<C-Right>', ':TmuxNavigateRight<CR>', { noremap = true, silent = true })

-- so that Ctrl+C triggers InsertLeave autocmd
vim.api.nvim_set_keymap('i', '<C-c>', '<ESC>', { noremap = true, silent = true })
vim.api.nvim_set_keymap('i', 'jk', '<ESC>', { noremap = true, silent = true })
-- so that forward delete works in insert mode
vim.api.nvim_set_keymap('i', '<C-d>', '<Del>', { noremap = true, silent = true })

-- Buffers
vim.api.nvim_set_keymap('n', '<leader>d', ':Bdelete<CR>', { noremap = true, silent = true })
vim.api.nvim_set_keymap('n', '<leader>,', ':bp<CR>', { noremap = true, silent = true })
vim.api.nvim_set_keymap('n', '<leader>.', ':bn<CR>', { noremap = true, silent = true })
vim.api.nvim_set_keymap('n', '<leader><', ':BufferMovePrevious<CR>', { noremap = true, silent = true })
vim.api.nvim_set_keymap('n', '<leader>>', ':BufferMoveNext<CR>', { noremap = true, silent = true })
-- Telescope bindings
vim.api.nvim_set_keymap('n', '<leader>ff', "<cmd>lua require('telescope.builtin').git_files()<CR>", { noremap = true, silent = true })
vim.api.nvim_set_keymap('n', '<leader>fg', "<cmd>lua require('telescope.builtin').live_grep()<CR>", { noremap = true, silent = true })
vim.api.nvim_set_keymap('n', '<leader>b', "<cmd>lua require('telescope.builtin').buffers()<CR>", { noremap = true, silent = true })
-- LF file manager
vim.api.nvim_set_keymap('n', '<leader>e', ':FloatermNew lf<CR>', { noremap = true, silent = true })
-- NvimTree file manager
vim.api.nvim_set_keymap('n', '<leader>nn', ':NvimTreeToggle<CR>', { noremap = true, silent = true })
vim.api.nvim_set_keymap('n', '<leader>nf', ':NvimTreeFindFile<CR>', { noremap = true, silent = true })
-- Git vim-fugitive hotkeys
vim.api.nvim_set_keymap('n', '<leader>gb', ':Git blame<CR>', { noremap = true, silent = true })
vim.api.nvim_set_keymap('n', '<leader>gd', ':Gdiff<space>', { noremap = true, silent = true })
