local typescript_lsp = require("typescript-lsp")

return {
  -- Configs for nvim LSP client
  {
    "neovim/nvim-lspconfig",
    dependencies = {
      "saghen/blink.cmp", -- Autocomplete
      -- Zip plugin (needed for Yarn PnP compatibility)
      {
        "lbrayner/vim-rzip",
        commit = "f65400fed27b27c7cff7ef8d428c4e5ff749bf28",
      },
    },
    config = function()
      local capability_overrides = {}

      -- LSP mappings and per-server capability overrides (preserves upstream on_attach hooks)
      vim.api.nvim_create_autocmd("LspAttach", {
        group = vim.api.nvim_create_augroup("UserLspConfig", {}),
        callback = function(ev)
          local client = vim.lsp.get_client_by_id(ev.data.client_id)
          local override = client and capability_overrides[client.name]
          if override ~= nil then
            if override.format ~= nil then
              client.server_capabilities.documentFormattingProvider =
                override.format
            end
            if override.hover ~= nil then
              client.server_capabilities.hoverProvider = override.hover
            end
          end

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
              ":lsp restart<CR>",
              desc = "Restart LSP Sources",
            },
            {
              "<leader>sI",
              ":checkhealth vim.lsp<CR>",
              desc = "Diagnose LSP Clients",
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

      -- Shared capabilities for all LSP servers (blink.cmp + nvim-ufo folding)
      vim.lsp.config("*", {
        capabilities = vim.tbl_deep_extend(
          "force",
          require("blink.cmp").get_lsp_capabilities(),
          {
            textDocument = {
              foldingRange = {
                dynamicRegistration = false,
                lineFoldingOnly = true,
              },
            },
          }
        ),
      })

      local ts_ls_root_dir = vim.lsp.config.ts_ls.root_dir
      local tsc_config = vim.lsp.config.tsc

      local servers = {
        -- Unix
        awk_ls = {},
        bashls = {},
        jsonls = {},
        taplo = {},
        vimls = {},
        yamlls = {},
        -- Web
        biome = { overrides = { format = true } },
        cssls = {
          settings = {
            css = { lint = { unknownAtRules = "ignore" } },
          },
        },
        eslint = { overrides = { format = true } },
        oxlint = {
          overrides = { format = true },
          -- The pinned oxlint CLI needs its LSP mode selected explicitly.
          cmd = { "oxlint", "--lsp" },
          -- Avoid health warnings for filetypes not registered in Neovim 0.11.
          filetypes = {
            "javascript",
            "javascriptreact",
            "typescript",
            "typescriptreact",
          },
          root_markers = {
            ".oxlintrc.json",
            "oxlint.config.ts",
            "oxlint.config.js",
            "oxlint.config.mjs",
            "oxlint.config.cjs",
          },
        },
        graphql = {},
        html = {},
        marksman = {},
        ts_ls = {
          overrides = { format = false },
          root_dir = typescript_lsp.filter_root(
            "ts_ls",
            ts_ls_root_dir,
            ts_ls_root_dir
          ),
        },
        tsc = {
          overrides = { format = false },
          -- Keep cmd and root_dir from the same upstream config instance so
          -- its selected native binary is available to the cmd callback.
          cmd = tsc_config.cmd,
          root_dir = typescript_lsp.filter_root(
            "tsc",
            tsc_config.root_dir,
            ts_ls_root_dir
          ),
        },
        -- Server
        docker_language_server = {},
        gopls = {},
        lua_ls = { overrides = { format = false } },
        pyright = {
          settings = {
            pyright = {
              disableOrganizeImports = true,
            },
          },
        },
        ruff = { overrides = { format = false, hover = false } },
        rust_analyzer = {},
      }

      local enabled = {}
      for name, spec in pairs(servers) do
        local cfg = vim.deepcopy(spec)
        if cfg.overrides ~= nil then
          capability_overrides[name] = cfg.overrides
          cfg.overrides = nil
        end
        if next(cfg) ~= nil then
          vim.lsp.config(name, cfg)
        end
        table.insert(enabled, name)
      end
      table.sort(enabled)
      vim.lsp.enable(enabled)
    end,
  },
}
