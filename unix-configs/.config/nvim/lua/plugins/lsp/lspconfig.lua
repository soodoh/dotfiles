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

  lsp_opts.capabilities = require("blink.cmp").get_lsp_capabilities(
    require("lsp-file-operations").default_capabilities()
  )
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
      vim.lsp.enable("awk_ls")
      vim.lsp.config("bashls", get_default_opts())
      vim.lsp.enable("bashls")
      vim.lsp.config("jsonls", get_default_opts())
      vim.lsp.enable("jsonls")
      vim.lsp.config("taplo", get_default_opts())
      vim.lsp.enable("taplo")
      vim.lsp.config("yamlls", get_default_opts())
      vim.lsp.enable("yamlls")
      -- Web
      vim.lsp.config(
        "cssls",
        get_default_opts({
          settings = {
            css = { lint = { unknownAtRules = "ignore" } },
          },
        })
      )
      vim.lsp.enable("cssls")
      vim.lsp.config(
        "eslint",
        get_default_opts({
          format = true,
        })
      )
      vim.lsp.enable("eslint")
      vim.lsp.config("graphql", get_default_opts())
      vim.lsp.enable("graphql")
      vim.lsp.config("html", get_default_opts())
      vim.lsp.enable("html")
      vim.lsp.config("marksman", get_default_opts())
      vim.lsp.enable("marksman")
      vim.lsp.config("svelte", get_default_opts())
      vim.lsp.enable("svelte")
      vim.lsp.config("ts_ls", get_default_opts({ format = false }))
      vim.lsp.enable("ts_ls")
      -- Server
      vim.lsp.config("prismals", get_default_opts())
      vim.lsp.enable("prismals")
      vim.lsp.config("dockerls", get_default_opts())
      vim.lsp.enable("dockerls")
      vim.lsp.config("docker_compose_language_service", get_default_opts())
      vim.lsp.enable("docker_compose_language_service")
      vim.lsp.config("gopls", get_default_opts())
      vim.lsp.enable("gopls")
      vim.lsp.config("lua_ls", get_default_opts())
      vim.lsp.enable("lua_ls")
      vim.lsp.config("pyright", get_default_opts())
      vim.lsp.enable("pyright")
      vim.lsp.config("rubocop", get_default_opts())
      -- vim.lsp.enable("rubocop")
      vim.lsp.config("rust_analyzer", get_default_opts())
      vim.lsp.enable("rust_analyzer")
      vim.lsp.config("terraformls", get_default_opts())
      vim.lsp.enable("terraformls")
      vim.lsp.config("omnisharp", get_default_opts())
      -- vim.lsp.enable("omnisharp")
    end,
  },
}
