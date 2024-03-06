return {
  -- Configs for nvim LSP client
  {
    "neovim/nvim-lspconfig",
    after = { "mason-lspconfig.nvim", "folke/neodev.nvim" },
    dependencies = {
      "hrsh7th/nvim-cmp",       -- Better autocomplete
      "lukas-reineke/lsp-format.nvim",
    },
    config = function()
      -- LSP mappings
      vim.api.nvim_create_autocmd("LspAttach", {
        group = vim.api.nvim_create_augroup("UserLspConfig", {}),
        callback = function(ev)
          require("which-key").register({
            ["<leader>s"] = {
              name = "LSP Actions",
              D = {
                vim.lsp.buf.definition,
                "Go to definition (LSP)",
                buffer = ev.buf,
              },
              F = {
                function()
                  vim.lsp.buf.format({ async = true })
                end,
                "Format buffer (LSP)",
              },
              R = {
                ":LspRestart<CR>",
                "Restart LSP Sources",
              },
            },
          })
        end,
      })

      -- Diagnostic icons
      local signs =
      { Error = "", Warn = "", Hint = "", Info = "" }
      for type, icon in pairs(signs) do
        local hl = "DiagnosticSign" .. type
        vim.fn.sign_define(
          hl,
          { text = icon, texthl = hl, numhl = hl }
        )
      end

      -- Setup lspconfig with cmp (auto complete)
      local get_opts = require("plugins.lsp.lspconfig.default_opts")
      local lspconfig = require("lspconfig")
      -- Unix
      lspconfig.awk_ls.setup(get_opts())
      lspconfig.bashls.setup(get_opts())
      lspconfig.jsonls.setup(get_opts())
      lspconfig.taplo.setup(get_opts())
      lspconfig.yamlls.setup(get_opts())
      -- Web
      lspconfig.cssls.setup(get_opts())
      lspconfig.cssmodules_ls.setup(get_opts())
      lspconfig.emmet_ls.setup(get_opts())
      lspconfig.eslint.setup(get_opts({ format = true }))
      lspconfig.efm.setup(require("plugins.lsp.lspconfig.efm_opts"))
      lspconfig.graphql.setup(get_opts())
      lspconfig.html.setup(get_opts())
      lspconfig.intelephense.setup(get_opts())
      lspconfig.marksman.setup(get_opts())
      lspconfig.svelte.setup(get_opts())
      lspconfig.tsserver.setup(get_opts({ format = false }))
      -- Server
      lspconfig.clangd.setup(get_opts())
      lspconfig.dockerls.setup(get_opts())
      lspconfig.docker_compose_language_service.setup(get_opts())
      lspconfig.gopls.setup(get_opts())
      lspconfig.lua_ls.setup(get_opts())
      lspconfig.pyright.setup(get_opts())
      lspconfig.ruby_ls.setup(get_opts())
      lspconfig.rust_analyzer.setup(get_opts())
      lspconfig.terraformls.setup(get_opts())

      -- Format the diagnostic messages
      vim.lsp.handlers["textDocument/publishDiagnostics"] =
          vim.lsp.with(vim.lsp.diagnostic.on_publish_diagnostics, {
            underline = true,
            update_in_insert = false,
            virtual_text = false,
          })
    end,
  },
}
