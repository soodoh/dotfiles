return {
  -- Package manager for LSP/DAP/Linters/Formatters
  "williamboman/mason.nvim",
  "williamboman/mason-lspconfig.nvim",

  -- Configs for nvim LSP client
  {
    "neovim/nvim-lspconfig",
    dependencies = {
      "saghen/blink.cmp", -- Autocomplete
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

      -- Setup related LSP dependencies
      require("mason").setup()
      require("mason-lspconfig").setup({
        automatic_installation = true,
      })
      -- Setup lspconfig (with auto complete, file operations, etc.)
      local get_opts = require("plugins.lsp.lspconfig.default_opts")
      local lspconfig = require("lspconfig")
      -- Unix
      vim.lsp.config("awk_ls", get_opts())
      vim.lsp.enable("awk_ls")
      vim.lsp.config("bashls", get_opts())
      vim.lsp.enable("bashls")
      vim.lsp.config("jsonls", get_opts())
      vim.lsp.enable("jsonls")
      vim.lsp.config("taplo", get_opts())
      vim.lsp.enable("taplo")
      vim.lsp.config("yamlls", get_opts())
      vim.lsp.enable("yamlls")
      -- Web
      vim.lsp.config(
        "cssls",
        get_opts({
          settings = {
            css = { lint = { unknownAtRules = "ignore" } },
          },
        })
      )
      vim.lsp.enable("cssls")
      vim.lsp.config(
        "eslint",
        get_opts({
          format = true,
        })
      )
      vim.lsp.enable("eslint")
      vim.lsp.config("graphql", get_opts())
      vim.lsp.enable("graphql")
      vim.lsp.config("html", get_opts())
      vim.lsp.enable("html")
      vim.lsp.config("marksman", get_opts())
      vim.lsp.enable("marksman")
      vim.lsp.config("svelte", get_opts())
      vim.lsp.enable("svelte")
      vim.lsp.config("ts_ls", get_opts({ format = false }))
      vim.lsp.enable("ts_ls")
      -- Server
      vim.lsp.config("prismals", get_opts())
      vim.lsp.enable("prismals")
      vim.lsp.config("dockerls", get_opts())
      vim.lsp.enable("dockerls")
      vim.lsp.config("docker_compose_language_service", get_opts())
      vim.lsp.enable("docker_compose_language_service")
      vim.lsp.config("gopls", get_opts())
      vim.lsp.enable("gopls")
      vim.lsp.config("lua_ls", get_opts())
      vim.lsp.enable("lua_ls")
      vim.lsp.config("pyright", get_opts())
      vim.lsp.enable("pyright")
      vim.lsp.config("rubocop", get_opts())
      -- vim.lsp.enable("rubocop")
      vim.lsp.config("rust_analyzer", get_opts())
      vim.lsp.enable("rust_analyzer")
      vim.lsp.config("terraformls", get_opts())
      vim.lsp.enable("terraformls")
      vim.lsp.config("omnisharp", get_opts())
      -- vim.lsp.enable("omnisharp")

      -- Format the diagnostic messages
      -- vim.lsp.handlers["textDocument/publishDiagnostics"] =
      --   vim.lsp.with(vim.lsp.diagnostic.on_publish_diagnostics, {
      --     underline = true,
      --     update_in_insert = false,
      --     virtual_text = false,
      --   })
    end,
  },

  -- Automatically installs 3rd party tools
  {
    "WhoIsSethDaniel/mason-tool-installer.nvim",
    config = function()
      require("mason-tool-installer").setup({
        ensure_installed = {
          "black",
          "stylua",
          "prettier",
          "prettierd",
          "eslint_d",
        },
        auto_update = true,
      })
    end,
  },
}
