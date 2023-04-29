local M = {}

M.keymap = function(mode, key, command, opts)
    local default_opts = { silent = true }
    vim.keymap.set(mode, key, command, opts or default_opts)
end

return M
