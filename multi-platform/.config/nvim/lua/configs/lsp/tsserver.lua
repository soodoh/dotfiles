local lspconfig = require("lspconfig")

return {
    format = false,
    -- Disable for JS since we use flow
    filetypes = {
        "javascript",
        "javascriptreact",
        "javascript.jsx",
        "typescript",
        "typescriptreact",
        "typescript.tsx",
    },
    -- Don't use in a .flowconfig project, but other JS projects could still use TS server
    root_dir = function(fname)
        return lspconfig.util.root_pattern("tsconfig.json")(fname)
            or not lspconfig.util.root_pattern(".flowconfig")(fname)
                and lspconfig.util.root_pattern("package.json", "jsconfig.json", ".git")(fname)
    end,
    -- -- Ignore some rules
    -- handlers = {
    --     ["textDocument/publishDiagnostics"] = function(_, _, params, client_id, _, config)
    --         if params.diagnostics ~= nil then
    --             local idx = 1
    --             while idx <= #params.diagnostics do
    --                 if params.diagnostics[idx] and params.diagnostics[idx].code == 80001 then
    --                     table.remove(params.diagnostics, idx)
    --                 else
    --                     idx = idx + 1
    --                 end
    --             end
    --         end
    --         vim.lsp.diagnostic.on_publish_diagnostics(_, _, params, client_id, _, config)
    --     end,
    -- },
}
