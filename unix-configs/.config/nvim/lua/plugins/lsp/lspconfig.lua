local get_default_opts = function(opts)
  local lsp_opts = {}

  -- On attach, used for formatting logic
  lsp_opts.on_attach = function(client, bufnr)
    -- Explicitly enable/disable formatting per LSP provider
    if opts ~= nil and opts.format ~= nil then
      client.server_capabilities.documentFormattingProvider = opts.format
    end
  end

  -- Optional settings
  if opts ~= nil and opts.settings ~= nil then
    lsp_opts.settings = opts.settings
  end

  lsp_opts.capabilities = require("blink.cmp").get_lsp_capabilities()
  -- Needed for nvim-ufo (LSP-based folding)
  -- foldingRange isn't there by default
  lsp_opts.capabilities =
    vim.tbl_deep_extend("force", lsp_opts.capabilities, {
      textDocument = {
        foldingRange = {
          dynamicRegistration = false,
          lineFoldingOnly = true,
        },
      },
    })

  return lsp_opts
end

return {
  -- Configs for nvim LSP client
  {
    "neovim/nvim-lspconfig",
    dependencies = {
      "saghen/blink.cmp", -- Autocomplete
      -- Zip plugin (needed for Yarn PnP compatibility)
      "lbrayner/vim-rzip",
    },
    config = function()
      -- LSP mappings
      vim.api.nvim_create_autocmd("LspAttach", {
        group = vim.api.nvim_create_augroup("UserLspConfig", {}),
        callback = function(ev)
          require("which-key").add({
            {
              "<leader>s",
              group = "LSP",
            },
            {
              "<leader>sd",
              vim.lsp.buf.definition,
              desc = "Go to definition (LSP)",
              buffer = ev.buf,
            },
            {
              "<leader>si",
              vim.lsp.buf.implementation,
              desc = "Go to implementation (LSP)",
              buffer = ev.buf,
            },
            {
              "<leader>sy",
              vim.lsp.buf.type_definition,
              desc = "Go to type def (LSP)",
              buffer = ev.buf,
            },
            {
              "<leader>sR",
              ":LspRestart<CR>",
              desc = "Restart LSP Sources",
            },
            {
              "<leader>sI",
              ":LspInfo<CR>",
              desc = "Show attached LSP clients",
            },
          })
        end,
      })

      -- Diagnostic icons
      vim.diagnostic.config({
        signs = {
          text = {
            [vim.diagnostic.severity.ERROR] = "",
            [vim.diagnostic.severity.WARN] = "",
            [vim.diagnostic.severity.INFO] = "",
            [vim.diagnostic.severity.HINT] = "󰌵",
          },
        },
      })

      -- Unix
      vim.lsp.config("awk_ls", get_default_opts())
      vim.lsp.config("bashls", get_default_opts())
      vim.lsp.config("jsonls", get_default_opts())
      vim.lsp.config("taplo", get_default_opts())
      vim.lsp.config("vimls", get_default_opts())
      vim.lsp.config("yamlls", get_default_opts())
      -- Web
      vim.lsp.config(
        "cssls",
        get_default_opts({
          settings = {
            css = { lint = { unknownAtRules = "ignore" } },
          },
        })
      )
      vim.lsp.config(
        "eslint",
        get_default_opts({
          format = true,
        })
      )
      vim.lsp.config("graphql", get_default_opts())
      vim.lsp.config("html", get_default_opts())
      vim.lsp.config("marksman", get_default_opts())
      vim.lsp.config("prismals", get_default_opts())
      vim.lsp.config("svelte", get_default_opts())
      vim.lsp.config("ts_ls", get_default_opts({ format = false }))
      -- Server
      vim.lsp.config("csharp_ls", get_default_opts())
      vim.lsp.config("docker_language_server", get_default_opts())
      vim.lsp.config("gopls", get_default_opts())
      vim.lsp.config("lua_ls", get_default_opts())
      vim.lsp.config("pyright", get_default_opts())
      vim.lsp.config("rust_analyzer", get_default_opts())
    end,
  },
}
