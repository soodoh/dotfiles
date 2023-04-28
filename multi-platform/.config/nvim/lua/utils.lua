local M = {}

M.keymap = function(mode, key, command, opts)
    local default_opts = { noremap = true, silent = true }
    vim.api.nvim_set_keymap(mode, key, command, opts or default_opts)
end

return M
