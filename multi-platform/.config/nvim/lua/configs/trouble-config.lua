return function()
    local keymap = require("utils").keymap
    keymap("n", "<leader>xx", "<cmd>Trouble<CR>")
    keymap("n", "<leader>xw", "<cmd>Trouble workspace_diagnostics<CR>")
    keymap("n", "<leader>xd", "<cmd>Trouble document_diagnostics<CR>")
    keymap("n", "<leader>xq", "<cmd>Trouble quickfix<CR>")
    keymap("n", "<leader>xl", "<cmd>Trouble lsp_references<CR>")
end
