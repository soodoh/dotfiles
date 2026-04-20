return {
  "stevearc/conform.nvim",
  config = function()
    local conform = require("conform")
    local util = require("conform.util")
    local biome_root = util.root_file({
      "biome.json",
      "biome.jsonc",
    })
    local prettier_root = util.root_file({
      ".prettierrc",
      ".prettierrc.json",
      ".prettierrc.yml",
      ".prettierrc.yaml",
      ".prettierrc.json5",
      ".prettierrc.js",
      ".prettierrc.cjs",
      ".prettierrc.mjs",
      ".prettierrc.toml",
      "prettier.config.js",
      "prettier.config.cjs",
      "prettier.config.mjs",
    })
    local web_formatters = { "biome", "prettier", stop_after_first = true }

    conform.setup({
      formatters = {
        biome = {
          require_cwd = true,
          cwd = biome_root,
        },
        prettier = {
          require_cwd = true,
          cwd = prettier_root,
        },
      },
      formatters_by_ft = {
        sh = { "shfmt", "shellcheck" },
        lua = { "stylua" },
        python = { "black" },
        -- rust = { "rstfmt" },
        kdl = { "kdlfmt" },
        javascript = web_formatters,
        typescript = web_formatters,
        javascriptreact = web_formatters,
        typescriptreact = web_formatters,
        svelte = web_formatters,
        css = web_formatters,
        html = web_formatters,
        json = web_formatters,
        jsonc = web_formatters,
        yaml = { "prettier" },
        markdown = { "prettier" },
        graphql = web_formatters,
        -- Use the "_" filetype to run formatters on filetypes that don't
        -- have other formatters configured.
        ["_"] = { "trim_whitespace" },
        -- Fallback to LSP formatting for other file types
        ["*"] = { "lsp_format" },
      },
      -- Set this to change the default values when calling conform.format()
      -- This will also affect the default values for format_on_save/format_after_save
      default_format_opts = {
        lsp_format = "fallback",
      },
      -- If this is set, Conform will run the formatter on save.
      -- It will pass the table to conform.format().
      -- This can also be a function that returns the table.
      -- format_on_save = {
      --   -- I recommend these options. See :help conform.format for details.
      --   -- lsp_format = "fallback",
      --   timeout_ms = 500,
      -- },
      -- If this is set, Conform will run the formatter asynchronously after save.
      -- It will pass the table to conform.format().
      -- This can also be a function that returns the table.
      format_after_save = {
        lsp_format = "fallback",
      },
      -- Set the log level. Use `:ConformInfo` to see the location of the log file.
      log_level = vim.log.levels.ERROR,
      -- Conform will notify you when a formatter errors
      notify_on_error = true,
      -- Conform will notify you when no formatters are available for the buffer
      notify_no_formatters = true,
    })

    vim.api.nvim_create_user_command("Format", function(args)
      local range = nil
      if args.count ~= -1 then
        local end_line = vim.api.nvim_buf_get_lines(
          0,
          args.line2 - 1,
          args.line2,
          true
        )[1]
        range = {
          start = { args.line1, 0 },
          ["end"] = { args.line2, end_line:len() },
        }
      end
      require("conform").format({
        async = true,
        range = range,
      })
    end, { range = true })

    require("which-key").add({
      {
        "<leader>sf",
        ":Format<CR>",
        desc = "Format buffer (LSP)",
      },
      {
        "<leader>sF",
        function()
          vim.g.disable_autoformat = not vim.g.disable_autoformat
          local status = vim.g.disable_autoformat and "disabled"
            or "enabled"
          vim.notify("Format on save " .. status)
        end,
        desc = "Toggle format on save (LSP)",
      },
    })
  end,
}
