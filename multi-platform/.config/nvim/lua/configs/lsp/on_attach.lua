local buf_map = require("utils").buf_map

return function(client, bufnr)
    buf_map(bufnr, "n", "gD", "<cmd>lua vim.lsp.buf.declaration()<CR>")
    buf_map(bufnr, "n", "gd", "<cmd>lua vim.lsp.buf.definition()<CR>")
    buf_map(bufnr, "n", "gi", "<cmd>lua vim.lsp.buf.implementation()<CR>")
end
