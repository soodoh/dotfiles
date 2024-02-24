return {
  -- Git status in column
  {
    "lewis6991/gitsigns.nvim",
    dependencies = { "nvim-lua/plenary.nvim" },
    config = function()
      require("gitsigns").setup({
        signs = {
          add = { text = "│" },
          change = { text = "│" },
          delete = { text = "_" },
          topdelete = { text = "‾" },
          changedelete = { text = "~" },
          untracked = { text = "┆" },
        },
        signcolumn = true,
        current_line_blame = true,         -- Toggle with `:Gitsigns toggle_current_line_blame`
        current_line_blame_opts = {
          virt_text = true,
          virt_text_pos = "eol",           -- 'eol' | 'overlay' | 'right_align'
          delay = 100,
          ignore_whitespace = false,
        },
        current_line_blame_formatter_opts = {
          relative_time = true,
        },
        on_attach = function(bufnr)
          local gs = package.loaded.gitsigns
          local wk = require("which-key")
          wk.register({
            [",h"] = {
              function()
                if vim.wo.diff then
                  return ",h"
                end
                vim.schedule(function()
                  gs.next_hunk()
                end)
                return "<Ignore>"
              end,
              "Go to next hunk (Gitsigns)",
            },
            [",,h"] = {
              function()
                if vim.wo.diff then
                  return ",,h"
                end
                vim.schedule(function()
                  gs.prev_hunk()
                end)
                return "<Ignore>"
              end,
              "Go to previous hunk (Gitsigns)",
            },
          }, { mode = { "n", "v" } })
          wk.register({
            ["<leader>h"] = {
              name = "Gitsigns",
              s = { gs.stage_hunk, "Stage hunk (Gitsigns)" },
              S = {
                gs.stage_buffer,
                "Stage buffer (Gitsigns)",
              },
              r = { gs.reset_hunk, "Reset hunk (Gitsigns)" },
              R = {
                gs.reset_buffer,
                "Reset buffer (Gitsigns)",
              },
              u = {
                gs.undo_stage_hunk,
                "Unstage hunk (Gitsigns)",
              },
              p = {
                gs.preview_hunk,
                "Preview hunk (Gitsigns)",
              },
              b = {
                function()
                  gs.blame_line({ full = true })
                end,
                "View blame (Gitsigns)",
              },
            },
          })
        end,
      })
    end,
  },
}
